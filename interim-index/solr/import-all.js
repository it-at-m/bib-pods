import { runImport } from "../shared.js"
import path from "path"

const SOLR_URL  = "http://localhost:8983/solr/interim-index"
const SOLR_USER = "solr"
const SOLR_PASS = "SolrRocks"
const LIMIT = null
const DATA_DIR = path.join(import.meta.dirname, "..", "oai", "data")

const AUTH_HEADER = "Basic " + Buffer.from(`${SOLR_USER}:${SOLR_PASS}`).toString("base64")

async function postBatch(docs) {
    const res = await fetch(`${SOLR_URL}/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": AUTH_HEADER },
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
            headers: { "Content-Type": "application/json", "Authorization": AUTH_HEADER },
            body: JSON.stringify({ delete: { query } })
        })
        if (!res.ok) throw new Error(`Solr delete error ${res.status}: ${await res.text()}`)
    }
}

async function finalize() {
    const res = await fetch(`${SOLR_URL}/update?commit=true`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": AUTH_HEADER },
        body: "[]"
    })
    if (!res.ok) throw new Error(`Solr commit error ${res.status}`)
}

async function clearIndex() {
    const res = await fetch(`${SOLR_URL}/update?commit=true`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": AUTH_HEADER },
        body: JSON.stringify({ delete: { query: "*:*" } })
    })
    if (!res.ok) throw new Error(`Solr clear error ${res.status}: ${await res.text()}`)
    console.log("Index cleared.")
}

await runImport({ targetUrl: SOLR_URL, dataDir: DATA_DIR, limit: LIMIT, postBatch, postDeletes, finalize })
// await clearIndex()
