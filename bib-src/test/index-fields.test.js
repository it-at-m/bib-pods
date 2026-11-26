// Concepts defined by a query (age groups, "Hörbuch"), and what builds on a field not
// every index has: the works of excluded titles.
import test from "node:test"
import assert from "node:assert/strict"
import { parseTurtle, getProfileSubject, registerVocab } from "cori-sdk/utils.js"
import { BP } from "../src/vocab.js"
import { buildQuery, getStrategies, runRecommendations, selectDiverseDocs, SETTINGS_SUBJECT, DISABLED_STRATEGY } from "../src/recommendations.js"
import { indexOffering } from "./index-fields.js"

registerVocab(`
    @prefix bp: <${BP}> .
    @prefix skos: <http://www.w3.org/2004/02/skos/core#> .
    bp:test-audience-6-9 a skos:Concept ; bp:indexQuery "audience_age:[6 TO 9]" .
    bp:test-audience-adults a skos:Concept ; bp:indexQuery "(*:* -audience_age:[0 TO 15])" .
    bp:test-medium-audiobook a skos:Concept ; bp:indexQuery "content_uri_str_mv:\\"https://id.loc.gov/vocabulary/contentTypes/spw\\"" .
`)

const subject = getProfileSubject()
const topics = getStrategies().find(s => s.iri === BP + "topicMatch")
const JOIN = ids => `-_query_:"{!join from=work_key_str to=work_key_str method=topLevelDV}id:(${ids})"`

test("a concept defined by a query filters with that query, OR-ed with its neighbours", () => {
    indexOffering()
    const one = parseTurtle(`<${subject}> <${BP}interestedIn> "Dorf" ; <${BP}preferredAudience> <${BP}test-audience-6-9> .`)
    assert.deepEqual(buildQuery(topics, one, subject).fq, ["audience_age:[6 TO 9]"])
    const two = parseTurtle(`<${subject}> <${BP}interestedIn> "Dorf" ;
        <${BP}preferredAudience> <${BP}test-audience-6-9>, <${BP}test-audience-adults> .`)
    const [fq] = buildQuery(topics, two, subject).fq
    assert.ok(fq === "(audience_age:[6 TO 9] OR (*:* -audience_age:[0 TO 15]))"
        || fq === "((*:* -audience_age:[0 TO 15]) OR audience_age:[6 TO 9])")
})

test("a query-defined concept takes the place of the field's own index mapping", () => {
    indexOffering()
    const store = parseTurtle(`<${subject}> <${BP}interestedIn> "Dorf" ;
        <${BP}preferredMedium> <${BP}test-medium-audiobook>, <${BP}medium-E-Book> .`)
    const [fq] = buildQuery(topics, store, subject).fq
    assert.ok(fq.includes('content_uri_str_mv:"https://id.loc.gov/vocabulary/contentTypes/spw"'))
    assert.ok(fq.includes('format:"E-Book"'))
    assert.ok(!fq.includes("format:\"https://"), "the concept's IRI is not looked for in the medium field")
})

test("an index without work keys excludes titles by id only", () => {
    indexOffering()
    const store = parseTurtle(`<${subject}> <${BP}interestedIn> "Dorf" ; <${BP}savedBook> "AK42" .`)
    assert.deepEqual(buildQuery(topics, store, subject).fq, ['-id:"AK42"'])
})

test("an index with work keys also drops the other editions of excluded titles", () => {
    indexOffering("work_key")
    const store = parseTurtle(`<${subject}> <${BP}interestedIn> "Dorf" ; <${BP}savedBook> "AK42" ; <${BP}excludedBook> "AK7" .`)
    const { fq } = buildQuery(topics, store, subject)
    assert.ok(fq.includes('-id:"AK42"') && fq.includes('-id:"AK7"'))
    assert.equal(fq.filter(f => f.includes("{!join")).length, 1)
    assert.ok(fq.includes(JOIN("AK42 AK7")) || fq.includes(JOIN("AK7 AK42")))
})

test("only ids of the catalogue's shape reach the nested query", () => {
    indexOffering("work_key")
    const store = parseTurtle(`<${subject}> <${BP}interestedIn> "Dorf" ;
        <${BP}savedBook> "AK42", "AK1) OR *:* (", "42" .`)
    const { fq } = buildQuery(topics, store, subject)
    assert.ok(fq.includes(JOIN("AK42")))
    const noIds = parseTurtle(`<${subject}> <${BP}interestedIn> "Dorf" ; <${BP}savedBook> "42" .`)
    assert.ok(!buildQuery(topics, noIds, subject).fq.some(f => f.includes("{!join")))
})

test("the inspira lane asks the index which of its books are other editions of excluded titles", async t => {
    indexOffering("work_key")
    const store = parseTurtle(`
        <${subject}> <${BP}savedBook> "AK7" .
        <${SETTINGS_SUBJECT}> <${DISABLED_STRATEGY}> <${BP}authorMatch>, <${BP}topicMatch> .`)
    const asked = []
    t.mock.method(globalThis, "fetch", async (url, init) => {
        if (url.includes("inspira")) return {
            ok: true, status: 200,
            json: async () => ({ basedOn: ["7"], points: ["2", "3"].map(akkey => ({ id: akkey, payload: { metadata: { akkey } } })) }),
        }
        asked.push(new URLSearchParams(init.body))
        return { ok: true, json: async () => ({ response: { docs: [{ id: "AK3" }] } }) }
    })
    const run = await runRecommendations(store, subject, { solrEndpoint: "https://index.example/select", qdrantEndpoint: "https://inspira.example/api/recommend" })
    assert.deepEqual(run.results.find(r => r.strategy.iri === BP + "savedBookSimilarity").docs.map(d => d.id), ["AK3"])
    assert.equal(asked[0].get("laneIds"), "AK2,AK3")
    assert.deepEqual(asked[0].getAll("fq"), [JOIN("AK7")])
})

test("the inspira lane keeps to the profile's filters and shows a work once", async t => {
    indexOffering("work_key")
    const store = parseTurtle(`
        <${subject}> <${BP}savedBook> "AK7" ; <${BP}preferredAudience> <${BP}test-audience-6-9> .
        <${SETTINGS_SUBJECT}> <${DISABLED_STRATEGY}> <${BP}authorMatch>, <${BP}topicMatch> .`)
    const asked = []
    t.mock.method(globalThis, "fetch", async (url, init) => {
        if (url.includes("inspira")) return {
            ok: true, status: 200,
            json: async () => ({ basedOn: ["7"], points: ["2", "3", "4", "5"].map(akkey => ({ id: akkey, payload: { metadata: { akkey } } })) }),
        }
        asked.push(new URLSearchParams(init.body))
        // AK5 fails the filters; AK2 and AK3 are editions of one work
        return { ok: true, json: async () => ({ response: { docs: [
            { id: "AK2", work_key: ["momo|ende michael"] }, { id: "AK3", work_key: ["momo|ende michael"] }, { id: "AK4" },
        ] } }) }
    })
    const run = await runRecommendations(store, subject, { solrEndpoint: "https://index.example/select", qdrantEndpoint: "https://inspira.example/api/recommend" })
    assert.deepEqual(run.results.find(r => r.strategy.iri === BP + "savedBookSimilarity").docs.map(d => d.id), ["AK2", "AK4"])
    assert.deepEqual(asked[0].getAll("fq"), [JOIN("AK7"), "audience_age:[6 TO 9]"])
    assert.equal(asked[0].get("fl"), "id,work_key")
})

test("an inspira lane with nothing to check asks the index nothing", async t => {
    indexOffering()
    const store = parseTurtle(`
        <${subject}> <${BP}savedBook> "AK7" .
        <${SETTINGS_SUBJECT}> <${DISABLED_STRATEGY}> <${BP}authorMatch>, <${BP}topicMatch> .`)
    const urls = []
    t.mock.method(globalThis, "fetch", async (url) => {
        urls.push(url)
        return { ok: true, status: 200, json: async () => ({ basedOn: ["7"], points: [{ id: "2", payload: { metadata: { akkey: "2" } } }] }) }
    })
    const run = await runRecommendations(store, subject, { solrEndpoint: "https://index.example/select", qdrantEndpoint: "https://inspira.example/api/recommend" })
    assert.deepEqual(run.results.find(r => r.strategy.iri === BP + "savedBookSimilarity").docs.map(d => d.id), ["AK2"])
    assert.deepEqual(urls, ["https://inspira.example/api/recommend"])
})

test("a lane shows a work once where the index keys it, whatever the editions' subtitles", () => {
    const print = { id: "AK1", title: ["1999 Meter über dem Meer : Roman"], author: ["Wahl, Caroline"], work_key: ["1999 meter uber dem meer|wahl caroline"] }
    const audio = { id: "AK2", title: ["1999 Meter über dem Meer"], author: ["Wahl, Caroline"], work_key: ["1999 meter uber dem meer|wahl caroline"] }
    const other = { id: "AK3", title: ["Windstärke 17"], author: ["Wahl, Caroline"], work_key: ["windstarke 17|wahl caroline"] }
    assert.deepEqual(selectDiverseDocs([[print, audio, other]], 3).map(d => d.id), ["AK1", "AK3"])
})
