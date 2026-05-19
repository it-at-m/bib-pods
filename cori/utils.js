import { newStore, addTriple, storeToTurtle, storeFromTurtles, sparqlSelect } from "@foerderfunke/sem-ops-utils"
import vocabularyTtl from "../definitions/vocabulary.ttl?raw"

export const RDFS = "http://www.w3.org/2000/01/rdf-schema#"
export const RDFS_LABEL = RDFS + "label"
let vocabStore = null
function getVocabStore() {
    if (!vocabStore) vocabStore = parseTurtle(vocabularyTtl)
    return vocabStore
}

export const EX = "http://example.org/"
export const BP = "https://www.muenchner-stadtbibliothek.de/bib-pods#"
export const GND = "https://d-nb.info/gnd/"
// URN base for locally minted identifiers (e.g. authors without authority IRIs)
export const LOCAL = "urn:bibpods:"
export const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type"
// sentinel emitted by the indexer for unresolvable authority entries,
// so *_uri_str_mv arrays stay position-aligned with their label counterparts.
// we treat it as "no IRI for this entry"
export const NO_IRI = "https://unknown.invalid/"
export const PREFIXES = {
    ex: EX,
    bp: BP,
    gnd: GND,
    rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    rdfs: RDFS,
    xsd: "http://www.w3.org/2001/XMLSchema#",
}

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
    const labels = getVocabStore().getObjects(uri, RDFS_LABEL, null)
    return labels.find(t => t.language === "de")?.value ?? labels[0]?.value
}

// collects the follow-up questions declared on a bp:UserAction in the vocabulary
export async function getFollowUpsFor(actionUri) {
    const rows = await sparqlSelect(`
        PREFIX bp: <${BP}>
        PREFIX rdfs: <${RDFS}>
        SELECT ?property ?label ?labelField ?iriField WHERE {
            <${actionUri}> bp:followUpQuestion ?property .
            ?property bp:linkedToIndex ?link .
            ?link bp:labelField ?labelField .
            OPTIONAL { ?link bp:iriField ?iriField }
            OPTIONAL { ?property rdfs:label ?label . FILTER(lang(?label) = "de") }
        }`, [getVocabStore()])
    const byProperty = new Map()
    for (const r of rows) {
        if (!byProperty.has(r.property)) {
            byProperty.set(r.property, {
                property: r.property,
                label: r.label ?? contractTerm(r.property),
                fields: [],
            })
        }
        byProperty.get(r.property).fields.push({
            labelField: r.labelField,
            iriField: r.iriField,
        })
    }
    return [...byProperty.values()]
}

// Dev-only seeds. Invoked manually via window.bibPods.addTestProfile() / addTestMessages()

export function seedProfile(store) {
    const me = EX + "me"
    addTriple(store, me, BP + "favoriteWork", "Moby-Dick")
    addTriple(store, me, BP + "favoriteAuthor", "Herman Melville")
    addTriple(store, me, BP + "favoriteGenre", "Roman")
    addTriple(store, me, BP + "interestedIn", "Wale")
}

export function seedMessages(store) {
    const n = subjectsOfType(store, BP + "Message").length
    seedMessage(store, mintMessageUri(), "Testnachricht " + (n + 1))
    seedMessage(store, mintMessageUri(), "Testnachricht " + (n + 2))
}

function seedMessage(store, uri, content) {
    addTriple(store, uri, RDF_TYPE, BP + "Message")
    addTriple(store, uri, BP + "content", content)
    addTriple(store, uri, BP + "read", "false")
}

export function mintMessageUri() {
    return EX + "msg-" + Math.random().toString(36).slice(2, 7)
}

// --- Graph helpers ---

export function subjectsOfType(store, typeIri) {
    return store.getSubjects(RDF_TYPE, typeIri, null).map(t => t.value)
}

// if multiple values exist, returns the first one
export function getOne(store, subject, predicate) {
    return store.getObjects(subject, predicate, null)[0]?.value
}

export function replaceProperty(store, subject, predicate, value) {
    for (const q of store.getQuads(subject, predicate, null, null)) {
        store.removeQuad(q)
    }
    addTriple(store, subject, predicate, value)
}

export function parseTurtle(text) {
    return storeFromTurtles([text])
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
