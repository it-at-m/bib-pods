import { newStore, addTriple, storeToTurtle } from "@foerderfunke/sem-ops-utils"

export async function querySolrCount(endpoint) {
    const res = await fetch(`${endpoint}?q=*:*&rows=0&wt=json`)
    if (!res.ok) throw new Error(`Solr ${res.status}: ${res.statusText}`)
    const json = await res.json()
    return json.response.numFound
}

export async function buildDemoTurtle() {
    const store = newStore()
    addTriple(
        store,
        "http://example.org/alice",
        "http://xmlns.com/foaf/0.1/knows",
        "http://example.org/bob",
    )
    return await storeToTurtle(store, {
        ex: "http://example.org/",
        foaf: "http://xmlns.com/foaf/0.1/",
    })
}
