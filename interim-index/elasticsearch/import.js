// NOTE: This script is out of date relative to the Solr workflow

import { runImport } from "../shared.js"

const ES_URL = "http://localhost:9200/interim-index"
const LIMIT = null

async function postBatch(docs) {
    const body = docs.flatMap(d => {
        const { id, ...rest } = d
        return [JSON.stringify({ index: { _id: id } }), JSON.stringify(rest)]
    }).join("\n") + "\n"
    const res = await fetch(`${ES_URL}/_bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/x-ndjson" },
        body
    })
    if (!res.ok) throw new Error(`ES bulk error ${res.status}: ${await res.text()}`)
    const json = await res.json()
    if (json.errors) throw new Error(`ES bulk item errors: ${JSON.stringify(json.items.find(i => i.index?.error))}`)
}

async function finalize() {
    const res = await fetch(`${ES_URL}/_refresh`, { method: "POST" })
    if (!res.ok) throw new Error(`ES refresh error ${res.status}`)
}

await runImport({ targetUrl: ES_URL, limit: LIMIT, postBatch, finalize })
