const ES_URL = "http://localhost:9200/interim-index"

const body1 = {
    query: { match: { authors: "Sapkowski" } },
    _source: ["title", "authors", "year", "subjects"]
}

const body2 = {
    query: {
        bool: {
            must: [
                { match: { genre: "Musikdruck" } },
                { match: { authors: "Weill" } },
                { match: { title: "Kurt" } }
            ]
        }
    },
    size: 10,
    from: 0,
    _source: ["title", "authors", "year", "genre"]
}

async function query(body) {
    const res = await fetch(`${ES_URL}/_search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    })
    const { hits } = await res.json()
    console.log(`Found ${hits.total.value} results\n`)
    for (const h of hits.hits) {
        console.log({ id: h._id, ...h._source })
    }
}

console.log("--- Query 1: by author ---")
await query(body1)

console.log("\n--- Query 2: genre + author + keyword ---")
await query(body2)
