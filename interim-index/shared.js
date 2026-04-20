import { XMLParser } from "fast-xml-parser"
import path from "path"
import fs from "fs"

const DATA_DIR = path.join(import.meta.dirname, "oai", "data")

const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    isArray: (name) => ["record", "controlfield", "datafield", "subfield", "setSpec"].includes(name)
})

function controlField(marc, tag) {
    return marc.controlfield?.find(f => f["@_tag"] === tag)?.["#text"] ?? null
}

function subfields(marc, tag, code) {
    return (marc.datafield ?? [])
        .filter(f => f["@_tag"] === tag)
        .flatMap(f => (f.subfield ?? []).filter(s => s["@_code"] === code).map(s => String(s["#text"] ?? "")))
        .filter(Boolean)
}

function first(arr) {
    return arr[0] ?? null
}

function mapRecord(oaiRecord) {
    const marc = oaiRecord.metadata.record[0]
    const field008 = controlField(marc, "008") ?? ""

    return {
        id:             controlField(marc, "001"),
        title:          first(subfields(marc, "245", "a"))?.replace(/ [/:]$/, "").trim(),
        title_variant:  subfields(marc, "246", "a"),
        subtitle:       first(subfields(marc, "245", "b"))?.replace(/ [/:]$/, "").trim(),
        authors:        [...subfields(marc, "100", "a"), ...subfields(marc, "700", "a")],
        year:           (first(subfields(marc, "264", "c")) ?? first(subfields(marc, "260", "c")) ?? (field008.slice(7, 11).trim() || null))?.replace(/\D/g, "") || null,
        edition:        first(subfields(marc, "250", "a")),
        publisher:      first(subfields(marc, "264", "b")) ?? first(subfields(marc, "260", "b")),
        place:          first(subfields(marc, "264", "a")) ?? first(subfields(marc, "260", "a")),
        isbn:           subfields(marc, "020", "a"),
        languages:      subfields(marc, "041", "a"),
        subjects:       [...subfields(marc, "650", "a"), ...subfields(marc, "689", "a")],
        subjects_geo:   subfields(marc, "651", "a"),
        subjects_person: subfields(marc, "600", "a"),
        genre:          subfields(marc, "655", "a"),
        audience:       first(subfields(marc, "521", "a")),
        summary:        first(subfields(marc, "520", "a")),
        series:         [...subfields(marc, "490", "a"), ...subfields(marc, "830", "a")],
        extent:         first(subfields(marc, "300", "a")),
        libraries:      oaiRecord.header.setSpec ?? [],
    }
}

export async function runImport({ targetUrl, batchSize = 500, postBatch, finalize }) {
    const files = fs.readdirSync(DATA_DIR)
        .filter(f => f.endsWith(".xml"))
        .sort()
        .map(f => path.join(DATA_DIR, f))

    console.log(`Indexing ${files.length} file(s) into ${targetUrl}...`)

    let total = 0
    let batch = []

    for (const file of files) {
        const xml = fs.readFileSync(file, "utf8")
        const parsed = parser.parse(xml)
        const oaiRecords = parsed["OAI-PMH"]?.ListRecords?.record ?? []

        for (const oaiRecord of oaiRecords) {
            const doc = mapRecord(oaiRecord)
            if (!doc.id) continue
            batch.push(doc)

            if (batch.length >= batchSize) {
                await postBatch(batch)
                total += batch.length
                console.log(`  Indexed ${total} records`)
                batch = []
            }
        }
    }

    if (batch.length > 0) {
        await postBatch(batch)
        total += batch.length
    }

    await finalize()
    console.log(`Done. ${total} records indexed.`)
}
