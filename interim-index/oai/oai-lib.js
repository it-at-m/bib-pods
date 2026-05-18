import path from "path"
import fs from "fs"

const DEFAULT_BASE_URL = "https://data-bib.muenchen.de/oai-pmh"
const DEFAULT_SET = "DE-M36"
const DEFAULT_METADATA_PREFIX = "marc_xml"

export function extractResumptionToken(xml) {
    const m = xml.match(/<resumptionToken[^>]*>([^<]+)<\/resumptionToken>/)
    return m ? m[1].trim() : null
}

export function extractCursor(xml) {
    const m = xml.match(/cursor="(\d+)"/)
    return m ? parseInt(m[1], 10) : null
}

export function extractCompleteListSize(xml) {
    const m = xml.match(/completeListSize="(\d+)"/)
    return m ? parseInt(m[1], 10) : null
}

export function extractOaiError(xml) {
    const match = xml.match(/<error[^>]*code="([^"]+)"[^>]*>([^<]*)<\/error>/)
    if (!match) return null
    return { code: match[1], message: match[2]?.trim() || "unknown error" }
}

export async function fetchPage(url) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
    return res.text()
}

export function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms < 0) return "unknown"
    const totalSeconds = Math.round(ms / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
    if (minutes > 0) return `${minutes}m ${seconds}s`
    return `${seconds}s`
}

export function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return "unknown"
    const units = ["B", "KB", "MB", "GB"]
    let i = 0
    let value = bytes
    while (value >= 1024 && i < units.length - 1) {
        value /= 1024
        i++
    }
    return `${value.toFixed(1)} ${units[i]}`
}

export function formatProgress(done, total, elapsedMs, currentPage) {
    if (!total || total <= 0) return `page ${currentPage}, elapsed ${formatDuration(elapsedMs)}, ETA unknown`
    const percentage = Math.min(100, (done / total) * 100)
    const estimatedTotalMs = done > 0 ? elapsedMs / done * total : Infinity
    const remainingMs = estimatedTotalMs - elapsedMs
    return `${done}/${total} records (${percentage.toFixed(1)}%), elapsed ${formatDuration(elapsedMs)}, ETA ${formatDuration(remainingMs)}`
}

export async function harvest({
    outDir,
    from = null,
    startPage = 0,
    baseUrl = DEFAULT_BASE_URL,
    set = DEFAULT_SET,
    metadataPrefix = DEFAULT_METADATA_PREFIX,
    maxPages = Infinity,
}) {
    if (!outDir) throw new Error("outDir is required")
    fs.mkdirSync(outDir, { recursive: true })

    let page = startPage
    let token = null
    let totalSize = null
    let totalBytesDownloaded = 0
    let estimatedTotalBytes = null
    const startedAt = Date.now()

    console.log(`Downloading OAI-PMH catalog: set=${set}, format=${metadataPrefix}${from ? `, from=${from}` : ""}`)

    do {
        const url = token
            ? `${baseUrl}?verb=ListRecords&resumptionToken=${encodeURIComponent(token)}`
            : `${baseUrl}?verb=ListRecords&metadataPrefix=${metadataPrefix}&set=${set}${from ? `&from=${from}` : ""}`
        const xml = await fetchPage(url)
        totalBytesDownloaded += Buffer.byteLength(xml, "utf8")

        const oaiError = extractOaiError(xml)
        if (oaiError) {
            if (oaiError.code === "noRecordsMatch") {
                console.log(`No records match${from ? ` (no changes since ${from})` : ""}.`)
                break
            }
            if (oaiError.code === "badResumptionToken") {
                console.warn(`Stopping: resumption token expired after ${page} pages: ${oaiError.message}`)
                break
            }
            throw new Error(`OAI error ${oaiError.code}: ${oaiError.message}`)
        }

        if (totalSize === null) totalSize = extractCompleteListSize(xml)

        const cursor = extractCursor(xml) ?? page * 50
        const recordsDoneForEstimate = totalSize ? Math.min(cursor + 50, totalSize) : null

        if (recordsDoneForEstimate && totalSize) {
            const avgBytesPerRecord = totalBytesDownloaded / recordsDoneForEstimate
            estimatedTotalBytes = avgBytesPerRecord * totalSize
        }

        const outFile = path.join(outDir, `page-${String(page).padStart(6, "0")}.xml`)
        fs.writeFileSync(outFile, xml)

        token = extractResumptionToken(xml)
        page++

        const elapsedMs = Date.now() - startedAt
        const progress = formatProgress(recordsDoneForEstimate, totalSize, elapsedMs, page)
        const sizeInfo = estimatedTotalBytes
            ? `${formatBytes(totalBytesDownloaded)} / ~${formatBytes(estimatedTotalBytes)}`
            : `${formatBytes(totalBytesDownloaded)} downloaded`
        console.log(`  Saved ${outFile} (${progress}, ${sizeInfo})`)
    } while (token && page < maxPages)

    console.log(`Done. ${page} pages written to ${outDir} in ${formatDuration(Date.now() - startedAt)}`)
}
