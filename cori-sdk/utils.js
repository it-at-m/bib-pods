import { addTriple, storeToTurtle, storeFromTurtles } from "@foerderfunke/sem-ops-utils/core"
import { Writer, DataFactory } from "n3"
import coriVocabTtl from "./definitions/vocabulary.ttl.js"

export const RDFS = "http://www.w3.org/2000/01/rdf-schema#"
export const RDFS_LABEL = RDFS + "label"
export const CORI = "https://cori.systems/core#"
export const PROV = "http://www.w3.org/ns/prov#"
export const AS = "https://www.w3.org/ns/activitystreams#"
export const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#"
export const RDF_TYPE = RDF + "type"

export function getProfileSubject() {
    return CORI + "defaultProfile" // apps might want to overwrite this
}

export const PREFIXES = {
    cori: CORI, rdfs: RDFS, prov: PROV, as: AS, rdf: RDF,
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
            order: orderOf(iri),
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

// --- RDF 1.2 triple terms ---
// Graphs containing triple terms serialize here rather than through serializeTurtle,
// whose pretty-printer drops the quoting and emits the term as an ordinary asserted
// triple. This uses N3 2.x, a direct cori-sdk dependency; sem-ops-utils keeps its own
// 1.x nested underneath for the profile.

export const factory = DataFactory

// Prefix declarations and body separately, so a caller appending to a document that
// already declares some of them can emit only what is missing.
export async function serializeTurtleStarParts(store) {
    const writer = new Writer({ prefixes: usedPrefixes(store) })
    writer.addQuads(store.getQuads())
    const text = await new Promise((resolve, reject) =>
        writer.end((err, result) => err ? reject(err) : resolve(result)))
    const lines = text.split("\n")
    const bodyStart = lines.findIndex(line => !line.startsWith("@prefix") && line.trim() !== "")
    return {
        declarations: lines.slice(0, bodyStart).filter(line => line.startsWith("@prefix")),
        body: lines.slice(bodyStart).join("\n").trimEnd(),
    }
}

// The prefixes a graph actually needs. The N3 writer declares every prefix it is
// handed, used or not, and PREFIXES grows with each vocabulary an app registers.
function usedPrefixes(store) {
    const iris = new Set()
    const collect = (term) => {
        if (term.termType === "Quad") [term.subject, term.predicate, term.object].forEach(collect)
        else if (term.termType === "NamedNode") iris.add(term.value)
        else if (term.termType === "Literal") iris.add(term.datatype.value)
    }
    for (const quad of store.getQuads()) collect(quad)
    return Object.fromEntries(Object.entries(PREFIXES)
        .filter(([, base]) => [...iris].some(iri => iri.startsWith(base))))
}

// Identity of a profile quad as a string, so quads from separate parses of the same
// document compare equal. Literals carry datatype and language, keeping "1" and 1 apart.
export function quadKey(quad) {
    return `${termKey(quad.subject)} ${termKey(quad.predicate)} ${termKey(quad.object)}`
}

function termKey(term) {
    switch (term.termType) {
        case "Literal": return `"${term.value}"${term.language ? `@${term.language}` : `^^${term.datatype.value}`}`
        case "BlankNode": return `_:${term.value}`
        default: return `<${term.value}>`
    }
}
