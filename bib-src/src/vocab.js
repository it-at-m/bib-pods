// Library-vocab registration + library-specific lookups.
// Importing this module is enough to make bib-src's vocabulary and prefixes visible
// to cori-sdk's getVocab() / contractTerm() — registration happens at top-level on first
// load, then ES module caching ensures it runs exactly once across the bundle.
import { registerVocab, registerPrefix, getVocab, contractTerm, RDFS } from "cori-sdk/utils.js"
import { registerProfileShapes } from "cori-sdk/shacl.js"
import libraryVocabTtl from "../definitions/vocabulary.ttl.js"
import libraryProfileShapesTtl from "../definitions/profile.shapes.ttl.js"
import { sparqlSelect } from "@foerderfunke/sem-ops-utils/sparql"

export const BP = "https://www.muenchner-stadtbibliothek.de/bib-pods#"
export const GND = "https://d-nb.info/gnd/"

// URN base for locally minted identifiers (e.g. authors without authority IRIs)
export const LOCAL = "urn:bibpods:"

// sentinel emitted by the indexer for unresolvable authority entries,
// so *_uri_str_mv arrays stay position-aligned with their label counterparts.
// we treat it as "no IRI for this entry"
export const NO_IRI = "https://unknown.invalid/"

registerPrefix("bp", BP)
registerPrefix("gnd", GND)
registerVocab(libraryVocabTtl)
registerProfileShapes(libraryProfileShapesTtl)

// collects the follow-up questions declared on a cori:UserAction in the vocabulary
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
        }`, [getVocab()])
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
