// Initial Solr seed. Imports every file in oai/data/. The cursor in
// .import-cursor.json persists past successful completion, so re-running
// this script with no new files is a no-op (same shape as import-incremental).
// To actually wipe and reseed, uncomment the clearIndex() call at the bottom —
// it removes both the Solr documents and this script's cursor entry.

import { runImport, clearImportCursor } from "../shared.js"
import path from "path"

const SOLR_URL  = "http://localhost:8983/solr/interim-index"
const LIMIT = null
const DATA_DIR = path.join(import.meta.dirname, "..", "oai", "data")

async function postBatch(docs) {
    const res = await fetch(`${SOLR_URL}/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(docs)
    })
    if (!res.ok) throw new Error(`Solr update error ${res.status}: ${await res.text()}`)
}

async function postDeletes(oaiIds) {
    const BATCH = 500
    for (let i = 0; i < oaiIds.length; i += BATCH) {
        const chunk = oaiIds.slice(i, i + BATCH)
        const query = chunk.map(id => `oai_identifier:"${id.replace(/"/g, '\\"')}"`).join(" OR ")
        const res = await fetch(`${SOLR_URL}/update`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ delete: { query } })
        })
        if (!res.ok) throw new Error(`Solr delete error ${res.status}: ${await res.text()}`)
    }
}

async function finalize() {
    const res = await fetch(`${SOLR_URL}/update?commit=true`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "[]"
    })
    if (!res.ok) throw new Error(`Solr commit error ${res.status}`)
}

async function clearIndex() {
    const res = await fetch(`${SOLR_URL}/update?commit=true`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delete: { query: "*:*" } })
    })
    if (!res.ok) throw new Error(`Solr clear error ${res.status}: ${await res.text()}`)
    clearImportCursor({ targetUrl: SOLR_URL, dataDir: DATA_DIR })
    console.log("Index cleared.")
}

clearImportCursor({ targetUrl: SOLR_URL, dataDir: DATA_DIR })
await runImport({ targetUrl: SOLR_URL, dataDir: DATA_DIR, limit: LIMIT, postBatch, postDeletes, finalize })
// await clearIndex()
