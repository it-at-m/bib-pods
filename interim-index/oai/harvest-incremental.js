// Reads existing data/*.xml, finds the latest <datestamp>, and runs an OAI
// ListRecords harvest with from=<latest-date>, writing pages to data-new/.
//
// Datestamps are day-granularity, so from=<latest-date> is inclusive and
// re-fetches records modified on that day. Downstream dedup by record id
// handles the overlap. Using date+1 would risk missing same-day updates,
// so the extra fetches are the safer trade.

import { harvest } from "./oai-lib.js"
import path from "path"
import fs from "fs"

const DATA_DIR = path.join(import.meta.dirname, "data")
const OUT_DIR = path.join(import.meta.dirname, "data-new")

// Reads files in reverse filename order (most recently harvested first) with
// bounded parallelism, exiting early once the running max has been stable for
// stableThreshold files. Heuristic: assumes records with the latest datestamps
// tend to cluster in later-harvested pages. Worst case (random distribution)
// just means from= ends up earlier than necessary — the diff includes some
// already-seen records, dedup handles it.
async function findLatestDatestamp(dir, { concurrency = 32, stableThreshold = 500 } = {}) {
    if (!fs.existsSync(dir)) return null
    const files = fs.readdirSync(dir).filter(f => f.endsWith(".xml")).sort().reverse()
    let latest = null
    let filesSinceUpdate = 0
    let scanned = 0

    for (let i = 0; i < files.length; i += concurrency) {
        const batch = files.slice(i, i + concurrency)
        const results = await Promise.all(batch.map(async (f) => {
            const xml = await fs.promises.readFile(path.join(dir, f), "utf8")
            let max = null
            for (const m of xml.matchAll(/<datestamp>([^<]+)<\/datestamp>/g)) {
                if (!max || m[1] > max) max = m[1]
            }
            return max
        }))

        let batchUpdated = false
        for (const max of results) {
            if (max && (!latest || max > latest)) {
                latest = max
                batchUpdated = true
            }
        }

        scanned += batch.length
        filesSinceUpdate = batchUpdated ? 0 : filesSinceUpdate + batch.length

        if (filesSinceUpdate >= stableThreshold) {
            console.log(`  scanned ${scanned}/${files.length} files; max stable for ${filesSinceUpdate} — early exit`)
            return latest
        }
    }

    console.log(`  scanned all ${scanned} files`)
    return latest
}

console.log(`Scanning ${DATA_DIR} for latest datestamp...`)
const latestDate = await findLatestDatestamp(DATA_DIR)
if (!latestDate) {
    console.error(`No datestamps found in ${DATA_DIR}. Run harvest-all.js first.`)
    process.exit(1)
}

console.log(`Latest datestamp in ${DATA_DIR}: ${latestDate}`)

fs.rmSync(OUT_DIR, { recursive: true, force: true })

await harvest({
    outDir: OUT_DIR,
    from: latestDate,
})
