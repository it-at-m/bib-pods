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

    const progress = totalSize ? `${cursor + 50 > totalSize ? totalSize : cursor + 50}/${totalSize}` : `page ${page}`
    console.log(`  Saved ${outFile} (${progress} records)`)
} while (token && page < MAX_PAGES)

console.log(`Done. ${page} pages written to ${OUT_DIR}`)
