import test from "node:test"
import assert from "node:assert/strict"
import { parseTurtle, getProfileSubject } from "cori-sdk/utils.js"
import { BP } from "../src/vocab.js"
import { buildQuery, buildRecommendationQueries, buildCombinedQuery, countDocMatches, explainDocMatches, selectDiverseDocs, getStrategies, runRecommendations, SETTINGS_SUBJECT, DISABLED_STRATEGY } from "../src/recommendations.js"

const subject = getProfileSubject()
const strategy = getStrategies().find(s => s.iri === BP + "topicMatch")
const profile = () => parseTurtle(`
    <${subject}> <${BP}interestedIn> "Gehen", "Gemüse", "Schlaf" ;
        <${BP}savedBook> "AK42" ; <${BP}preferredLanguage> "ger" .
    <${SETTINGS_SUBJECT}> <${DISABLED_STRATEGY}> <${BP}savedBookSimilarity> .
`)

const endpoint = "https://index.example/select"
const topicProfile = names => parseTurtle(`
    <${subject}> <${BP}interestedIn> ${names.map(n => JSON.stringify(n)).join(", ")} .
    <${SETTINGS_SUBJECT}> <${DISABLED_STRATEGY}> <${BP}savedBookSimilarity> .
`)
const book = (id, ...topics) => ({ id, title: [id], topic: topics })

// A small catalogue double: answers every query with its matching books in catalogue
// order, leaving all ordering and selection decisions to the production runner.
function catalogue(t, docs) {
    const requests = []
    const matches = (doc, q) => [...q.matchAll(/(\w+):"([^"]+)"/g)]
        .some(([, field, value]) => [].concat(doc[field] ?? []).includes(value))
    t.mock.method(globalThis, "fetch", async (url, init) => {
        assert.equal(url, endpoint, "queries stay out of the URL")
        assert.equal(init.method, "POST")
        assert.equal(init.headers["Content-Type"], "application/x-www-form-urlencoded")
        const p = new URLSearchParams(init.body)
        requests.push(p)
        const q = p.get("q")
        const combined = [...p].filter(([key]) => key.startsWith("profileMatch")).map(([, value]) => value)
        const found = docs.filter(d => (q.startsWith("{!bool")
            ? combined.filter(clause => matches(d, clause)).length >= 2 : matches(d, q))
            && !p.getAll("fq").includes(`-id:"${d.id}"`))
        return { ok: true, json: async () => ({ response: { docs: found.slice(0, Number(p.get("rows"))), numFound: found.length } }) }
    })
    return requests
}

const shelfOf = (run, s = strategy) => run.results.find(r => r.strategy.iri === s.iri).docs

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

test("query and shelf order depend on labels, not RDF insertion order or authority ids", async t => {
    const prefixes = `@prefix bp: <${BP}> . @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .`
    const make = values => parseTurtle(`${prefixes}
        <${subject}> bp:interestedIn ${values.join(", ")} .
        <urn:z> rdfs:label "Bewegung" . <urn:a> rdfs:label "Gesunde Ernährung" . <urn:m> rdfs:label "Schlaf" .`)
    const a = make(["<urn:z>", "<urn:a>", "<urn:m>"])
    const b = make(["<urn:m>", "<urn:z>", "<urn:a>"])
    assert.deepEqual(buildRecommendationQueries(strategy, a, subject).map(q => q.q),
        ['topic_uri_str_mv:"urn:z"', 'topic_uri_str_mv:"urn:a"', 'topic_uri_str_mv:"urn:m"'])
    assert.deepEqual(buildCombinedQuery(strategy, a, subject), buildCombinedQuery(strategy, b, subject))
    catalogue(t, ["urn:m", "urn:a", "urn:z"].map(id => ({ id, title: [id], topic_uri_str_mv: [id] })))
    const shelf = async store => shelfOf(await runRecommendations(store, subject, { solrEndpoint: endpoint })).map(d => d.id)
    assert.deepEqual(await shelf(a), ["urn:z", "urn:a", "urn:m"])
    assert.deepEqual(await shelf(b), await shelf(a))
})

test("a combined card cites only its real profile matches", () => {
    const store = profile()
    const combo = { id: "combined", title: ["combined"], topic: ["Gehen", "Gemüse", "Gemüse"] }
    assert.equal(countDocMatches(combo, store, subject, strategy.properties), 2)
    const why = explainDocMatches(combo, store, subject, strategy.properties)
    assert.match(why, /<strong>Gehen<\/strong> und <strong>Gemüse<\/strong>/)
    assert.doesNotMatch(why, /Schlaf/)
})

test("the actual runner returns six varied suggestions; a failed pool leaves successful interests usable", async t => {
    const requests = []
    let failSleep = false
    t.mock.method(globalThis, "fetch", async (url, init) => {
        const params = new URLSearchParams(init.body)
        requests.push(params)
        const q = params.get("q")
        if (failSleep && q.includes("Schlaf")) return { ok: false, status: 503 }
        return { ok: true, json: async () => ({ response: { docs: [1, 2, 3].map(i => ({ id: q + i, title: [q + i] })) } }) }
    })
    const result = await runRecommendations(profile(), subject, { solrEndpoint: "https://index.example/select" })
    const docs = result.results.find(r => r.strategy.iri === strategy.iri).docs
    assert.equal(docs.length, 6)
    assert.deepEqual(docs.slice(0, 3).map(d => d.id), ['topic:"Gehen"1', 'topic:"Gemüse"1', 'topic:"Schlaf"1'])
    assert.ok(requests.every(p => p.get("rows") === "12" && p.get("sort").includes("field(publishDateSort,min)")))
    assert.ok(requests.every(p => p.get("sort").startsWith("score desc,")))
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
    t.mock.method(globalThis, "fetch", async (url, init) => {
        const params = new URLSearchParams(init.body)
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

test("repeated runs over the same profile and catalogue return the same shelf", async t => {
    const names = ["Astronomie", "Biologie", "Computer", "Design", "Energie", "Fotografie", "Schlaf"]
    const store = topicProfile(names)
    catalogue(t, names.flatMap(name => [1, 2, 3, 4].map(n => book(name + n, name))))
    const run = async () => shelfOf(await runRecommendations(store, subject, { solrEndpoint: endpoint }))
    const first = await run()
    assert.deepEqual(first.map(d => d.topic[0]), names.slice(0, 6), "with more interests than places, the last by label waits")
    assert.deepEqual(await run(), first)
})

test("a combined book counts for both its topics in the selection", async t => {
    const names = ["A", "B", "C", "D", "E", "F", "G"]
    const store = topicProfile(names)
    const combo = book("combo", "A", "B")
    catalogue(t, [combo, ...names.flatMap(name => [1, 2].map(n => book(name + n, name)))])
    const shelf = shelfOf(await runRecommendations(store, subject, { solrEndpoint: endpoint }))
    assert.deepEqual(shelf.map(d => d.id), ["combo", "C1", "D1", "E1", "F1", "G1"])
    assert.deepEqual([...new Set(shelf.flatMap(d => d.topic))].sort(), names)
})

test("AND lanes keep one full conjunction and relevance-ranked results", async t => {
    const and = getStrategies().find(s => s.combine?.iri === BP + "And")
    const disabled = getStrategies().filter(s => s.iri !== and.iri).map(s => `<${s.iri}>`).join(", ")
    const store = parseTurtle(`
        ${and.properties.map(prop => `<${subject}> <${prop}> "A", "B" .`).join("\n")}
        <${SETTINGS_SUBJECT}> <${BP}enabledStrategy> <${and.iri}> ;
            <${DISABLED_STRATEGY}> ${disabled} .
    `)
    const requests = []
    t.mock.method(globalThis, "fetch", async (url, init) => {
        const p = new URLSearchParams(init.body)
        requests.push(p)
        return { ok: true, json: async () => ({ response: { docs: [book("relevant"), book("newer")] } }) }
    })
    const run = await runRecommendations(store, subject, { solrEndpoint: endpoint })
    assert.equal(requests.length, 1)
    assert.ok(requests.every(p => p.get("sort") === "score desc,id asc" && p.get("rows") === "3"))
    assert.equal(requests[0].get("q"), buildQuery(and, store, subject).q)
    assert.deepEqual(shelfOf(run, and).map(d => d.id), ["relevant", "newer"])
    assert.equal(buildRecommendationQueries(and, store, subject).length, 1)
    assert.equal(buildCombinedQuery(and, store, subject), null)
})

test("the Solr freshness tie-break counts only years from 1 to next year, others as missing", async t => {
    const requests = catalogue(t, [book("a", "A")])
    await runRecommendations(topicProfile(["A"]), subject, { solrEndpoint: endpoint })
    const year = "field(publishDateSort,min)"
    const upper = new Date().getFullYear() + 1
    assert.deepEqual(requests.map(p => p.get("sort")), [`score desc,if(and(gte(${year},1),lte(${year},${upper})),${year},0) desc,id asc`])
})

test("an empty Merkliste does not mask an unreachable catalogue", async t => {
    const calls = []
    t.mock.method(globalThis, "fetch", async url => { calls.push(url); return { ok: false, status: 503 } })
    // inspira is on by default; with nothing saved it has nothing to send
    const store = parseTurtle(`<${subject}> <${BP}interestedIn> "A" .`)
    const run = await runRecommendations(store, subject, { solrEndpoint: endpoint, qdrantEndpoint: "https://inspira.example/api/recommend" })
    assert.equal(run.serverUnreachable, true)
    assert.ok(calls.every(url => url === endpoint), "no request to inspira")
})

test("genres and places feed the interests lane as alternatives of their own", () => {
    const store = parseTurtle(`<${subject}> <${BP}favoriteGenre> "Autobiografie" ; <${BP}interestedInPlace> "Alpen" .`)
    assert.deepEqual(buildRecommendationQueries(strategy, store, subject).map(q => q.q), ['genre:"Autobiografie"', 'geographic:"Alpen"'])
})
