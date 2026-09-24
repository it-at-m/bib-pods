import test from "node:test"
import assert from "node:assert/strict"
import { parseTurtle, getProfileSubject } from "cori-sdk/utils.js"
import { BP } from "../src/vocab.js"
import { buildQuery, buildRecommendationQueries, buildCombinedQuery, countDocMatches, explainDocMatches, selectDiverseDocs, orderDocsByProfile, getStrategies, runRecommendations, SETTINGS_SUBJECT, DISABLED_STRATEGY } from "../src/recommendations.js"

const subject = getProfileSubject()
const strategy = getStrategies().find(s => s.iri === BP + "topicMatch")
const profile = () => parseTurtle(`
    <${subject}> <${BP}interestedIn> "Gehen", "Gemüse", "Schlaf" ;
        <${BP}savedBook> "AK42" ; <${BP}preferredLanguage> "ger" .
    <${SETTINGS_SUBJECT}> <${DISABLED_STRATEGY}> <${BP}savedBookSimilarity> .
`)

test("OR retrieval represents every interest and preserves saved-book exclusions and preference filters", () => {
    const store = profile()
    const pool = buildQuery(strategy, store, subject)
    const queries = buildRecommendationQueries(strategy, store, subject)
    assert.equal(queries.length, 3)
    assert.deepEqual(queries.map(q => q.q), ['topic:"Gehen"', 'topic:"Gemüse"', 'topic:"Schlaf"'])
    assert.ok(queries.every(q => JSON.stringify(q.fq) === JSON.stringify(pool.fq)))
    assert.ok(pool.fq.includes('-id:"AK42"'))
    assert.ok(pool.fq.includes('language:"ger"'))
    const and = { ...strategy, combine: { iri: BP + "And" } }
    assert.deepEqual(buildRecommendationQueries(and, store, subject), [buildQuery(and, store, subject)])
})

test("selection gives each interest a turn, skips duplicate editions and fills from nonempty pools", () => {
    const book = (id, title = id) => ({ id, title: [title], author: ["Author"] })
    const walking = [book("walk1"), book("walk2")]
    const food = [book("food1"), book("food2", "food1"), book("food3")]
    const sleep = [book("walk1"), book("sleep1")]
    const selected = selectDiverseDocs([walking, food, sleep, []], 6)
    assert.deepEqual(selected.map(d => d.id), ["walk1", "food1", "sleep1", "walk2", "food3"])
    assert.deepEqual(selectDiverseDocs([walking, food], 0), [])
})

test("combined retrieval requires two distinct facts, preserving filters and safely passing their clauses", () => {
    const store = profile()
    const query = buildCombinedQuery(strategy, store, subject)
    assert.equal(query.q, "{!bool should=$profileMatch0 should=$profileMatch1 should=$profileMatch2 mm=2}")
    assert.deepEqual(Object.values(query.params), buildRecommendationQueries(strategy, store, subject).map(q => q.q))
    assert.deepEqual(query.fq, buildQuery(strategy, store, subject).fq)
    assert.equal(buildCombinedQuery({ ...strategy, combine: { iri: BP + "And" } }, store, subject), null)
    const author = getStrategies().find(s => s.iri === BP + "authorMatch")
    const oneAuthor = parseTurtle(`<${subject}> <${BP}favoriteAuthor> "O'Brian" .`)
    assert.equal(buildCombinedQuery(author, oneAuthor, subject), null, "author and author2 fields still represent just one fact")
    oneAuthor.addQuads(parseTurtle(`<${subject}> <${BP}favoriteAuthor> "Another author" .`).getQuads())
    const authors = buildCombinedQuery(author, oneAuthor, subject)
    assert.ok(Object.values(authors.params).some(q => q.includes("O'Brian")))
    assert.doesNotMatch(authors.q, /O'Brian/, "literal values never enter local parameter syntax")
})

test("query and shelf order depend on labels, not RDF insertion order or authority ids", () => {
    const prefixes = `@prefix bp: <${BP}> . @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .`
    const make = values => parseTurtle(`${prefixes}
        <${subject}> bp:interestedIn ${values.join(", ")} .
        <urn:z> rdfs:label "Bewegung" . <urn:a> rdfs:label "Gesunde Ernährung" . <urn:m> rdfs:label "Schlaf" .`)
    const a = make(["<urn:z>", "<urn:a>", "<urn:m>"])
    const b = make(["<urn:m>", "<urn:z>", "<urn:a>"])
    assert.deepEqual(buildRecommendationQueries(strategy, a, subject).map(q => q.q),
        ['topic_uri_str_mv:"urn:z"', 'topic_uri_str_mv:"urn:a"', 'topic_uri_str_mv:"urn:m"'])
    assert.deepEqual(buildCombinedQuery(strategy, a, subject), buildCombinedQuery(strategy, b, subject))
    const docs = ["urn:m", "urn:a", "urn:z"].map(id => ({ id, title: [id], topic_uri_str_mv: [id] }))
    assert.deepEqual(orderDocsByProfile(docs, strategy, a, subject), orderDocsByProfile([...docs].reverse(), strategy, b, subject))
})

test("a combined card cites only its real profile matches and leads the shelf after reloading", () => {
    const store = profile()
    const combo = { id: "combined", title: ["combined"], topic: ["Gehen", "Gemüse", "Gemüse"], publishDateSort: [2024] }
    const sleep = { id: "sleep", title: ["sleep"], topic: ["Schlaf"], publishDateSort: [2026] }
    const walk = { id: "walk", title: ["walk"], topic: ["Gehen"], publishDateSort: [2025] }
    assert.equal(countDocMatches(combo, store, subject, strategy.properties), 2)
    const why = explainDocMatches(combo, store, subject, strategy.properties)
    assert.match(why, /<strong>Gehen<\/strong> und <strong>Gemüse<\/strong>/)
    assert.doesNotMatch(why, /Schlaf/)
    assert.deepEqual(orderDocsByProfile([sleep, walk, combo], strategy, store, subject).map(d => d.id), ["combined", "walk", "sleep"])
})

test("shelf order remains varied after RDF reorders the messages, without losing unmatched older books", () => {
    const book = (id, topic, year) => ({ id, title: [id], topic: [topic], publishDateSort: [year] })
    const docs = [book("food2", "Gemüse", 2024), book("food1", "Gemüse", 2025),
        book("sleep2", "Schlaf", 2024), book("sleep1", "Schlaf", 2025),
        book("walk2", "Gehen", 2024), book("walk1", "Gehen", 2025), book("old", "Andere", 2020)]
    assert.deepEqual(orderDocsByProfile(docs, strategy, profile(), subject).map(d => d.id),
        ["walk1", "food1", "sleep1", "walk2", "food2", "sleep2", "old"])
})

test("the actual runner returns six varied suggestions; a failed pool leaves successful interests usable", async t => {
    const requests = []
    let failSleep = false
    t.mock.method(globalThis, "fetch", async url => {
        const params = new URL(url).searchParams
        requests.push(params)
        const q = params.get("q")
        if (failSleep && q.includes("Schlaf")) return { ok: false, status: 503 }
        return { ok: true, json: async () => ({ response: { docs: [1, 2, 3].map(i => ({ id: q + i, title: [q + i] })) } }) }
    })
    const result = await runRecommendations(profile(), subject, { solrEndpoint: "https://index.example/select" })
    const docs = result.results.find(r => r.strategy.iri === strategy.iri).docs
    assert.equal(docs.length, 6)
    assert.deepEqual(docs.slice(0, 3).map(d => d.id), ['topic:"Gehen"1', 'topic:"Gemüse"1', 'topic:"Schlaf"1'])
    assert.ok(requests.every(p => p.get("rows") === "12" && p.get("sort").includes("publishDateSort desc")))
    failSleep = true
    const partial = await runRecommendations(profile(), subject, { solrEndpoint: "https://index.example/select" })
    assert.equal(partial.serverUnreachable, false)
    assert.equal(partial.results[0].docs.length, 6)
    assert.ok(partial.results[0].docs.every(d => !d.id.includes("Schlaf")))
})

test("the runner retrieves an intersection outside the single-topic pools, and falls back when it fails", async t => {
    const store = profile()
    const combo = { id: "combined", title: ["combined"], topic: ["Gehen", "Gemüse"] }
    let failCombined = false
    t.mock.method(globalThis, "fetch", async url => {
        const params = new URL(url).searchParams
        if (params.get("q").startsWith("{!bool")) {
            assert.equal(params.get("profileMatch0"), 'topic:"Gehen"')
            assert.ok(params.getAll("fq").includes('-id:"AK42"'))
            if (failCombined) return { ok: false, status: 503 }
            // A bogus server match must not receive a combination claim or lead slot.
            return { ok: true, json: async () => ({ response: { docs: [{ id: "bogus", topic: ["Gehen"] }, combo] } }) }
        }
        const topic = params.get("q").slice(7, -1)
        return { ok: true, json: async () => ({ response: { docs: [1, 2, 3].map(i => ({ id: topic + i, title: [topic + i], topic: [topic] })) } }) }
    })
    const options = { solrEndpoint: "https://index.example/select" }
    const run = await runRecommendations(store, subject, options)
    assert.equal(run.results[0].docs.length, 6)
    assert.equal(run.results[0].docs[0].id, "combined")
    assert.equal(run.results[0].docs.filter(d => d.id === "combined").length, 1)
    assert.ok(run.results[0].docs.some(d => d.topic.includes("Schlaf")))
    failCombined = true
    const fallback = await runRecommendations(store, subject, options)
    assert.equal(fallback.results[0].docs.length, 6)
    assert.equal(fallback.serverUnreachable, false)
    assert.equal(fallback.results[0].docs[0].id, "Gehen1")
})
