import { getVocab, contractTerm, RDF_TYPE, RDFS_LABEL, RDFS } from "cori-sdk/utils.js"
import { sparqlSelect } from "@foerderfunke/sem-ops-utils/sparql"
import { BP, LOCAL } from "./vocab.js"
import { recommendFromSavedBooks } from "./qdrant.js"

const INSPIRA_ENGINE = BP + "InspiraEngine"

// Predicate marking a strategy the user switched off (opt-out: a strategy runs unless
// its IRI appears here). Shared by the toggle UI and the runner.
export const DISABLED_STRATEGY = BP + "disabledStrategy"

// Settings live under their own subject — NOT the profile subject — so they persist in
// the same profile resource (and sync to the pod) without showing up in the user-facing
// <cori-profile> table, which renders only the profile subject's facts.
export const SETTINGS_SUBJECT = LOCAL + "recommendation-settings"

// IRIs of strategies the user has switched off, read from the (whole) profile store.
export function readDisabledStrategies(profileStore) {
    return new Set(profileStore.getObjects(SETTINGS_SUBJECT, DISABLED_STRATEGY, null).map(o => o.value))
}

// Returns descriptors for every bp:RecommendationStrategy in the vocab:
//   [{ iri, label, comment, engine, properties: [propUri], combine }]
// engine defaults to the Solr backend when unspecified; comment is the strategy's
// rdfs:comment (e.g. a note about external network traffic) or null; combine is the
// combinator descriptor { iri, label, space } or null (see combinatorOf).
export function getStrategies() {
    const v = getVocab()
    return v.getSubjects(RDF_TYPE, BP + "RecommendationStrategy", null).map(t => {
        const iri = t.value
        return {
            iri,
            label: labelOf(v, iri),
            comment: germanText(v, iri, RDFS + "comment"),
            engine: v.getObjects(iri, BP + "engine", null)[0]?.value ?? BP + "SolrEngine",
            properties: v.getObjects(iri, BP + "usesProfileProperty", null).map(o => o.value),
            combine: combinatorOf(v, iri),
        }
    })
}

// Natural-language German explanation (HTML) for why a strategy recommends things,
// derived from the vocab + the user's profile via one federated SPARQL query: for each
// profile property the strategy uses, take its bp:explanationPhrase and fill "{value}"
// with the matching profile value label(s) (bolded). Fragments are joined by the
// strategy's combinator word ("und"/"oder") and prefixed with "Wird empfohlen, weil …".
export async function explainStrategy(strategy, profileStore, profileSubject) {
    const rows = await sparqlSelect(`
        PREFIX bp: <${BP}>
        PREFIX rdfs: <${RDFS}>
        SELECT ?prop ?phrase ?value ?valueLabel WHERE {
            <${strategy.iri}> bp:usesProfileProperty ?prop .
            OPTIONAL { ?prop bp:explanationPhrase ?phrase . FILTER(lang(?phrase) = "de") }
            <${profileSubject}> ?prop ?value .
            OPTIONAL { ?value rdfs:label ?valueLabel . FILTER(lang(?valueLabel) = "de" || lang(?valueLabel) = "") }
        }`, [getVocab(), profileStore])

    const byProp = new Map()
    for (const r of rows) {
        if (!byProp.has(r.prop)) byProp.set(r.prop, { phrase: r.phrase, values: new Set() })
        const label = r.valueLabel ?? r.value
        if (label) byProp.get(r.prop).values.add(label)
    }
    const fragments = []
    for (const { phrase, values } of byProp.values()) {
        if (!phrase) continue
        if (!phrase.includes("{value}")) { fragments.push(phrase); continue }
        if (values.size === 0) continue
        const bolded = [...values].map(v => `<strong>${escapeHtml(v)}</strong>`).join(", ")
        fragments.push(phrase.replace("{value}", bolded))
    }
    if (fragments.length === 0) return `Empfohlen über „${escapeHtml(strategy.label)}".`
    const join = strategy.combine?.iri === BP + "And" ? " und " : " oder "
    return `Wird empfohlen, weil ${fragments.join(join)}.`
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))
}

// The strategy's bp:combine value as { iri, label, space }, or null if unset. `space` is
// the combinator kind's label ("logisch" for Boolean joins, "Vektorraum" for embedding
// aggregation) — so callers can show that the linkage isn't symbolic but vector-space.
function combinatorOf(v, iri) {
    const c = v.getObjects(iri, BP + "combine", null)[0]?.value
    if (!c) return null
    const kind = v.getObjects(c, RDF_TYPE, null).map(o => o.value)
        .find(t => t === BP + "VectorCombinator" || t === BP + "LogicalCombinator")
    return { iri: c, label: labelOf(v, c), space: kind ? labelOf(v, kind) : null }
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
    const op = strategy.combine?.iri === BP + "And" ? " AND " : " OR "
    const q = factGroups.length === 1 ? factGroups[0] : `(${factGroups.join(op)})`
    const savedIds = profileStore.getObjects(profileSubject, BP + "savedBook", null).map(o => o.value)
    return { q, fq: savedIds.map(id => `-id:"${escapeSolr(id)}"`) }
}

// runs every enabled strategy against its engine (Solr index or the inspira recommender)
// and returns:
//   { results: [{ strategy, docs: [...] }], serverUnreachable: bool }
// Disabled strategies (bp:disabledStrategy in the profile) are skipped, as are Solr
// strategies that yield no clauses (profile lacks the necessary predicates).
// serverUnreachable lets callers tell "backend down" apart from "reached it, but nothing
// matched": it's true when no strategy reached a backend. When nothing was attempted at
// all we never touched a backend, so probe Solr directly — otherwise an unreachable index
// would be indistinguishable from an empty profile.
export async function runRecommendations(profileStore, profileSubject, { solrEndpoint, qdrantEndpoint }, limit = 3) {
    const disabled = readDisabledStrategies(profileStore)
    const results = []
    let attempted = 0
    let reached = 0
    for (const strategy of getStrategies()) {
        if (disabled.has(strategy.iri)) continue

        if (strategy.engine === INSPIRA_ENGINE) {
            attempted++
            try {
                // The inspira recommender is seeded by the Merkliste, returning points whose
                // payload.metadata mirrors our catalogue. Reshape to the {id, title} docs the
                // caller already knows, minting the SOPAC id back from the bare akkey.
                const { savedIds, basedOn, results: points } = await recommendFromSavedBooks(profileStore, profileSubject, qdrantEndpoint, limit)
                reached++
                // basedOn = the bare akkeys the recommender actually used; the rest of the
                // Merkliste isn't in the collection. Logged so we can see what went in/out.
                const used = new Set(basedOn)
                const notInCollection = savedIds.filter(id => !used.has(id.replace(/^AK/, "")))
                console.log(`[bib-pods] ${strategy.label}: ${basedOn.length}/${savedIds.length} gemerkte Bücher genutzt`, { basedOn, notInCollection })
                const docs = points.map(p => {
                    const meta = p.payload?.metadata ?? {}
                    return {
                        id: meta.akkey ? "AK" + meta.akkey : p.id,
                        title: meta.title ? [meta.title] : undefined,
                        author: meta.author ? [meta.author] : undefined,
                        isbn: meta.isbn ? [meta.isbn] : undefined,
                    }
                })
                results.push({ strategy, docs })
            } catch (err) {
                console.error(`[bib-pods] ${strategy.label} failed:`, err)
            }
            continue
        }

        const query = buildQuery(strategy, profileStore, profileSubject)
        if (!query) continue
        attempted++
        const url = solrUrl(solrEndpoint, query, limit)
        console.log(`[bib-pods] ${strategy.label}: ${url}`)
        try {
            const res = await fetch(url)
            if (!res.ok) {
                console.warn(`[bib-pods] ${strategy.label}: Solr ${res.status}`)
                continue
            }
            reached++
            const json = await res.json()
            results.push({ strategy, docs: json.response?.docs ?? [] })
        } catch (err) {
            console.error(`[bib-pods] ${strategy.label} failed:`, err)
        }
    }
    const serverUnreachable = attempted > 0 ? reached === 0 : !(await solrReachable(solrEndpoint))
    return { results, serverUnreachable }
}

// Cheap liveness check: a match-all query asking for zero rows. true only on a
// successful (2xx) Solr response; a thrown fetch or non-OK status means unreachable.
async function solrReachable(solrEndpoint) {
    const url = solrUrl(solrEndpoint, { q: "*:*", fq: [] }, 0)
    try {
        const res = await fetch(url)
        if (!res.ok) console.warn(`[bib-pods] Solr reachability probe: ${res.status}`)
        return res.ok
    } catch (err) {
        console.error("[bib-pods] Solr reachability probe failed:", err)
        return false
    }
}

function getLinkedIndices(v, prop) {
    return v.getObjects(prop, BP + "linkedToIndex", null).map(l => ({
        labelField: v.getObjects(l, BP + "labelField", null)[0]?.value,
        iriField: v.getObjects(l, BP + "iriField", null)[0]?.value,
    }))
}

// German-preferred string value for (iri, predicate), or null if none present.
function germanText(store, iri, predicate) {
    const vals = store.getObjects(iri, predicate, null)
    return vals.find(t => t.language === "de")?.value ?? vals[0]?.value ?? null
}

function labelOf(store, iri) {
    return germanText(store, iri, RDFS_LABEL) ?? contractTerm(iri)
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
