import { newStore, addTriple, storeToTurtle, parser } from "@foerderfunke/sem-ops-utils"

export const EX = "http://example.org/"
const PREFIXES = { ex: EX }

export function parseTurtle(text) {
    const store = newStore()
    if (text) parser.parse(text).forEach(q => store.addQuad(q))
    return store
}

export function serializeTurtle(store) {
    return storeToTurtle(store, PREFIXES)
}

export async function querySolrCount(endpoint) {
    const res = await fetch(`${endpoint}?q=*:*&rows=0&wt=json`)
    if (!res.ok) throw new Error(`Solr ${res.status}: ${res.statusText}`)
    const json = await res.json()
    return json.response.numFound
}

export async function buildDemoTurtle() {
    const store = newStore()
    addTriple(store, EX + "alice", "http://xmlns.com/foaf/0.1/knows", EX + "bob")
    return storeToTurtle(store, {
        ex: EX,
        foaf: "http://xmlns.com/foaf/0.1/",
    })
}
