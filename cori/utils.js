import { newStore, addTriple, storeToTurtle, parser } from "@foerderfunke/sem-ops-utils"
import vocabularyTtl from "../definitions/vocabulary.ttl?raw"

const RDFS_LABEL = "http://www.w3.org/2000/01/rdf-schema#label"
let labels = null

export const EX = "http://example.org/"
export const BP = "https://www.muenchner-stadtbibliothek.de/bib-pods#"
export const PREFIXES = { ex: EX, bp: BP }

export function expandTerm(token) {
    const colonIdx = token.indexOf(":")
    if (colonIdx === -1) return token
    const scheme = token.slice(0, colonIdx)
    return scheme in PREFIXES ? PREFIXES[scheme] + token.slice(colonIdx + 1) : token
}

export function contractTerm(uri) {
    for (const [prefix, base] of Object.entries(PREFIXES)) {
        if (uri.startsWith(base)) return `${prefix}:${uri.slice(base.length)}`
    }
    return uri
}

export function getLabel(uri) {
    if (!labels) {
        labels = new Map()
        const store = parseTurtle(vocabularyTtl)
        for (const q of store.getQuads(null, RDFS_LABEL, null, null)) {
            labels.set(q.subject.value, q.object.value)
        }
    }
    return labels.get(uri)
}

// for dev purposes
export function seedStore(store) {
    const me = EX + "me"
    addTriple(store, me, BP + "favoriteWork", "Moby-Dick")
    addTriple(store, me, BP + "favoriteAuthor", "Herman Melville")
    addTriple(store, me, BP + "favoriteGenre", "Roman")
    addTriple(store, me, BP + "interestedIn", "Wale")
}

export function parseTurtle(text) {
    const store = newStore()
    if (text) parser.parse(text).forEach(q => store.addQuad(q))
    return store
}

export function serializeTurtle(store) {
    return storeToTurtle(store, PREFIXES)
}

export async function fetchBook(endpoint, id) {
    const res = await fetch(`${endpoint}?q=id:${encodeURIComponent(id)}&wt=json`)
    if (!res.ok) throw new Error(`Solr ${res.status}: ${res.statusText}`)
    const json = await res.json()
    return json.response.docs[0]
}

export async function buildDemoTurtle() {
    const store = newStore()
    addTriple(store, EX + "alice", "http://xmlns.com/foaf/0.1/knows", EX + "bob")
    return storeToTurtle(store, {
        ex: EX,
        foaf: "http://xmlns.com/foaf/0.1/",
    })
}
