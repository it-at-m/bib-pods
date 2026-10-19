import test from "node:test"
import assert from "node:assert/strict"
import { parseTurtle, getProfileSubject } from "cori-sdk/utils.js"
import { BP, LOCAL, getFollowUpsFor } from "../src/vocab.js"
import { buildQuery, getStrategies, runRecommendations, SETTINGS_SUBJECT, DISABLED_STRATEGY } from "../src/recommendations.js"
import { collectOptions, dismissalChanges, bookHasOption } from "../src/book-options.js"

const subject = getProfileSubject()
const topics = getStrategies().find(s => s.iri === BP + "topicMatch")
const authors = getStrategies().find(s => s.iri === BP + "authorMatch")
const GND_ZEH = "https://d-nb.info/gnd/123456789"
const book = {
    id: "AK1",
    title: ["Unterleuten"],
    author: ["Zeh, Juli 1974-"],
    author_uri_str_mv: [GND_ZEH],
    genre: ["Gesellschaftsroman"],
    topic: ["Dorf", "Schlaf"],
}
const dismissal = await getFollowUpsFor(BP + "BookDismissal")
const spec = property => dismissal.find(s => s.property === BP + property)
const chosen = (title, ...picks) => ({
    sopacId: book.id, title, titleProperty: BP + "excludedBook",
    options: picks.map(([property, label]) => ({
        spec: spec(property),
        option: collectOptions(spec(property), book).find(o => o.cleanedLabel === label),
    })),
})

test("the dismissal dialog asks through the taste fields' index mappings", () => {
    assert.deepEqual(dismissal.map(s => [s.property, s.source]), [
        [BP + "blockedAuthor", BP + "favoriteAuthor"],
        [BP + "blockedGenre", BP + "favoriteGenre"],
        [BP + "blockedTopic", BP + "interestedIn"],
        [BP + "blockedPlace", BP + "interestedInPlace"],
    ])
    assert.deepEqual(collectOptions(spec("blockedAuthor"), book).map(o => [o.cleanedLabel, o.iri]), [["Juli Zeh", GND_ZEH]])
})

test("every ticked value is blocked, one already in the profile also removed, the title excluded", () => {
    const store = parseTurtle(`
        <${subject}> <${BP}favoriteAuthor> <${GND_ZEH}> ; <${BP}interestedIn> "Schlaf" .
        <${GND_ZEH}> <http://www.w3.org/2000/01/rdf-schema#label> "Juli Zeh" .`)
    const { remove, add } = dismissalChanges(chosen(true, ["blockedAuthor", "Juli Zeh"], ["blockedTopic", "Schlaf"], ["blockedGenre", "Gesellschaftsroman"]), store, subject)
    assert.deepEqual(remove.map(r => [r.predicate, r.object.value]), [
        [BP + "favoriteAuthor", GND_ZEH],
        [BP + "interestedIn", "Schlaf"],
    ])
    assert.deepEqual(add, [
        { predicate: BP + "excludedBook", object: "AK1" },
        { predicate: BP + "blockedAuthor", object: GND_ZEH },
        { subject: GND_ZEH, predicate: "http://www.w3.org/2000/01/rdf-schema#label", object: "Juli Zeh" },
        { predicate: BP + "blockedTopic", object: "Schlaf" },
        { predicate: BP + "blockedGenre", object: "Gesellschaftsroman" },
    ])
})

test("a taste stored under a local URN counts as already in the profile", () => {
    const urn = LOCAL + "author:" + encodeURIComponent("Zeh, Juli 1974-")
    const noIri = { ...book, author_uri_str_mv: undefined }
    const store = parseTurtle(`
        <${subject}> <${BP}favoriteAuthor> <${urn}> .
        <${urn}> <http://www.w3.org/2000/01/rdf-schema#label> "Juli Zeh" ; <${BP}sourceLabel> "Zeh, Juli 1974-" .`)
    const option = collectOptions(spec("blockedAuthor"), noIri)[0]
    const { remove, add } = dismissalChanges({ sopacId: "AK1", title: false, options: [{ spec: spec("blockedAuthor"), option }] }, store, subject)
    assert.deepEqual(remove.map(r => r.object.value), [urn])
    assert.deepEqual(add.map(a => [a.subject ?? "profile", a.predicate, a.object]), [
        ["profile", BP + "blockedAuthor", urn],
        [urn, "http://www.w3.org/2000/01/rdf-schema#label", "Juli Zeh"],
        [urn, BP + "sourceLabel", "Zeh, Juli 1974-"],
    ])
})

test("excluded titles and blocked values constrain every Solr lane", () => {
    const store = parseTurtle(`
        <${subject}> <${BP}interestedIn> "Dorf" ; <${BP}excludedBook> "AK1" ;
            <${BP}blockedAuthor> <${GND_ZEH}> ; <${BP}blockedGenre> "Krimi" .`)
    const { fq } = buildQuery(topics, store, subject)
    assert.ok(fq.includes('-id:"AK1"'))
    assert.ok(fq.includes(`-(author_uri_str_mv:"${GND_ZEH}" OR author2_uri_str_mv:"${GND_ZEH}")`))
    assert.ok(fq.includes('-(genre:"Krimi")'))
})

test("authors under a local URN query and block by their raw index form", () => {
    const urn = LOCAL + "author:" + encodeURIComponent("Zeh, Juli 1974-")
    const store = parseTurtle(`
        <${subject}> <${BP}favoriteAuthor> <${urn}> ; <${BP}blockedAuthor> <${urn}x> .
        <${urn}> <${BP}sourceLabel> "Zeh, Juli 1974-" .
        <${urn}x> <${BP}sourceLabel> "Musterfrau, Erika" .`)
    const query = buildQuery(authors, store, subject)
    assert.equal(query.q, '(author:"Zeh, Juli 1974-" OR author2:"Zeh, Juli 1974-")')
    assert.ok(query.fq.includes('-(author:"Musterfrau, Erika" OR author2:"Musterfrau, Erika")'))
})

test("the inspira lane leaves out excluded titles", async t => {
    const store = parseTurtle(`
        <${subject}> <${BP}savedBook> "AK7" ; <${BP}excludedBook> "AK2" .
        <${SETTINGS_SUBJECT}> <${DISABLED_STRATEGY}> <${BP}authorMatch>, <${BP}topicMatch> .`)
    t.mock.method(globalThis, "fetch", async () => ({
        ok: true, status: 200,
        json: async () => ({ basedOn: ["7"], points: ["2", "3"].map(akkey => ({ id: akkey, payload: { metadata: { akkey, title: "T" + akkey } } })) }),
    }))
    const run = await runRecommendations(store, subject, { solrEndpoint: "https://index.example/select", qdrantEndpoint: "https://inspira.example/api/recommend" })
    assert.deepEqual(run.results.find(r => r.strategy.iri === BP + "savedBookSimilarity").docs.map(d => d.id), ["AK3"])
})

test("a dismissed value takes every book carrying it off the shelf", () => {
    const { spec: authorSpec, option } = chosen(false, ["blockedAuthor", "Juli Zeh"]).options[0]
    assert.ok(bookHasOption(authorSpec, option, { id: "AK9", author2: ["Zeh, Juli 1974-"] }))
    assert.ok(bookHasOption(authorSpec, option, { id: "AK8", author_uri_str_mv: [GND_ZEH] }))
    assert.ok(!bookHasOption(authorSpec, option, { id: "AK7", author: ["Zeh, David"] }))
})

test("the inspira lane drops books the index finds under a blocked value, and keeps them if it can't answer", async t => {
    const store = parseTurtle(`
        <${subject}> <${BP}savedBook> "AK7" ; <${BP}blockedAuthor> <${GND_ZEH}> .
        <${SETTINGS_SUBJECT}> <${DISABLED_STRATEGY}> <${BP}authorMatch>, <${BP}topicMatch> .`)
    let solrUp = true
    const asked = []
    t.mock.method(globalThis, "fetch", async (url, init) => {
        if (url.includes("inspira")) return {
            ok: true, status: 200,
            json: async () => ({ basedOn: ["7"], points: ["2", "3"].map(akkey => ({ id: akkey, payload: { metadata: { akkey } } })) }),
        }
        const p = new URLSearchParams(init.body)
        asked.push(p)
        if (!solrUp) return { ok: false, status: 503 }
        return { ok: true, json: async () => ({ response: { docs: [{ id: "AK3" }] } }) }
    })
    const lane = async () => (await runRecommendations(store, subject, { solrEndpoint: "https://index.example/select", qdrantEndpoint: "https://inspira.example/api/recommend" }))
        .results.find(r => r.strategy.iri === BP + "savedBookSimilarity").docs.map(d => d.id)
    assert.deepEqual(await lane(), ["AK3"])
    assert.equal(asked[0].get("laneIds"), "AK2,AK3")
    assert.ok(asked[0].getAll("fq").includes(`-(author_uri_str_mv:"${GND_ZEH}" OR author2_uri_str_mv:"${GND_ZEH}")`))
    solrUp = false
    assert.deepEqual(await lane(), ["AK2", "AK3"])
})
