const SOLR_URL = "http://localhost:8983/solr/interim-index"

const params1 = {
    q:      "author:Sapkowski",
    fl:     "id,title,author,publishDate,topic"
}

const params2 = {
    q:      "genre:Musikdruck AND author:Weill AND title:Kurt",
    rows:   10,
    start:  0,
    fl:     "id,title,author,publishDate,genre"
}

async function query(params) {
    const url = `${SOLR_URL}/select?${new URLSearchParams(params)}`
    const res = await fetch(url)
    const { response } = await res.json()
    console.log(`Found ${response.numFound} results\n`)
    for (const doc of response.docs) {
        console.log(doc)
    }
}

console.log("--- Query 1: by author ---")
await query(params1)

console.log("\n--- Query 2: genre + author + keyword ---")
await query(params2)
