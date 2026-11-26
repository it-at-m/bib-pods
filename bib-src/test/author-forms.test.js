// One author under two name forms: dated with a GND link on the library's records,
// undated without one on the Onleihe's.
import test from "node:test"
import assert from "node:assert/strict"
import { parseTurtle, getProfileSubject } from "cori-sdk/utils.js"
import { BP } from "../src/vocab.js"
import { buildQuery, getStrategies, profileFactsMatching } from "../src/recommendations.js"
import { createAssistantSource } from "../src/assistant-source.js"

const AUTHOR = BP + "favoriteAuthor"
const GND = "https://d-nb.info/gnd/1163743437"
const NO_IRI = "https://unknown.invalid/"
const subject = getProfileSubject()

// The index's answers: author facets for the search, a record for the IRI lookup.
function catalogue(t, facets) {
    t.mock.method(globalThis, "fetch", async (url, init) => {
        const params = new URLSearchParams(init.body)
        if (params.get("facet") === "true") return { ok: true, json: async () => ({ facet_counts: { facet_fields: facets } }) }
        return { ok: true, json: async () => ({ response: { docs: [{ author: ["Kemmerer, Brigid 1978-"], author_uri_str_mv: [GND] }] } }) }
    })
}

test("the undated form of a name folds into its one dated form, counts added up", async t => {
    catalogue(t, { author_str: ["Kemmerer, Brigid 1978-", 15], author2_str: ["Kemmerer, Brigid", 12] })
    const source = createAssistantSource({ solrEndpoint: "https://index.example/select" })
    const hits = await source.search(AUTHOR, "brigid kemme")
    assert.deepEqual(hits.map(h => [h.label, h.note, h.hint, h.alsoRaw]), [["Brigid Kemmerer", "1978–", "27 Titel", ["Kemmerer, Brigid"]]])
    const facts = await source.facts({ ...hits[0], field: AUTHOR })
    assert.deepEqual(facts.map(f => [f.subject ?? "profile", f.predicate, f.object]), [
        ["profile", AUTHOR, GND],
        [GND, "http://www.w3.org/2000/01/rdf-schema#label", "Brigid Kemmerer"],
        [GND, BP + "sourceLabel", "Kemmerer, Brigid"],
    ])
})

test("namesakes keep the undated form apart: it could be either of them", async t => {
    catalogue(t, { author_str: ["Müller, Anna 1965-", 9, "Müller, Anna 1988-", 4], author2_str: ["Müller, Anna", 3] })
    const source = createAssistantSource({ solrEndpoint: "https://index.example/select" })
    const hits = await source.search(AUTHOR, "anna müller")
    assert.deepEqual(hits.map(h => [h.note, h.hint]), [["1965–", "9 Titel"], ["1988–", "4 Titel"], [null, "3 Titel"]])
})

test("the author lane finds the stored value by its IRI and by its undated form", () => {
    const store = parseTurtle(`
        <${subject}> <${AUTHOR}> <${GND}> .
        <${GND}> <http://www.w3.org/2000/01/rdf-schema#label> "Brigid Kemmerer" ;
            <${BP}sourceLabel> "Kemmerer, Brigid" .`)
    const authors = getStrategies().find(s => s.iri === BP + "authorMatch")
    const { q } = buildQuery(authors, store, subject)
    assert.ok(q.includes(`author_uri_str_mv:"${GND}"`))
    assert.ok(q.includes('author2_str:"Kemmerer, Brigid"'))
    const ebook = { id: "AK4600162", author2: ["Kemmerer, Brigid"], author2_uri_str_mv: [NO_IRI] }
    assert.equal(profileFactsMatching(AUTHOR, ebook, store, subject).length, 1)
})
