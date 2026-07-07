// Minimal HTTP endpoint exposing the recommendation engine the browser plugin uses.

import { runRecommendations } from "bib-src/src/recommendations.js"
import { parseTurtle, getProfileSubject } from "cori-sdk/utils.js"
import { loadConfig } from "bib-src/src/build-config.js"
import http from "http"

const PORT = 8985
const SOLR = loadConfig().solrEndpoint

const CORS = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
}

http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
        res.writeHead(204, CORS)
        res.end()
        return
    }
    const url = new URL(req.url, "http://localhost")
    if (req.method === "POST" && url.pathname === "/recommendations") {
        try {
            const ttl = await readBody(req)
            if (!ttl.trim()) throw new Error("empty request body; expected a profile in Turtle")
            const store = parseTurtle(ttl)
            // TODO broken since runRecommendations switched to an { solrEndpoint, qdrantEndpoint }
            const results = await runRecommendations(store, getProfileSubject(), SOLR, 5)
            // or should we return the same turtle messages as result?
            send(res, 200, {
                results: results.map(({ strategy, docs }) => ({
                    strategy: { iri: strategy.iri, label: strategy.label },
                    docs,
                })),
            })
        } catch (err) {
            console.error("[bib-api]", err)
            send(res, 400, { error: err.message })
        }
        return
    }
    send(res, 404, { error: "Not found" })
}).listen(PORT, () => console.log(`bib-api on http://localhost:${PORT} → Solr ${SOLR}`))

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = []
        req.on("data", c => chunks.push(c))
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
        req.on("error", reject)
    })
}

function send(res, status, payload) {
    res.writeHead(status, { "content-type": "application/json", ...CORS })
    res.end(JSON.stringify(payload))
}
