import path from "path"
import fs from "fs"

const BASE_URL = "https://data-bib.muenchen.de/oai-pmh"
const METADATA_PREFIX = "marc_xml" // "oai_dc"
const SET = "DE-M36"
/*
DE-M36: Gesamtbestand
DE-M36b: Musikbibliothek
DE-M36c: Juristische Bibliothek
DE-M36d: Philatelistische Bibliothek
DE-M36e: Monacensia Bibliothek
*/
const MAX_PAGES = 3
const OUT_DIR = path.join(import.meta.dirname, "data")
fs.mkdirSync(OUT_DIR, { recursive: true })

async function fetchPage(url) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
    return res.text()
}

function extractResumptionToken(xml) {
    const m = xml.match(/<resumptionToken[^>]*>([^<]+)<\/resumptionToken>/)
    return m ? m[1].trim() : null
}

function extractCursor(xml) {
    const m = xml.match(/cursor="(\d+)"/)
    return m ? parseInt(m[1], 10) : null
}

function extractCompleteListSize(xml) {
    const m = xml.match(/completeListSize="(\d+)"/)
    return m ? parseInt(m[1], 10) : null
}

let page = 0
let token = null
let totalSize = null

const startedAt = Date.now()

function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms < 0) return "unknown"

    const totalSeconds = Math.round(ms / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60

    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
    if (minutes > 0) return `${minutes}m ${seconds}s`
    return `${seconds}s`
}

function formatProgress(done, total, elapsedMs) {
    if (!total || total <= 0) return `page ${page}, elapsed ${formatDuration(elapsedMs)}, ETA unknown`

    const percentage = Math.min(100, (done / total) * 100)
    const estimatedTotalMs = done > 0 ? elapsedMs / done * total : Infinity
    const remainingMs = estimatedTotalMs - elapsedMs

    return `${done}/${total} records (${percentage.toFixed(1)}%), elapsed ${formatDuration(elapsedMs)}, ETA ${formatDuration(remainingMs)}`
}

console.log(`Downloading OAI-PMH catalog: set=${SET}, format=${METADATA_PREFIX}`)

do {
    const url = token
        ? `${BASE_URL}?verb=ListRecords&resumptionToken=${encodeURIComponent(token)}`
        : `${BASE_URL}?verb=ListRecords&metadataPrefix=${METADATA_PREFIX}&set=${SET}`
    const xml = await fetchPage(url)

    if (xml.includes("<error")) {
        const err = xml.match(/<error[^>]*>([^<]+)/)?.[1] ?? "unknown error"
        throw new Error(`OAI error: ${err}`)
    }

    if (totalSize === null) totalSize = extractCompleteListSize(xml)
    const cursor = extractCursor(xml) ?? page * 50

    const outFile = path.join(OUT_DIR, `page-${String(page).padStart(6, "0")}.xml`)
    fs.writeFileSync(outFile, xml)

    token = extractResumptionToken(xml)
    page ++

    const elapsedMs = Date.now() - startedAt
    const recordsDone = totalSize ? Math.min(cursor + 50, totalSize) : null
    const progress = formatProgress(recordsDone, totalSize, elapsedMs)
    console.log(`  Saved ${outFile} (${progress})`)
} while (token && page < MAX_PAGES)

console.log(`Done. ${page} pages written to ${OUT_DIR} in ${formatDuration(Date.now() - startedAt)}`)
