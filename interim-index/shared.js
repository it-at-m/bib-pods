import { XMLParser } from "fast-xml-parser"
import path from "path"
import fs from "fs"

const DEFAULT_DATA_DIR = path.join(import.meta.dirname, "oai", "data")
const CURSOR_FILE = path.join(import.meta.dirname, ".import-cursor.json")

const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    isArray: (name) => ["record", "controlfield", "datafield", "subfield", "setSpec"].includes(name)
})

// Field names and source mappings follow standard VuFind MARC mappings:
// https://github.com/vufind-org/vufind/blob/dev/import/marc.properties
// Everything we know about this mapping — MSB/German-specific MARC content,
// deliberate omissions, measured coverage, schema caveats — is collected in
// ./field-notes.md.

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

// Base URIs by source-vocabulary code carried in $2. Extend as new vocabularies appear.
const AUTHORITY_BASES = {
    gnd:  "https://d-nb.info/gnd/",
    lcsh: "http://id.loc.gov/authorities/subjects/",
    fast: "http://id.worldcat.org/fast/",
}

// Sentinel emitted when a label has no resolvable authority IRI. Uses the RFC 2606
// reserved `.invalid` TLD so it is guaranteed never to resolve. Not "" because Solr's
// JSON update handler silently drops empty strings from multiValued arrays, which
// would break positional alignment with the parallel label array.
const NO_IRI = "https://unknown.invalid/"

// Per datafield with one of `tags`, mint a resolvable authority IRI from $0 + $2.
// $0 typically holds `(DE-XXX)…` where DE-XXX is the MARC organization code of the
// authority maintaining the record; the prefix is dropped because the URI base
// already identifies the authority. $2 names the vocabulary (gnd/lcsh/fast/…).
// If $0 is already a full http(s) URI it passes through. MSB occasionally omits
// $2 on 1xx/6xx but always uses (DE-588)… — DE-588 is the MARC organization code
// (ISIL) of the GND, the Deutsche Nationalbibliothek's authority file — so we infer
// GND from that prefix as a dataset-specific fallback. Unresolvable entries become NO_IRI so the array stays
// position-aligned with the parallel label array (e.g. author2_uri_str_mv[i] is
// always about author2[i]); consumers treat NO_IRI as "no IRI for this entry".
function authorityUris(marc, tags) {
    const want = new Set(tags)
    const out = []
    for (const f of marc.datafield ?? []) {
        if (!want.has(f["@_tag"])) continue
        const subs = f.subfield ?? []
        const raw0 = subs.find(s => s["@_code"] === "0")?.["#text"]
        if (!raw0) { out.push(NO_IRI); continue }
        const v0 = String(raw0).trim()
        if (/^https?:\/\//i.test(v0)) { out.push(v0); continue }
        const vocab = String(subs.find(s => s["@_code"] === "2")?.["#text"] ?? "").trim().toLowerCase()
        const base = AUTHORITY_BASES[vocab] ?? (v0.startsWith("(DE-588)") ? AUTHORITY_BASES.gnd : null)
        if (!base) { out.push(NO_IRI); continue }
        out.push(base + v0.replace(/^\([^)]+\)/, ""))
    }
    return out
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

// Münchner Stadtbibliothek records the medium as an RDA carrier type in 338:
// $b = a 2-letter code, $2 = "rdacarrier". cr = Online-Ressource is the online
// digital offering (the material complete=true pulls in); cd = CD-ROM and
// cb = cartridge are offline digital media; the rest is non-digital (nc volume,
// sd audio disc, vd videodisc, ss cassette, …).
// https://id.loc.gov/vocabulary/carriers.html
function rdaCarrierCodes(marc) {
    return (marc.datafield ?? [])
        .filter(f => f["@_tag"] === "338"
            && String((f.subfield ?? []).find(s => s["@_code"] === "2")?.["#text"] ?? "") === "rdacarrier")
        .map(f => String((f.subfield ?? []).find(s => s["@_code"] === "b")?.["#text"] ?? "").trim())
        .filter(code => /^[a-z]{2}$/.test(code))
}

// Resolvable LoC IRI per RDA carrier code (id.loc.gov 303-redirects each, e.g.
// cr → online resource). Mirrors authorityUris: mint IRIs at index time rather
// than pushing bare codes onto consumers.
const RDA_CARRIER_BASE = "https://id.loc.gov/vocabulary/carriers/"

// Münchner Stadtbibliothek's own human-readable medium designator from 245$h,
// e.g. "E-Paper", "Druckschrift", "CD", "Buch + CD". The square brackets are the
// GMD/ISBD convention; strip them for a clean display/facet value. This is the
// readable counterpart to the machine-readable carrier IRI in format_uri_str_mv.
function mediumLabel(marc) {
    const h = first(subfields(marc, "245", "h"))
    return h ? (h.replace(/^\s*\[|\]\s*$/g, "").trim() || null) : null
}

// Onleihe mediaInfo URLs carry the divibib media id as the third dash-segment after
// the comma; mirrors bib-src/src/decorate-cards.js's ONLEIHE_RE, which extracts the
// same id client-side from a clicked link. Indexing it here lets that click resolve
// straight to this record via `onleihe_id:<id>` instead of only being logged. Not
// guaranteed unique — the same id occasionally appears on more than one record (the
// same holding re-imported over time) — but any match is an equally valid resolution
// since duplicates share the same bibliographic data; callers can just take the first.
const ONLEIHE_RE = /onleihe\.de\/.+\/mediaInfo,\d+-\d+-(\d+)-/

function onleiheIds(marc) {
    return subfields(marc, "856", "u")
        .map(u => u.match(ONLEIHE_RE)?.[1])
        .filter(Boolean)
}

// https://www.loc.gov/marc/bibliographic
function mapRecord(oaiRecord) {
    const marc = oaiRecord.metadata.record[0]

    const title_short = trimEndPunct(first(subfields(marc, "245", "a")))
    const title_sub   = trimEndPunct(first(subfields(marc, "245", "b")))
    const title       = [title_short, title_sub].filter(Boolean).join(" : ") || null

    const dates = getDates(marc)
    const carriers = rdaCarrierCodes(marc)

    return {
        id:               controlField(marc, "001"),
        oai_identifier:   oaiRecord.header?.identifier ?? null,

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
        author:                      fieldSubfields(marc, "100", "abcqd"),
        author2:                     fieldSubfields(marc, "700", "abcqd"),
        author_corporate:            allAlphaSubfields(marc, ["110", "111", "710", "711"]),
        author_uri_str_mv:           authorityUris(marc, ["100"]),
        author2_uri_str_mv:          authorityUris(marc, ["700"]),
        author_corporate_uri_str_mv: authorityUris(marc, ["110", "111", "710", "711"]),

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

        // Medium: MSB's readable 245$h label, plus the RDA carrier (338) as a
        // resolvable IRI and an electronic flag. electronic = online resource (cr);
        // physical carriers — incl. offline digital media like CD/DVD-ROM (cd) and
        // cartridges (cb) — stay false.
        format:            mediumLabel(marc),
        format_uri_str_mv: carriers.map(c => RDA_CARRIER_BASE + c),
        electronic:        carriers.includes("cr"),

        // Identifiers (VuFind: isbn=020a:773z, issn=022a)
        isbn:             [...subfields(marc, "020", "a"), ...subfields(marc, "773", "z")],
        issn:             subfields(marc, "022", "a"),

        // Language (VuFind: language=008[35-37]:041a:041d:041h:041j)
        language:         languageCodes(marc),

        // Subjects (VuFind: topic, genre, geographic, era as alpha-subfields).
        // The RSWK subject chains (689) are deliberately not mapped — MSB's
        // export already materializes them into these 6xx fields; see
        // field-notes.md for the measurements behind that decision.
        topic:                 allAlphaSubfields(marc, ["600", "610", "611", "630", "650", "653", "656"]),
        genre:                 allAlphaSubfields(marc, ["655"]),
        geographic:            allAlphaSubfields(marc, ["651"]),
        era:                   allAlphaSubfields(marc, ["648"]),
        topic_uri_str_mv:      authorityUris(marc, ["600", "610", "611", "630", "650", "653", "656"]),
        genre_uri_str_mv:      authorityUris(marc, ["655"]),
        geographic_uri_str_mv: authorityUris(marc, ["651"]),
        era_uri_str_mv:        authorityUris(marc, ["648"]),

        // Series (VuFind: series=800abcdfpqt:830ap, series2=490a).
        // Cannot use allAlphaSubfields here: 800/830 carry $w (record control number
        // of the linked series authority) which is alphabetic and would otherwise
        // leak into the display string. MSB e.g. 830$w="(DE-M36)AK1120883".
        series:           [
            ...fieldSubfields(marc, "800", "abcdfpqt"),
            ...fieldSubfields(marc, "830", "ap"),
        ],
        series2:          subfields(marc, "490", "a"),

        // Misc (VuFind: contents=505a:505t, url=856u:555u)
        contents:         [...subfields(marc, "505", "a"), ...subfields(marc, "505", "t")],
        url:              [...subfields(marc, "856", "u"), ...subfields(marc, "555", "u")],
        onleihe_id:       onleiheIds(marc),

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

function saveCursor(cursorKey, lastFile) {
    const data = readCursorMap()
    data[cursorKey] = lastFile
    fs.writeFileSync(CURSOR_FILE, JSON.stringify(data))
}

export function clearImportCursor({ targetUrl, dataDir = DEFAULT_DATA_DIR }) {
    const cursorKey = `${targetUrl}::${dataDir}`
    const data = readCursorMap()
    if (!(cursorKey in data)) return
    delete data[cursorKey]
    if (Object.keys(data).length === 0 && fs.existsSync(CURSOR_FILE)) fs.unlinkSync(CURSOR_FILE)
    else fs.writeFileSync(CURSOR_FILE, JSON.stringify(data))
}

function formatDuration(sec) {
    if (!isFinite(sec) || sec < 0) return "?"
    if (sec < 60) return `${Math.round(sec)}s`
    if (sec < 3600) return `${Math.floor(sec / 60)}m${String(Math.round(sec % 60)).padStart(2, "0")}s`
    return `${Math.floor(sec / 3600)}h${String(Math.floor((sec % 3600) / 60)).padStart(2, "0")}m`
}

export async function runImport({
    targetUrl,
    dataDir = DEFAULT_DATA_DIR,
    batchSize = 2000,
    limit = null,
    postBatch,
    postDeletes,
    finalize,
}) {
    const testMode = limit != null
    const cursorKey = `${targetUrl}::${dataDir}`

    const allFiles = fs.readdirSync(dataDir)
        .filter(f => f.endsWith(".xml"))
        .sort()
        .map(f => path.join(dataDir, f))

    const cursor = testMode ? null : readCursorMap()[cursorKey]
    const cursorIdx = cursor ? allFiles.indexOf(cursor) : -1
    const startIdx = cursorIdx >= 0 ? cursorIdx + 1 : 0
    let files = allFiles.slice(startIdx)
    if (testMode) files = files.slice(0, limit)

    if (cursor && cursorIdx < 0) console.warn(`Cursor refers to unknown file ${cursor}, starting from beginning`)
    if (cursor && cursorIdx >= 0) console.log(`Resuming after ${path.basename(cursor)} (${files.length} of ${allFiles.length} files remaining)`)
    if (testMode) console.log(`TEST MODE: limited to first ${files.length} file(s); cursor is not read or written`)
    console.log(`Indexing ${files.length} file(s) from ${dataDir} (of ${allFiles.length} total) into ${targetUrl}, batch size ${batchSize}...`)

    const startTime = Date.now()
    let total = 0
    let batch = []
    const deletedOaiIds = []
    let lastFullyParsedFileIdx = -1   // absolute index into allFiles
    let inFlight = Promise.resolve()
    let inFlightTag = -1               // file idx fully covered by batch currently in flight

    function logProgress(filesDoneAbs) {
        const filesDone = Math.max(0, filesDoneAbs - startIdx + 1)
        const elapsed = (Date.now() - startTime) / 1000
        const rate = elapsed > 0 ? total / elapsed : 0
        const eta = filesDone > 0 ? elapsed * (files.length - filesDone) / filesDone : Infinity
        console.log(`  [file ${filesDone}/${files.length}] ${total.toLocaleString()} records · ${Math.round(rate).toLocaleString()}/s · elapsed ${formatDuration(elapsed)} · ETA ${formatDuration(eta)}`)
    }

    // Pipelined flush: while one batch is being POSTed, the main loop continues parsing
    // the next batch. Cursor is advanced only after a batch's POST acks. It is NOT
    // cleared on successful completion, so it doubles as (a) the resume point after a
    // crash and (b) a persistent high-water mark — a later run picks up only files
    // added past it. Use clearImportCursor() to reset (e.g. when reseeding the index).
    async function flush() {
        if (batch.length === 0) return
        const toSend = batch
        batch = []
        const tag = lastFullyParsedFileIdx
        await inFlight
        if (!testMode && inFlightTag >= 0) saveCursor(cursorKey, allFiles[inFlightTag])
        inFlightTag = tag
        const sendCount = toSend.length
        const myTag = tag
        inFlight = postWithRetry(postBatch, toSend).then(() => {
            total += sendCount
            logProgress(myTag)
        })
    }

    for (let i = 0; i < files.length; i++) {
        const xml = await fs.promises.readFile(files[i], "utf8")
        const parsed = parser.parse(xml)
        const oaiRecords = parsed["OAI-PMH"]?.ListRecords?.record ?? []

        for (const oaiRecord of oaiRecords) {
            if (oaiRecord.header?.["@_status"] === "deleted") {
                const oaiId = oaiRecord.header.identifier
                if (oaiId) deletedOaiIds.push(oaiId)
                continue
            }
            const doc = mapRecord(oaiRecord)
            if (!doc.id) continue
            batch.push(doc)
            if (batch.length >= batchSize) await flush()
        }

        lastFullyParsedFileIdx = startIdx + i
    }

    await flush()
    await inFlight
    if (!testMode && inFlightTag >= 0) saveCursor(cursorKey, allFiles[inFlightTag])

    if (deletedOaiIds.length > 0) {
        if (postDeletes) {
            console.log(`Deleting ${deletedOaiIds.length.toLocaleString()} record(s) marked deleted in OAI...`)
            await postDeletes(deletedOaiIds)
        } else {
            console.warn(`${deletedOaiIds.length} OAI deletion(s) seen but no postDeletes handler — skipping. Index may have stale records.`)
        }
    }

    console.log("Finalizing...")
    await finalize()

    const elapsed = (Date.now() - startTime) / 1000
    const rate = elapsed > 0 ? total / elapsed : 0
    console.log(`Done. ${total.toLocaleString()} records indexed, ${deletedOaiIds.length.toLocaleString()} deleted in ${formatDuration(elapsed)} (${Math.round(rate).toLocaleString()}/s).`)
}
