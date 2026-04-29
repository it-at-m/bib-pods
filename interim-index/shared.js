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

// Field names and source mappings follow standard VuFind MARC mappings:
// https://github.com/vufind-org/vufind/blob/dev/import/marc.properties

const ALPHA_CODE = /^[a-z]$/

function controlField(marc, tag) {
    return marc.controlfield?.find(f => f["@_tag"] === tag)?.["#text"] ?? null
}

function subfields(marc, tag, code) {
    return (marc.datafield ?? [])
        .filter(f => f["@_tag"] === tag)
        .flatMap(f => (f.subfield ?? []).filter(s => s["@_code"] === code).map(s => String(s["#text"] ?? "")))
        .filter(Boolean)
}

// VuFind getAllAlphaSubfields: per datafield with one of `tags`, join the text of
// every alphabetic-coded subfield with `sep`. Returns one string per datafield.
function allAlphaSubfields(marc, tags, sep = " ") {
    const want = new Set(tags)
    return (marc.datafield ?? [])
        .filter(f => want.has(f["@_tag"]))
        .map(f => (f.subfield ?? [])
            .filter(s => ALPHA_CODE.test(s["@_code"]))
            .map(s => String(s["#text"] ?? "").trim())
            .filter(Boolean)
            .join(sep))
        .filter(Boolean)
}

// Per datafield with the given tag, take only the listed subfield codes and join.
function fieldSubfields(marc, tag, codes, sep = " ") {
    const want = new Set(codes.split(""))
    return (marc.datafield ?? [])
        .filter(f => f["@_tag"] === tag)
        .map(f => (f.subfield ?? [])
            .filter(s => want.has(s["@_code"]))
            .map(s => String(s["#text"] ?? "").trim())
            .filter(Boolean)
            .join(sep))
        .filter(Boolean)
}

function first(arr) {
    return arr[0] ?? null
}

// Strip trailing ISBD punctuation (" /", " :", " ;") that MARC libraries append.
function trimEndPunct(s) {
    return s?.replace(/\s*[/:;,]\s*$/, "").trim() || null
}

// VuFind language: 008[35-37] + 041 a/d/h/j
function languageCodes(marc) {
    const codes = new Set()
    const f008 = controlField(marc, "008") ?? ""
    const lang008 = f008.slice(35, 38).trim()
    if (lang008.length === 3) codes.add(lang008)
    for (const code of ["a", "d", "h", "j"]) {
        for (const v of subfields(marc, "041", code)) codes.add(v.trim())
    }
    return [...codes].filter(Boolean)
}

// VuFind getDates: 4-digit years from 264c, 260c, then 008[7-10].
function getDates(marc) {
    const years = []
    const seen = new Set()
    const add = (y) => { if (/^\d{4}$/.test(y) && !seen.has(y)) { seen.add(y); years.push(y) } }
    for (const v of subfields(marc, "264", "c")) { const m = v.match(/\d{4}/); if (m) add(m[0]) }
    for (const v of subfields(marc, "260", "c")) { const m = v.match(/\d{4}/); if (m) add(m[0]) }
    const f008 = controlField(marc, "008") ?? ""
    add(f008.slice(7, 11).trim())
    return years
}

// https://www.loc.gov/marc/bibliographic
function mapRecord(oaiRecord) {
    const marc = oaiRecord.metadata.record[0]

    const title_short = trimEndPunct(first(subfields(marc, "245", "a")))
    const title_sub   = trimEndPunct(first(subfields(marc, "245", "b")))
    const title       = [title_short, title_sub].filter(Boolean).join(" : ") || null

    const dates = getDates(marc)

    return {
        id:               controlField(marc, "001"),

        // Title (VuFind: title=245ab, title_short=245a, title_sub=245b, title_alt=…)
        title,
        title_short,
        title_sub,
        title_alt:        [
            ...allAlphaSubfields(marc, ["246"]),
            ...subfields(marc, "240", "a"),
            ...subfields(marc, "730", "a"),
        ],

        // Authors (VuFind: author=100abcqd, author2=700abcqd, author_corporate=110/111/710/711)
        author:           fieldSubfields(marc, "100", "abcqd"),
        author2:          fieldSubfields(marc, "700", "abcqd"),
        author_corporate: allAlphaSubfields(marc, ["110", "111", "710", "711"]),

        // Publication (VuFind: publisher, publishDate, publishDateSort, edition)
        publisher:        [
            ...subfields(marc, "264", "b"),
            ...subfields(marc, "260", "b"),
        ],
        publishDate:      dates,
        publishDateSort:  dates[0] ?? null,
        edition:          first(subfields(marc, "250", "a")),

        // Physical (VuFind: physical=300abcefg)
        physical:         fieldSubfields(marc, "300", "abcefg"),

        // Identifiers (VuFind: isbn=020a:773z, issn=022a)
        isbn:             [...subfields(marc, "020", "a"), ...subfields(marc, "773", "z")],
        issn:             subfields(marc, "022", "a"),

        // Language (VuFind: language=008[35-37]:041a:041d:041h:041j)
        language:         languageCodes(marc),

        // Subjects (VuFind: topic, genre, geographic, era as alpha-subfields)
        topic:            allAlphaSubfields(marc, ["600", "610", "611", "630", "650", "653", "656"]),
        genre:            allAlphaSubfields(marc, ["655"]),
        geographic:       allAlphaSubfields(marc, ["651"]),
        era:              allAlphaSubfields(marc, ["648"]),

        // Series (VuFind: series=800abcdfpqt:830ap, series2=490a)
        series:           allAlphaSubfields(marc, ["800", "830"]),
        series2:          subfields(marc, "490", "a"),

        // Misc (VuFind: contents=505a:505t, url=856u:555u)
        contents:         [...subfields(marc, "505", "a"), ...subfields(marc, "505", "t")],
        url:              [...subfields(marc, "856", "u"), ...subfields(marc, "555", "u")],

        // Non-VuFind: OAI setSpec → mapped to institution per VuFind convention
        institution:      oaiRecord.header.setSpec ?? [],
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
