import { runImport } from "../shared.js"

const SOLR_URL = "http://localhost:8983/solr/interim-index"
const LIMIT = 10

async function postBatch(docs) {
    const res = await fetch(`${SOLR_URL}/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(docs)
    })
    if (!res.ok) throw new Error(`Solr update error ${res.status}: ${await res.text()}`)
}

async function finalize() {
    const res = await fetch(`${SOLR_URL}/update?commit=true`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "[]"
    })
    if (!res.ok) throw new Error(`Solr commit error ${res.status}`)
}

await runImport({ targetUrl: SOLR_URL, limit: LIMIT, postBatch, finalize })
