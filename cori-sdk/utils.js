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

const PROFILE_SECTION = CORI + "ProfileSection"
const IN_SECTION = CORI + "inSection"
const ORDER = CORI + "order"

// Sections with their fields, both sorted by cori:order, straight from the merged
// vocab. Plain store reads + JS sort — the bundled Comunica's multi-key ORDER BY is
// unreliable across OPTIONAL groups, and the vocab store is synchronous anyway.
export function sectionPlan() {
    const v = getVocab()
    const orderOf = iri => Number(getOne(v, iri, ORDER) ?? Number.MAX_SAFE_INTEGER)
    return subjectsOfType(v, PROFILE_SECTION)
        .sort((a, b) => orderOf(a) - orderOf(b))
        .map(iri => ({
            iri,
            label: getLabel(iri) ?? contractTerm(iri),
            fields: v.getSubjects(IN_SECTION, iri, null)
                .map(t => t.value)
                .sort((a, b) => orderOf(a) - orderOf(b)),
        }))
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

function preferDe(terms) {
    return terms.find(t => t.language === "de")?.value ?? terms[0]?.value
}

export function getLabel(uri) {
    return preferDe(getVocab().getObjects(uri, RDFS_LABEL, null))
}

// cori:pluralLabel — how a UI titles a group of several values of a property
export function getPluralLabel(uri) {
    return preferDe(getVocab().getObjects(uri, CORI + "pluralLabel", null))
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
