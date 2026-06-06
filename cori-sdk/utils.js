import { addTriple, storeToTurtle, storeFromTurtles } from "@foerderfunke/sem-ops-utils/core"
import coriVocabTtl from "./definitions/vocabulary.ttl.js"

export const RDFS = "http://www.w3.org/2000/01/rdf-schema#"
export const RDFS_LABEL = RDFS + "label"
export const CORI = "https://cori.systems/core#"
export const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type"

export function getProfileSubject() {
    return CORI + "defaultProfile" // apps might want to overwrite this
}

export const PREFIXES = {
    cori: CORI, rdfs: RDFS,
    rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    xsd: "http://www.w3.org/2001/XMLSchema#"
}

export function registerPrefix(prefix, base) {
    PREFIXES[prefix] = base
}

let vocabStore = null
const extraVocabTtls = []

export function registerVocab(ttl) {
    extraVocabTtls.push(ttl)
    vocabStore = null
}

export function getVocab() {
    if (!vocabStore) vocabStore = storeFromTurtles([coriVocabTtl, ...extraVocabTtls])
    return vocabStore
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
    const labels = getVocab().getObjects(uri, RDFS_LABEL, null)
    return labels.find(t => t.language === "de")?.value ?? labels[0]?.value
}

export function mintMessageUri() {
    return CORI + "msg-" + Math.random().toString(36).slice(2, 7)
}

// User-facing message for a failed storage operation. fetch rejects with
// TypeError on network-level failure, i.e. the storage backend (e.g. the
// user's pod server) is unreachable — application-level errors carry a
// meaningful message of their own.
export function storageErrorMessage(err) {
    return err instanceof TypeError ? "Der Speicherort ist gerade nicht erreichbar." : (err?.message ?? String(err))
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
