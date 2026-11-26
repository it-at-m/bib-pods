// mapRecord on hand-built records: the fields a record's content type (336), age
// statement (521), copy count (876) and title/author yield.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mapRecord } from "../shared.js"

// An OAI record in the shape the XML parser hands to mapRecord.
// fields: [tag, { code: value | [values] }], e.g. ["245", { a: "Momo", h: "[Druckschrift]" }]
function record(fields) {
    const datafield = fields.map(([tag, subs]) => ({
        "@_tag": tag,
        subfield: Object.entries(subs).flatMap(([code, value]) =>
            [].concat(value).map(text => ({ "@_code": code, "#text": text }))),
    }))
    return {
        header: { identifier: "oai:test:1", setSpec: ["DE-M36"] },
        metadata: { record: [{ controlfield: [{ "@_tag": "001", "#text": "AK1" }], datafield }] },
    }
}

const content = (code, label) => ["336", { a: label, b: code, 2: "rdacontent" }]
const TEXT = content("txt", "Text")
const SPOKEN = content("spw", "gesprochenes Wort")
const FILM = content("tdi", "zweidimensionales bewegtes Bild")

test("content type: labels and LoC IRIs, position-aligned", () => {
    const doc = mapRecord(record([["245", { a: "Momo", h: "[CD]" }], SPOKEN, TEXT]))
    assert.deepEqual(doc.content, ["gesprochenes Wort", "Text"])
    assert.deepEqual(doc.content_uri_str_mv, [
        "https://id.loc.gov/vocabulary/contentTypes/spw",
        "https://id.loc.gov/vocabulary/contentTypes/txt",
    ])
})

test("content type: a 336 from another vocabulary is not one", () => {
    const doc = mapRecord(record([["245", { a: "Momo" }], ["336", { a: "Text", b: "txt", 2: "other" }]]))
    assert.deepEqual(doc.content, [])
    assert.deepEqual(doc.content_uri_str_mv, [])
})

test("age: a recommendation on a book", () => {
    const doc = mapRecord(record([["245", { a: "Momo", h: "[Druckschrift]" }], TEXT, ["521", { a: "ab 8" }]]))
    assert.equal(doc.audience_age, 8)
    assert.equal("age_rating" in doc, false)
})

test("age: a recommendation on records without a content type, and with stray spaces", () => {
    assert.equal(mapRecord(record([["245", { a: "Hörspiel", h: "[CD]" }], ["521", { a: "ab  4" }]])).audience_age, 4)
})

test("age: a rating on a film", () => {
    const doc = mapRecord(record([["245", { a: "Film", h: "[DVD-Video]" }], FILM, ["521", { a: "ab 12" }]]))
    assert.equal(doc.age_rating, 12)
    assert.equal("audience_age" in doc, false)
})

test("age: 'ab 0' is a rating like any other", () => {
    assert.equal(mapRecord(record([["245", { a: "Film" }], FILM, ["521", { a: "ab 0" }]])).age_rating, 0)
})

test("age: none without 521, none for other wordings", () => {
    const none = mapRecord(record([["245", { a: "Momo" }], TEXT]))
    assert.equal("audience_age" in none || "age_rating" in none, false)
    const other = mapRecord(record([["245", { a: "Momo" }], TEXT, ["521", { a: "Erwachsene" }]]))
    assert.equal("audience_age" in other || "age_rating" in other, false)
})

test("copies: the number in 876$t, also when the parser hands it over as a number", () => {
    assert.equal(mapRecord(record([["245", { a: "Momo" }], ["876", { t: "31" }]])).copies, 31)
    assert.equal(mapRecord(record([["245", { a: "Momo" }], ["876", { t: 3 }]])).copies, 3)
    assert.equal(mapRecord(record([["245", { a: "Momo" }]])).copies, null)
    assert.equal(mapRecord(record([["245", { a: "Momo" }], ["876", { t: "x" }]])).copies, null)
})

test("work key: title and author, whatever the medium, punctuation or accents", () => {
    const print = mapRecord(record([
        ["100", { a: "Wahl, Caroline", d: "1995-" }],
        ["245", { a: "Die Assistentin :", b: "Roman", h: "[Druckschrift]" }],
    ]))
    const ebook = mapRecord(record([
        ["100", { a: "Wahl, Caroline" }],
        ["245", { a: "Die Assistentin | Der neue Roman der Bestsellerautorin", h: "[E-Book]" }],
    ]))
    assert.equal(print.work_key, "die assistentin|wahl caroline")
    assert.equal(ebook.work_key, print.work_key)
    const accents = mapRecord(record([["100", { a: "Nesbø, Jo" }], ["245", { a: "Blutmond" }]]))
    const folded = mapRecord(record([["100", { a: "Nesbø,  Jo" }], ["245", { a: "Blutmond /" }]]))
    assert.equal(accents.work_key, folded.work_key)
    const e = mapRecord(record([["100", { a: "Zeh, Juli" }], ["245", { a: "Über Menschen" }]]))
    assert.equal(e.work_key, "uber menschen|zeh juli")
})

test("work key: the volumes of one work stay apart", () => {
    const volume = n => mapRecord(record([
        ["100", { a: "Martin, George R. R." }],
        ["245", { a: "Das Lied von Eis und Feuer", n: `${n}.`, p: "Band" }],
    ])).work_key
    assert.notEqual(volume(1), volume(2))
    assert.equal(volume(1), "das lied von eis und feuer 1 band|martin george r r")
})

test("work key: a volume named at the start of the subtitle keeps volumes apart", () => {
    const volume = b => mapRecord(record([["100", { a: "Koike, Kazuo" }], ["245", { a: "Lone wolf & cub :", b }]])).work_key
    assert.equal(volume("Bd. 1"), "lone wolf cub 1|koike kazuo")
    assert.notEqual(volume("Bd. 1"), volume("Bd. 10"))
    assert.equal(volume("2a. Die Duloz-Plattenfehler"), "lone wolf cub 2a|koike kazuo")
    // one part, however it is written
    assert.equal(volume("Band 2"), volume("Bd. 2"))
    assert.equal(volume("2. Der Aufbruch"), volume("Bd. 2"))
    assert.equal(volume("2 /"), volume("Bd. 2"))
})

test("work key: a subtitle that starts with a word or a figure names no part", () => {
    const key = b => mapRecord(record([["100", { a: "Koike, Kazuo" }], ["245", { a: "Lone wolf & cub :", b }]])).work_key
    const plain = "lone wolf cub|koike kazuo"
    assert.equal(key("Roman"), plain)
    assert.equal(key("Bandsalat und andere Geschichten"), plain)
    assert.equal(key("50 süße Rezepte für kleine Formen"), plain)
    assert.equal(key("1844-1910"), plain)
    assert.equal(key("46.000 Kilometer Roadtrip durch Afrika"), plain)
    assert.equal(key("7.-10. Klasse"), plain)
})

test("work key: none without a main author or a title", () => {
    assert.equal(mapRecord(record([["245", { a: "Italien" }]])).work_key, null)
    assert.equal(mapRecord(record([["100", { a: "Zeh, Juli" }], ["245", { h: "[CD]" }]])).work_key, null)
})

test("work key: other scripts keep their letters", () => {
    const doc = mapRecord(record([["100", { a: "Толстой, Лев" }], ["245", { a: "Война и мир" }]]))
    assert.equal(doc.work_key, "воина и мир|толстои лев")
})
