import test from "node:test"
import assert from "node:assert/strict"
import { parseTurtle, getProfileSubject } from "cori-sdk/utils.js"
import { BP } from "../src/vocab.js"
import { buildQuery, buildRecommendationQueries, buildCombinedQuery, countDocMatches, explainDocMatches, selectDiverseDocs, orderDocsByProfile, getStrategies, runRecommendations, countStrategyMatches, SETTINGS_SUBJECT, DISABLED_STRATEGY } from "../src/recommendations.js"

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
    assert.deepEqual(orderDocsByProfile([sleep, walk, combo], strategy, store, subject).map(d => d.id), ["combined", "sleep", "walk"])
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

const endpoint = "https://index.example/select"
const topicProfile = names => parseTurtle(`
    <${subject}> <${BP}interestedIn> ${names.map(n => JSON.stringify(n)).join(", ")} .
    <${SETTINGS_SUBJECT}> <${DISABLED_STRATEGY}> <${BP}savedBookSimilarity> .
`)
function remember(store, docs, lane = strategy.label, read = false) {
    for (const doc of docs) store.addQuads(parseTurtle(`
        [] a <https://cori.systems/core#Message> ;
           <https://cori.systems/core#content> ${JSON.stringify(lane + "\n" + doc.title[0])} ;
           <https://cori.systems/core#refersToEntity> ${JSON.stringify(doc.id)} ;
           <https://cori.systems/core#read> ${read} .
    `).getQuads())
}
const book = (id, ...topics) => ({ id, title: [id], topic: topics })

// A small catalogue double: supplies matches and historical counts, leaving all
// ordering, history extraction and selection decisions to the production runner.
function catalogue(t, docs, { failHistory = false } = {}) {
    const requests = []
    const matches = (doc, q) => [...q.matchAll(/topic:"([^"]+)"/g)].some(m => doc.topic.includes(m[1]))
    t.mock.method(globalThis, "fetch", async (url, init) => {
        assert.equal(url, endpoint, "queries and history must stay out of the URL")
        assert.equal(init.method, "POST")
        assert.equal(init.headers["Content-Type"], "application/x-www-form-urlencoded")
        const p = new URLSearchParams(init.body)
        requests.push(p)
        const previous = new Set((p.get("previousIds") ?? "").split(p.get("previousSeparator") ?? "\n"))
        if (p.has("json.facet")) {
            if (failHistory) return { ok: false, status: 503 }
            const history = docs.filter(d => previous.has(d.id))
            const facets = Object.fromEntries(Object.entries(JSON.parse(p.get("json.facet")))
                .map(([key, { q }]) => [key, { count: history.filter(d => matches(d, q)).length }]))
            return { ok: true, json: async () => ({ facets, response: { docs: [] } }) }
        }
        const q = p.get("q")
        const combined = [...p].filter(([key]) => key.startsWith("profileMatch")).map(([, value]) => value)
        const found = docs.filter(d => (q.startsWith("{!bool")
            ? combined.filter(clause => matches(d, clause)).length >= 2 : matches(d, q))
            && !previous.has(d.id) && !p.getAll("fq").includes(`-id:"${d.id}"`))
        return { ok: true, json: async () => ({ response: { docs: found.slice(0, Number(p.get("rows"))), numFound: found.length } }) }
    })
    return requests
}

test("seven topics rotate fairly on repeated checks, including after dismissal", async t => {
    const names = ["Astronomie", "Biologie", "Computer", "Design", "Energie", "Fotografie", "Schlaf"]
    const store = topicProfile(names)
    const docs = names.flatMap(name => [1, 2, 3, 4].map(n => book(name + n, name)))
    catalogue(t, docs)
    const run = async () => (await runRecommendations(store, subject, { solrEndpoint: endpoint })).results[0].docs
    const first = await run()
    assert.deepEqual(first.map(d => d.topic[0]), names.slice(0, 6))
    remember(store, first.slice(0, 3), strategy.label, true)
    remember(store, first.slice(3))
    const second = await run()
    assert.equal(second[0].topic[0], "Schlaf", "the previously unrepresented topic gets the first turn")
    assert.ok(second.every(d => !first.some(old => old.id === d.id)))
    remember(store, second)
    const third = await run()
    assert.deepEqual(third.slice(0, 2).map(d => d.topic[0]), ["Fotografie", "Schlaf"])
    assert.ok(third.every(d => ![...first, ...second].some(old => old.id === d.id)))
})

test("combined books count for both topics in the current selection and in history", async t => {
    const names = ["A", "B", "C", "D", "E", "F", "G"]
    const store = topicProfile(names)
    const combo = book("combo", "A", "B")
    const docs = [combo, ...names.flatMap(name => [1, 2].map(n => book(name + n, name)))]
    catalogue(t, docs)
    const first = (await runRecommendations(store, subject, { solrEndpoint: endpoint })).results[0].docs
    assert.deepEqual(first.map(d => d.id), ["combo", "C1", "D1", "E1", "F1", "G1"])
    assert.deepEqual([...new Set(first.flatMap(d => d.topic))].sort(), names)

    const threeTopics = topicProfile(["A", "B", "C"])
    remember(threeTopics, [combo], strategy.label, true)
    remember(threeTopics, [combo]) // duplicate messages still count once per book
    const next = (await runRecommendations(threeTopics, subject, { solrEndpoint: endpoint })).results[0].docs
    assert.equal(next[0].id, "C1", "the historical combination already covered A and B")
    assert.ok(next.every(d => d.id !== "combo"))
})

test("history stays lane-specific and catalogue totals still include past suggestions", async t => {
    const store = topicProfile(["A", "B"])
    const a = book("a", "A"), b = book("b", "B")
    catalogue(t, [a, b])
    remember(store, [a])
    remember(store, [b], "Another lane", true)
    const next = (await runRecommendations(store, subject, { solrEndpoint: endpoint })).results[0].docs
    assert.deepEqual(next.map(d => d.id), ["b"])
    assert.equal(await countStrategyMatches(strategy, store, subject, endpoint), 2)
    assert.deepEqual(buildQuery(strategy, store, subject).fq, [])
})

test("large histories use POST parameters and retain exact ids without truncation", async t => {
    const store = topicProfile(["A", "B"])
    const old = Array.from({ length: 1500 }, (_, i) => book(`AK${1000000 + i}`, "A"))
    old.push(book('punctuation,with|quotes"and\nnewline', "A"))
    remember(store, old, strategy.label, true)
    const requests = catalogue(t, [...old, book("new", "B")])
    const result = await runRecommendations(store, subject, { solrEndpoint: endpoint })
    assert.deepEqual(result.results[0].docs.map(d => d.id), ["new"])
    for (const p of requests) {
        assert.ok(p.toString().length > 8192)
        assert.deepEqual(p.get("previousIds").split(p.get("previousSeparator")), old.map(d => d.id))
        assert.equal(p.getAll("fq").filter(f => f.includes("previousBooks")).length, p.has("json.facet") ? 0 : 1)
    }
})

test("a failed history count still excludes past books and uses available fresh results", async t => {
    const store = topicProfile(["A", "B"])
    remember(store, [book("old", "A")])
    catalogue(t, [book("old", "A"), book("new", "B")], { failHistory: true })
    const result = await runRecommendations(store, subject, { solrEndpoint: endpoint })
    assert.equal(result.serverUnreachable, false)
    assert.deepEqual(result.results[0].docs.map(d => d.id), ["new"])
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
    for (const lane of run.results) {
        assert.equal(buildRecommendationQueries(lane.strategy, store, subject).length, 1)
        assert.equal(buildCombinedQuery(lane.strategy, store, subject), null)
        assert.deepEqual(orderDocsByProfile(lane.docs, lane.strategy, store, subject), lane.docs)
    }
    assert.equal(buildRecommendationQueries(and, store, subject).length, 1)
    assert.equal(buildCombinedQuery(and, store, subject), null)
})

test("implausible publication years rank as missing; forthcoming books remain eligible", () => {
    const upper = new Date().getFullYear() + 1
    const docs = [
        { ...book("bad", "A"), publishDateSort: [9171] },
        { ...book("current", "A"), publishDateSort: [upper - 1] },
        { ...book("forthcoming", "A"), publishDateSort: [upper] },
        book("missing", "A"),
    ]
    const ordered = orderDocsByProfile(docs, strategy, topicProfile(["A"]), subject)
    assert.deepEqual(ordered.map(d => d.id), ["forthcoming", "current", "bad", "missing"])
})
