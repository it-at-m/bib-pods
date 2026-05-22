import { getVocab, contractTerm, RDF_TYPE, RDFS_LABEL } from "cori-sdk/utils.js"
import { BP } from "./vocab.js"

// Returns descriptors for every bp:RecommendationStrategy in the vocab:
//   [{ iri, label, properties: [propUri], combine: "or"|"and" }]
export function getStrategies() {
    const v = getVocab()
    return v.getSubjects(RDF_TYPE, BP + "RecommendationStrategy", null).map(t => {
        const iri = t.value
        return {
            iri,
            label: labelOf(v, iri),
            properties: v.getObjects(iri, BP + "usesProfileProperty", null).map(o => o.value),
            combine: v.getObjects(iri, BP + "combine", null)[0]?.value === BP + "And" ? "and" : "or",
        }
    })
}

// Builds the Solr query for a strategy from the user's profile store.
//   Returns { q, fq: [exclusion-strings] } or null if no clauses applied.
// Each profile fact becomes a group OR-ing across all of its bp:linkedToIndex fields
// (e.g. author + author2). Groups are then combined via the strategy's bp:combine.
// bp:savedBook entries become -id: filters rather than match clauses.
export function buildQuery(strategy, profileStore, profileSubject) {
    const v = getVocab()
    const factGroups = []
    for (const prop of strategy.properties) {
        const mappings = getLinkedIndices(v, prop)
        for (const obj of profileStore.getObjects(profileSubject, prop, null)) {
            const clauses = []
            for (const m of mappings) {
                const field = obj.termType === "NamedNode" ? m.iriField : m.labelField
                if (field) clauses.push(`${field}:"${escapeSolr(obj.value)}"`)
            }
            if (clauses.length > 0) {
                factGroups.push(clauses.length === 1 ? clauses[0] : `(${clauses.join(" OR ")})`)
            }
        }
    }
    if (factGroups.length === 0) return null
    const op = strategy.combine === "and" ? " AND " : " OR "
    const q = factGroups.length === 1 ? factGroups[0] : `(${factGroups.join(op)})`
    const savedIds = profileStore.getObjects(profileSubject, BP + "savedBook", null).map(o => o.value)
    return { q, fq: savedIds.map(id => `-id:"${escapeSolr(id)}"`) }
}

// runs every strategy against Solr and returns: [{ strategy, docs: [...] }]
// strategies that yield no clauses (profile lacks the necessary predicates) are skipped.
export async function runRecommendations(profileStore, profileSubject, solrEndpoint, limit = 3) {
    const out = []
    for (const strategy of getStrategies()) {
        const query = buildQuery(strategy, profileStore, profileSubject)
        if (!query) continue
        const url = solrUrl(solrEndpoint, query, limit)
        console.log(`[bib-pods] ${strategy.label}: ${url}`)
        try {
            const res = await fetch(url)
            if (!res.ok) {
                console.warn(`[bib-pods] ${strategy.label}: Solr ${res.status}`)
                continue
            }
            const json = await res.json()
            out.push({ strategy, docs: json.response?.docs ?? [] })
        } catch (err) {
            console.error(`[bib-pods] ${strategy.label} failed:`, err)
        }
    }
    return out
}

function getLinkedIndices(v, prop) {
    return v.getObjects(prop, BP + "linkedToIndex", null).map(l => ({
        labelField: v.getObjects(l, BP + "labelField", null)[0]?.value,
        iriField: v.getObjects(l, BP + "iriField", null)[0]?.value,
    }))
}

function labelOf(store, iri) {
    const labels = store.getObjects(iri, RDFS_LABEL, null)
    return labels.find(t => t.language === "de")?.value ?? labels[0]?.value ?? contractTerm(iri)
}

function escapeSolr(s) {
    return s.replace(/(["\\])/g, "\\$1")
}

// manual assembly with encodeURIComponent: URLSearchParams encodes spaces as `+`,
// which Solr's Lucene parser misreads as the `+` must-match prefix operator. `%20` works
function solrUrl(endpoint, { q, fq }, limit) {
    const parts = [`q=${encodeURIComponent(q)}`]
    for (const f of fq) parts.push(`fq=${encodeURIComponent(f)}`)
    parts.push(`rows=${limit}`, `wt=json`)
    return `${endpoint}?${parts.join("&")}`
}
