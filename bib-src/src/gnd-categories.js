// The GND-Systematik (GND-Sachgruppen): its 37 Hauptgruppen are a small, stable,
// closed set of subject categories, each a resolvable GND IRI.
//
// The vocabulary ships as a vendored snapshot (resources/gnd-sc.ttl, CC0 1.0):
// d-nb.info serves no CORS header, so it can't be fetched cross-origin at runtime,
// and bundling it keeps both hosts (docs, TYPO3) identical and offline-safe.
// Refresh by re-downloading https://d-nb.info/standards/vocab/gnd/gnd-sc.ttl.
//
// The Turtle is loaded into an in-memory triple store and the top concepts are
// SELECTed — the same in-memory-SPARQL stack (sem-ops-utils → N3 + Comunica) the
// rest of the app already uses.
import { storeFromTurtles, sparqlSelect } from "@foerderfunke/sem-ops-utils"
import gndScTtl from "../resources/gnd-sc.ttl?raw"

// The scheme links its main groups via skos:hasTopConcept. The German prefLabel is
// the display text; the concept IRI (…/gnd-sc#12*) is the value we keep.
const TOP_CONCEPTS_QUERY = `
    PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
    SELECT ?concept ?notation ?label WHERE {
        ?scheme skos:hasTopConcept ?concept .
        ?concept skos:notation ?notation ;
                 skos:prefLabel ?label .
        FILTER(lang(?label) = "de")
    }`

// d-nb.info isn't git-hosted, but our vendored copy is — so a permalink to the exact
// definition means finding it in *this* file. Each concept's IRI sits alone on its own
// line right before its block, which then runs (one triple per line, ";"-continued)
// until the line ending in "." that closes it. A blank line before that means the block
// never closed as expected, so fall back to just the IRI's own line.
const GITHUB_SOURCE = "https://github.com/it-at-m/bib-pods/blob/main/bib-src/resources/gnd-sc.ttl"
const TTL_LINES = gndScTtl.split("\n")

function blockSourceUrl(iri) {
    const start = TTL_LINES.findIndex(l => l.trim() === `<${iri}>`)
    if (start === -1) return GITHUB_SOURCE
    let end = start
    for (let i = start + 1; i < TTL_LINES.length; i++) {
        const line = TTL_LINES[i].trim()
        if (line === "") break
        end = i
        if (line.endsWith(".")) break
    }
    const first = start + 1
    const last = end + 1
    return last > first ? `${GITHUB_SOURCE}#L${first}-L${last}` : `${GITHUB_SOURCE}#L${first}`
}

export async function loadGndCategories() {
    const store = storeFromTurtles([gndScTtl])
    const rows = await sparqlSelect(TOP_CONCEPTS_QUERY, [store])
    // Order by Hauptgruppe number; the trailing "*" only marks the group level.
    return rows
        .map(r => ({
            iri: r.concept,
            label: r.label,
            order: parseInt(r.notation, 10) || 0,
            sourceUrl: blockSourceUrl(r.concept),
        }))
        .sort((a, b) => a.order - b.order)
}
