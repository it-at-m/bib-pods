// The title search of the "Titel hinzufügen" card: one line per work, with its media.
import test from "node:test"
import assert from "node:assert/strict"
import { suggestBooks, searchTitles } from "../src/catalogue.js"
import { indexOffering } from "./index-fields.js"

const endpoint = "https://index.example/select"
const record = (id, title, format, work_key) => ({ id, title: [title], author: ["Herrndorf, Wolfgang"], format: [format], ...(work_key ? { work_key: [work_key] } : {}) })
const TSCHICK = "tschick|herrndorf wolfgang"

// The index: `found` answers the search (GET), `ofWorks` the question for the works' records (POST).
function catalogue(t, found, ofWorks = [], total = found.length) {
    const asked = []
    t.mock.method(globalThis, "fetch", async (url, init) => {
        const params = init?.body ?? new URL(url).searchParams
        asked.push(params)
        return { ok: true, json: async () => ({ response: init?.body ? { docs: ofWorks } : { docs: found, numFound: total } }) }
    })
    return asked
}

test("the records of one work show as one line that names its media, the best-ranked first", async t => {
    indexOffering("work_key")
    const asked = catalogue(t, [
        record("print", "Tschick : Roman", "Druckschrift", TSCHICK),
        record("ebook", "Tschick", "E-Book", TSCHICK),
        record("film", "Tschick", "DVD-Video"),
    ], [
        { work_key: [TSCHICK], format: ["Druckschrift"] }, { work_key: [TSCHICK], format: ["E-Book"] },
        { work_key: [TSCHICK], format: ["E-Audio"] },
        // the phrase also finds a longer key: not this work
        { work_key: ["wolfgang herrndorf tschick|herrndorf wolfgang"], format: ["CD"] },
    ])
    const { docs, total } = await suggestBooks(endpoint, "tschick")
    assert.deepEqual(docs.map(d => [d.id, d.media]), [["print", ["Druckschrift", "E-Audio", "E-Book"]], ["film", undefined]])
    assert.equal(total, 2)
    assert.equal(asked[1].get("q"), `work_key:"${TSCHICK}"`)
})

test("an index without work keys shows one line per title, author and medium, and asks nothing further", async t => {
    indexOffering()
    const asked = catalogue(t, [
        record("print", "Tschick", "Druckschrift"), record("reprint", "Tschick", "Druckschrift"), record("ebook", "Tschick", "E-Book"),
    ])
    const { docs } = await searchTitles(endpoint, "tschick")
    assert.deepEqual(docs.map(d => d.id), ["print", "ebook"])
    assert.equal(asked.length, 1)
    assert.equal(asked[0].get("boost"), null)
})

test("more records than were read keep the catalogue's total; typed syntax reaches the index as words", async t => {
    indexOffering("copies")
    const asked = catalogue(t, [record("a", "Harry", "Druckschrift")], [], 1598)
    assert.equal((await suggestBooks(endpoint, 'harry" OR (pot')).total, 1598)
    assert.equal(asked[0].get("q"), "harry or (pot OR pot*)")
    assert.equal(asked[0].get("uf"), "-*")
    assert.ok(asked[0].get("boost"))
})

test("lines stay as they are when the index does not answer for the media", async t => {
    indexOffering("work_key")
    t.mock.method(console, "error", () => {})
    t.mock.method(globalThis, "fetch", async (url, init) => init?.body
        ? { ok: false, status: 503 }
        : { ok: true, json: async () => ({ response: { docs: [record("print", "Tschick", "Druckschrift", TSCHICK)], numFound: 1 } }) })
    const { docs } = await suggestBooks(endpoint, "tschick")
    assert.deepEqual(docs.map(d => [d.id, d.media]), [["print", undefined]])
})
