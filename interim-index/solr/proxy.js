// Read-only reverse proxy in front of Solr
//
// Solr is bound to 127.0.0.1 (see docker-compose.yml) and unreachable from the
// internet directly. This proxy is the only public-facing door, and it only
// forwards GET/POST to `/solr/<core>/select` and `/solr/<core>/get`. Every
// other path returns 404 before touching Solr — so /update, /admin/*, /config,
// /schema, etc. are out of reach for anything coming through a tunnel.
//
// Developers still talk to Solr directly locally on localhost:8983 (admin UI, imports) without auth

import http from "http"

const UPSTREAM = "http://127.0.0.1:8983"
const UPSTREAM_HOST = new URL(UPSTREAM).host
const PORT = 8984

const ALLOW = [
    /^\/solr\/[^/]+\/select(?:\?|$)/,
    /^\/solr\/[^/]+\/get(?:\?|$)/,
]

http.createServer((req, res) => {
    const methodOk = req.method === "GET" || req.method === "POST" || req.method === "HEAD"
    const pathOk = ALLOW.some(re => re.test(req.url))
    const ts = new Date().toISOString()
    if (!methodOk || !pathOk) {
        console.log(`${ts} BLOCK ${req.method} ${req.url.split("?")[0]}`)
        res.writeHead(404, { "content-type": "text/plain" })
        res.end("Not found\n")
        return
    }
    const endpoint = req.url.match(/\/solr\/[^/]+\/(select|get)\b/)?.[1] ?? "?"
    console.log(`${ts} PASS  ${req.method} ${endpoint}`)
    const up = http.request(UPSTREAM + req.url, {
        method: req.method,
        headers: { ...req.headers, host: UPSTREAM_HOST },
    }, upRes => {
        res.writeHead(upRes.statusCode, {
            ...upRes.headers,
            "access-control-allow-origin": "*",
        })
        upRes.pipe(res)
    })
    up.on("error", err => {
        res.writeHead(502, { "content-type": "text/plain" })
        res.end(`Upstream error: ${err.message}\n`)
    })
    req.pipe(up)
}).listen(PORT, () => console.log(`Solr read-proxy on http://localhost:${PORT}`))
