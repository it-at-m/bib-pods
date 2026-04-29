import { XMLParser } from "fast-xml-parser"
import path from "path"
import fs from "fs"

const DATA_DIR = path.join(import.meta.dirname, "oai", "data")
const CURSOR_FILE = path.join(import.meta.dirname, ".import-cursor.json")

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

// https://www.loc.gov/marc/bibliographic
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

async function postWithRetry(postBatch, docs, attempts = 5) {
    let delay = 1000
    for (let i = 0; i < attempts; i++) {
        try { return await postBatch(docs) }
        catch (err) {
            if (i === attempts - 1) throw err
            console.warn(`  POST failed (attempt ${i + 1}/${attempts}): ${err.message}. Retrying in ${delay}ms`)
            await new Promise(r => setTimeout(r, delay))
            delay *= 2
        }
    }
}

function readCursorMap() {
    if (!fs.existsSync(CURSOR_FILE)) return {}
    try { return JSON.parse(fs.readFileSync(CURSOR_FILE, "utf8")) }
    catch { return {} }
}

function saveCursor(targetUrl, lastFile) {
    const data = readCursorMap()
    data[targetUrl] = lastFile
    fs.writeFileSync(CURSOR_FILE, JSON.stringify(data))
}

function clearCursor(targetUrl) {
    const data = readCursorMap()
    delete data[targetUrl]
    if (Object.keys(data).length === 0 && fs.existsSync(CURSOR_FILE)) fs.unlinkSync(CURSOR_FILE)
    else fs.writeFileSync(CURSOR_FILE, JSON.stringify(data))
}

export async function runImport({ targetUrl, batchSize = 2000, postBatch, finalize }) {
    const allFiles = fs.readdirSync(DATA_DIR)
        .filter(f => f.endsWith(".xml"))
        .sort()
        .map(f => path.join(DATA_DIR, f))

    const cursor = readCursorMap()[targetUrl]
    const cursorIdx = cursor ? allFiles.indexOf(cursor) : -1
    const startIdx = cursorIdx >= 0 ? cursorIdx + 1 : 0
    const files = allFiles.slice(startIdx)

    if (cursor && cursorIdx < 0) console.warn(`Cursor refers to unknown file ${cursor}, starting from beginning`)
    if (cursor && cursorIdx >= 0) console.log(`Resuming after ${path.basename(cursor)} (${files.length} of ${allFiles.length} files remaining)`)
    console.log(`Indexing ${files.length} file(s) into ${targetUrl}...`)

    let total = 0
    let batch = []
    let lastFullyParsedFileIdx = -1   // absolute index into allFiles
    let inFlight = Promise.resolve()
    let inFlightTag = -1               // file idx fully covered by batch currently in flight

    // Pipelined flush: while one batch is being POSTed, the main loop continues parsing
    // the next batch. Cursor is advanced only after a batch's POST acks, so on crash we
    // resume from a file whose records are all durable in the index.
    async function flush() {
        if (batch.length === 0) return
        const toSend = batch
        batch = []
        const tag = lastFullyParsedFileIdx
        await inFlight
        if (inFlightTag >= 0) saveCursor(targetUrl, allFiles[inFlightTag])
        inFlightTag = tag
        const sendCount = toSend.length
        inFlight = postWithRetry(postBatch, toSend).then(() => {
            total += sendCount
            console.log(`  Indexed ${total} records`)
        })
    }

    for (let i = 0; i < files.length; i++) {
        const xml = await fs.promises.readFile(files[i], "utf8")
        const parsed = parser.parse(xml)
        const oaiRecords = parsed["OAI-PMH"]?.ListRecords?.record ?? []

        for (const oaiRecord of oaiRecords) {
            const doc = mapRecord(oaiRecord)
            if (!doc.id) continue
            batch.push(doc)
            if (batch.length >= batchSize) await flush()
        }

        lastFullyParsedFileIdx = startIdx + i
    }

    await flush()
    await inFlight
    if (inFlightTag >= 0) saveCursor(targetUrl, allFiles[inFlightTag])

    await finalize()
    clearCursor(targetUrl)
    console.log(`Done. ${total} records indexed.`)
}
