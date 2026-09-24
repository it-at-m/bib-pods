import { getVocab, contractTerm, RDF_TYPE, RDFS_LABEL, RDFS, CORI } from "cori-sdk/utils.js"
import { sparqlSelect } from "@foerderfunke/sem-ops-utils/sparql"
import { BP, LOCAL } from "./vocab.js"
import { recommendFromSavedBooks } from "./qdrant.js"

const INSPIRA_ENGINE = BP + "InspiraEngine"

// Explicit per-user strategy choices, overriding the vocab's bp:enabledByDefault
// seed. Only deviations from the seed are persisted (see resolveStrategyEnabled).
// Shared by the toggle UI and the runner.
export const ENABLED_STRATEGY = BP + "enabledStrategy"
export const DISABLED_STRATEGY = BP + "disabledStrategy"

// Settings live under their own subject — NOT the profile subject — so they persist in
// the same profile resource (and sync to the pod) without showing up in the user-facing
// <cori-profile> table, which renders only the profile subject's facts.
export const SETTINGS_SUBJECT = LOCAL + "recommendation-settings"

// The user's explicit strategy on/off choices, read from the (whole) profile store.
export function readStrategyChoices(profileStore) {
    return {
        enabled: new Set(profileStore.getObjects(SETTINGS_SUBJECT, ENABLED_STRATEGY, null).map(o => o.value)),
        disabled: new Set(profileStore.getObjects(SETTINGS_SUBJECT, DISABLED_STRATEGY, null).map(o => o.value)),
    }
}

// A strategy runs iff explicitly enabled, or seeded on (bp:enabledByDefault) and not
// explicitly disabled. Because only deviations are stored, a strategy added to the
// vocabulary later keeps its declared seed state even for users with stored choices.
export function resolveStrategyEnabled(strategy, choices) {
    if (choices.enabled.has(strategy.iri)) return true
    if (choices.disabled.has(strategy.iri)) return false
    return strategy.defaultEnabled
}

// Returns descriptors for every bp:RecommendationStrategy in the vocab:
//   [{ iri, label, comment, engine, properties: [propUri], combine, maxSuggestions,
//      defaultEnabled }]
// engine defaults to the Solr backend when unspecified; comment is the strategy's
// rdfs:comment (e.g. a note about external network traffic) or null; combine is the
// combinator descriptor { iri, label, space } or null (see combinatorOf);
// maxSuggestions is the strategy's bp:maxSuggestions or null (runner default applies);
// defaultEnabled is the bp:enabledByDefault seed (absent = false — new strategies
// start as opt-in lanes).
export function getStrategies() {
    const v = getVocab()
    return v.getSubjects(RDF_TYPE, BP + "RecommendationStrategy", null).map(t => {
        const iri = t.value
        const max = v.getObjects(iri, BP + "maxSuggestions", null)[0]?.value
        return {
            iri,
            label: labelOf(v, iri),
            comment: germanText(v, iri, RDFS + "comment"),
            engine: v.getObjects(iri, BP + "engine", null)[0]?.value ?? BP + "SolrEngine",
            properties: v.getObjects(iri, BP + "usesProfileProperty", null).map(o => o.value),
            combine: combinatorOf(v, iri),
            maxSuggestions: max !== undefined ? Number(max) : null,
            defaultEnabled: v.getObjects(iri, BP + "enabledByDefault", null)[0]?.value === "true",
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

// Per-book explanation (HTML): which of the user's profile facts THIS doc actually
// matches, checked symbolically against the doc's index fields via the same
// bp:linkedToIndex mappings the query builder uses. `properties` restricts the
// check to a strategy's own bp:usesProfileProperty set — the tooltip makes a causal
// claim ("weil"), so a vector-similarity lane must not cite symbolic overlaps that
// weren't its reason; without it every mapped property is checked (best effort for
// lanes whose strategy is unknown, e.g. messages from a renamed strategy).
// Returns null when no fact matches — callers fall back to the strategy-level
// explanation.
export function explainDocMatches(doc, profileStore, profileSubject, properties = null) {
    const v = getVocab()
    const props = properties ?? v.getSubjects(BP + "linkedToIndex", null, null).map(t => t.value)
    const fragments = []
    for (const prop of props) {
        const phrase = germanText(v, prop, BP + "explanationPhrase")
        // phrases without {value} state no traceable fact — only actual matches count here
        if (!phrase?.includes("{value}")) continue
        const mappings = getLinkedIndices(v, prop)
        const matched = new Set()
        for (const obj of profileStore.getObjects(profileSubject, prop, null)) {
            if (!docMatchesFact(doc, mappings, obj, profileStore)) continue
            matched.add(obj.termType === "NamedNode"
                ? germanText(profileStore, obj.value, RDFS_LABEL) ?? contractTerm(obj.value)
                : obj.value)
        }
        if (matched.size === 0) continue
        const bolded = new Intl.ListFormat("de", { type: "conjunction" })
            .format([...matched].map(x => `<strong>${escapeHtml(x)}</strong>`))
        fragments.push(phrase.replace("{value}", bolded))
    }
    if (fragments.length === 0) return null
    return `Wird empfohlen, weil ${fragments.join(" und ")}.`
}

export function countDocMatches(doc, profileStore, profileSubject, properties) {
    const v = getVocab()
    return [...new Set(properties)].reduce((count, prop) => {
        const mappings = getLinkedIndices(v, prop)
        return count + profileStore.getObjects(profileSubject, prop, null)
            .filter(obj => docMatchesFact(doc, mappings, obj, profileStore)).length
    }, 0)
}

// Does the doc carry this profile fact in any of the property's index fields?
// Authority IRIs check the iriField, literals the labelField; picker concepts carrying
// bp:indexValue check the labelField via their raw catalogue token(s); locally minted
// URNs (urn:bibpods:…) never appear in the index, so they check the labelField via
// their preserved raw index form (bp:sourceLabel). Exact matches only — a near-miss
// (e.g. a differing name-date variant) counts as "not traceable", not as a match.
function docMatchesFact(doc, mappings, obj, profileStore) {
    const inField = (field, value) => field && [].concat(doc[field] ?? []).includes(value)
    const indexValues = obj.termType === "NamedNode"
        ? getVocab().getObjects(obj.value, BP + "indexValue", null).map(t => t.value)
        : []
    for (const m of mappings) {
        if (obj.termType !== "NamedNode") {
            if (inField(m.labelField, obj.value)) return true
        } else if (indexValues.length > 0) {
            if (indexValues.some(t => inField(m.labelField, t))) return true
        } else if (obj.value.startsWith(LOCAL)) {
            const raw = germanText(profileStore, obj.value, BP + "sourceLabel")
                ?? germanText(profileStore, obj.value, RDFS_LABEL)
            if (raw && inField(m.labelField, raw)) return true
        } else if (inField(m.iriField, obj.value)) {
            return true
        }
    }
    return false
}

export function escapeHtml(s) {
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
//   Returns { q, fq: [filter-strings] } or null if no clauses applied.
// Each profile fact becomes a group OR-ing across all of its bp:linkedToIndex fields
// (e.g. author + author2). Groups are then combined via the strategy's bp:combine.
// The fq carries what constrains rather than matches: -id: exclusions for bp:savedBook
// entries and the profile's preference filters (see preferenceFilters).
export function buildQuery(strategy, profileStore, profileSubject) {
    const v = getVocab()
    const factGroups = profileFactGroups(strategy, profileStore, profileSubject)
    if (factGroups.length === 0) return null
    const op = strategy.combine?.iri === BP + "And" ? " AND " : " OR "
    const q = factGroups.length === 1 ? factGroups[0] : `(${factGroups.join(op)})`
    const savedIds = profileStore.getObjects(profileSubject, BP + "savedBook", null).map(o => o.value)
    return { q, fq: [...savedIds.map(id => `-id:"${escapeSolr(id)}"`), ...preferenceFilters(v, profileStore, profileSubject)] }
}

// RDF has no order. Use the displayed labels so saving/reloading a profile cannot
// change which interests get the remaining places on a bounded shelf.
function orderedProfileFacts(strategy, profileStore, profileSubject) {
    const v = getVocab()
    return strategy.properties.flatMap(prop => {
        const mappings = getLinkedIndices(v, prop)
        const label = obj => obj.termType === "NamedNode"
            ? germanText(profileStore, obj.value, RDFS_LABEL) ?? labelOf(v, obj.value)
            : obj.value
        return profileStore.getObjects(profileSubject, prop, null)
            .sort((a, b) => label(a).localeCompare(label(b), "de") || a.value.localeCompare(b.value))
            .map(obj => ({ obj, mappings }))
    })
}

function profileFactEntries(strategy, profileStore, profileSubject) {
    const v = getVocab()
    const groups = new Map()
    for (const { obj, mappings } of orderedProfileFacts(strategy, profileStore, profileSubject)) {
        const clauses = factClauses(v, mappings, obj)
        if (clauses.length > 0) {
            const q = clauses.length === 1 ? clauses[0] : `(${clauses.join(" OR ")})`
            if (!groups.has(q)) groups.set(q, { q, facts: [] })
            groups.get(q).facts.push({ obj, mappings })
        }
    }
    return [...groups.values()]
}

function profileFactGroups(strategy, profileStore, profileSubject) {
    return profileFactEntries(strategy, profileStore, profileSubject).map(entry => entry.q)
}

// Existing messages identify their lane in the first line of cori:content.
// Include unread AND dismissed messages, deduplicated by catalogue id.
function recommendedIds(strategy, store) {
    return [...new Set(store.getSubjects(RDF_TYPE, CORI + "Message", null).flatMap(node => {
        const content = store.getObjects(node, CORI + "content", null)[0]?.value
        if (content?.split("\n")[0] !== strategy.label) return []
        return store.getObjects(node, CORI + "refersToEntity", null).map(t => t.value)
    }))]
}

// Terms queries avoid one Boolean clause per historical book. Values are passed
// as parameters; even punctuation or a separator in an id cannot change the query.
function historyQuery(ids) {
    let separator = "\n"
    while (ids.some(id => id.includes(separator))) separator += "\n"
    return {
        q: "{!terms f=id separator=$previousSeparator v=$previousIds}",
        fq: [],
        params: { previousSeparator: separator, previousIds: ids.join(separator) },
    }
}

function excludeRecommended(query, ids) {
    if (!ids.length) return query
    const history = historyQuery(ids)
    return {
        ...query,
        fq: [...query.fq, "{!bool must=$allBooks must_not=$previousBooks}"],
        params: { ...query.params, ...history.params, allBooks: "*:*", previousBooks: history.q },
    }
}

// Retrieve each alternative separately; AND strategies keep the full conjunction.
// All requests exclude past
// recommendations in this lane and retain the profile's preference filters.
export function buildRecommendationQueries(strategy, profileStore, profileSubject) {
    const pool = buildQuery(strategy, profileStore, profileSubject)
    if (!pool) return []
    const query = excludeRecommended(pool, recommendedIds(strategy, profileStore))
    if (strategy.combine?.iri === BP + "And") return [query]
    return profileFactGroups(strategy, profileStore, profileSubject).map(q => ({ ...query, q }))
}

// One extra pool for books connecting at least two distinct profile facts.
// A fact's alternative index fields stay inside one clause. Parameter references
// keep literal profile values out of the local-parameter syntax.
export function buildCombinedQuery(strategy, profileStore, profileSubject) {
    if (strategy.combine?.iri === BP + "And") return null
    const queries = buildRecommendationQueries(strategy, profileStore, profileSubject)
    if (queries.length < 2) return null
    const params = Object.fromEntries(queries.map(({ q }, i) => [`profileMatch${i}`, q]))
    return {
        q: `{!bool ${Object.keys(params).map(key => `should=$${key}`).join(" ")} mm=2}`,
        fq: queries[0].fq,
        params: { ...queries[0].params, ...params },
    }
}

// Prefer the least represented input, including past recommendations and all
// inputs covered by each new selection. Ties use the stable input order.
export function selectDiverseDocs(pools, limit, { counts = [], matches = () => [], lead = null } = {}) {
    const selected = []
    const ids = new Set()
    const works = new Set()
    const positions = pools.map(() => 0)
    const coverage = pools.map((_, i) => counts[i] ?? 0)
    const normalize = value => String(value ?? "").normalize("NFKC").toLocaleLowerCase("de-DE").replace(/\s+/g, " ").trim()
    const workOf = doc => {
        const title = normalize(doc.title?.[0])
        return title ? `${title}\n${normalize(doc.author?.[0])}` : null
    }
    const take = (doc, pool) => {
        const work = workOf(doc)
        if (ids.has(doc.id) || (work && works.has(work))) return false
        selected.push(doc)
        ids.add(doc.id)
        if (work) works.add(work)
        const covered = matches(doc)
        if (!covered.length && pool !== undefined) covered.push(pool)
        for (const i of new Set(covered)) coverage[i]++
        return true
    }
    if (lead && limit > 0) take(lead)
    while (selected.length < limit) {
        const available = pools.map((_, i) => i).filter(i => positions[i] < pools[i].length)
            .sort((a, b) => coverage[a] - coverage[b] || a - b)
        if (!available.length) break
        const i = available[0]
        while (positions[i] < pools[i].length) {
            if (take(pools[i][positions[i]++], i)) break
        }
    }
    return selected
}

function matchingInputs(entries, doc, profileStore) {
    return entries.flatMap(({ facts }, i) => facts.some(({ obj, mappings }) =>
        docMatchesFact(doc, mappings, obj, profileStore)) ? [i] : [])
}

function publicationYear(doc) {
    const years = [].concat(doc.publishDateSort ?? []).map(Number).filter(Number.isFinite)
    const year = years.length ? Math.min(...years) : 0
    return year >= 1 && year <= new Date().getFullYear() + 1 ? year : 0
}

function publicationYearSort() {
    const field = "field(publishDateSort,min)"
    return `if(and(gte(${field},1),lte(${field},${new Date().getFullYear() + 1})),${field},0) desc`
}

// RDF message storage has no result order. Rebuild a varied shelf from the
// catalogue facts on read, including after a reload. Keep older/unmatched
// messages at the end so changing interests never silently discards them.
export function orderDocsByProfile(docs, strategy, profileStore, profileSubject) {
    if (strategy?.combine?.iri !== BP + "Or") return docs
    const sorted = [...docs].sort((a, b) => publicationYear(b) - publicationYear(a) || a.id.localeCompare(b.id))
    const entries = profileFactEntries(strategy, profileStore, profileSubject)
    const matches = doc => matchingInputs(entries, doc, profileStore)
    const pools = entries.map((_, i) => sorted.filter(doc => matches(doc).includes(i)))
    const lead = sorted.filter(doc => matches(doc).length >= 2)
        .sort((a, b) => matches(b).length - matches(a).length)[0]
    const ordered = selectDiverseDocs(pools, docs.length, { lead, matches })
    const ids = new Set(ordered.map(doc => doc.id))
    return [...ordered, ...docs.filter(doc => !ids.has(doc.id))]
}

// The Solr clauses one profile fact contributes, across the property's index mappings:
// authority IRIs hit the iriField, literals the labelField, and picker concepts carrying
// bp:indexValue expand to their raw catalogue token(s) on the labelField — "Deutsch"
// becomes language:"ger", merged media concepts OR all their tokens.
function factClauses(v, mappings, obj) {
    const indexValues = obj.termType === "NamedNode"
        ? v.getObjects(obj.value, BP + "indexValue", null).map(t => t.value)
        : []
    const clauses = []
    for (const m of mappings) {
        if (indexValues.length > 0) {
            if (m.labelField) clauses.push(...indexValues.map(t => `${m.labelField}:"${escapeSolr(t)}"`))
        } else {
            const field = obj.termType === "NamedNode" ? m.iriField : m.labelField
            if (field) clauses.push(`${field}:"${escapeSolr(obj.value)}"`)
        }
    }
    return clauses
}

// fq clauses from the profile's preference properties (bp:RecommendationFilter — e.g.
// Sprache, Medienart): one fq per property OR-ing its values. Solr ANDs separate fq
// params, so "auf Deutsch oder Englisch, und als E-Book" comes out right. They apply
// to every Solr lane; the inspira engine has no query to attach them to.
function preferenceFilters(v, profileStore, profileSubject) {
    const fqs = []
    for (const prop of v.getSubjects(RDF_TYPE, BP + "RecommendationFilter", null)) {
        const clauses = []
        const mappings = getLinkedIndices(v, prop.value)
        for (const obj of profileStore.getObjects(profileSubject, prop.value, null)) {
            clauses.push(...factClauses(v, mappings, obj))
        }
        if (clauses.length > 0) fqs.push(clauses.length === 1 ? clauses[0] : `(${clauses.join(" OR ")})`)
    }
    return fqs
}

// Total pool behind a strategy for this profile: how many index records its query
// matches (rows=0, header only — cheap). null means "unknown", not zero: the strategy
// has no Solr query (inspira engine, or the profile lacks the needed facts) or the
// request failed. Catalogue totals include previously recommended books.
export async function countStrategyMatches(strategy, profileStore, profileSubject, solrEndpoint) {
    if (strategy.engine === INSPIRA_ENGINE) return null
    const query = buildQuery(strategy, profileStore, profileSubject)
    if (!query) return null
    try {
        return (await fetchSolr(solrEndpoint, query, 0)).response?.numFound ?? null
    } catch {
        return null
    }
}

// runs every enabled strategy against its engine (Solr index or the inspira recommender)
// and returns:
//   { results: [{ strategy, docs: [...] }], serverUnreachable: bool }
// `limit` caps each strategy's results; a strategy's bp:maxSuggestions overrides it.
// Strategies resolved off (seed defaults + the profile's explicit choices, see
// resolveStrategyEnabled) are skipped, as are Solr strategies that yield no clauses
// (profile lacks the necessary predicates).
// serverUnreachable lets callers tell "backend down" apart from "reached it, but nothing
// matched": it's true when no strategy reached a backend. When nothing was attempted at
// all we never touched a backend, so probe Solr directly — otherwise an unreachable index
// would be indistinguishable from an empty profile.
export async function runRecommendations(profileStore, profileSubject, { solrEndpoint, qdrantEndpoint }, limit = 3) {
    const choices = readStrategyChoices(profileStore)
    const results = []
    let attempted = 0
    let reached = 0
    for (const strategy of getStrategies()) {
        if (!resolveStrategyEnabled(strategy, choices)) continue

        if (strategy.engine === INSPIRA_ENGINE) {
            attempted++
            try {
                // The inspira recommender is seeded by the Merkliste, returning points whose
                // payload.metadata mirrors our catalogue. Reshape to the {id, title} docs the
                // caller already knows, minting the SOPAC id back from the bare akkey.
                const { savedIds, basedOn, results: points } = await recommendFromSavedBooks(profileStore, profileSubject, qdrantEndpoint, strategy.maxSuggestions ?? limit)
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

        const queries = buildRecommendationQueries(strategy, profileStore, profileSubject)
        if (!queries.length) continue
        const wanted = strategy.maxSuggestions ?? limit
        const separateInputs = strategy.combine?.iri !== BP + "And"
        const previousIds = recommendedIds(strategy, profileStore)
        const previous = new Set(previousIds)
        const combinedQuery = buildCombinedQuery(strategy, profileStore, profileSubject)
        // Relevance leads every query; alternative pools use freshness to break
        // ties. Implausible dates rank like missing dates.
        const requests = [
            ...(combinedQuery ? [{ ...combinedQuery, sort: `score desc,${publicationYearSort()},id asc` }] : []),
            ...queries.map(query => ({ ...query, sort: separateInputs
                ? `score desc,${publicationYearSort()},id asc` : "score desc,id asc" })),
        ]
        const request = async (query, rows) => {
            attempted++
            console.log(`[bib-pods] ${strategy.label}: POST ${solrEndpoint}`, query.q)
            try {
                const result = await fetchSolr(solrEndpoint, query, rows)
                reached++
                return result
            } catch (err) {
                console.error(`[bib-pods] ${strategy.label} failed:`, err)
                return null
            }
        }
        // One count-only query measures all inputs against this lane's history.
        // A combined book contributes to each matching input, once per book id.
        const history = separateInputs && previousIds.length ? historyQuery(previousIds) : null
        if (history) history.params["json.facet"] = JSON.stringify(Object.fromEntries(
            queries.map(({ q }, i) => [`input${i}`, { type: "query", q }]),
        ))
        const [pools, past] = await Promise.all([
            Promise.all(requests.map(async query => {
                const result = await request(query, separateInputs ? wanted * 2 : wanted)
                return (result?.response?.docs ?? []).filter(doc => !previous.has(doc.id))
            })),
            history ? request(history, 0) : null,
        ])
        if (!separateInputs) {
            results.push({ strategy, docs: pools[0].slice(0, wanted) })
            continue
        }
        const entries = profileFactEntries(strategy, profileStore, profileSubject)
        const matches = doc => matchingInputs(entries, doc, profileStore)
        const combined = combinedQuery ? pools.shift() : []
        const lead = combined.find(doc => matches(doc).length >= 2)
        const counts = queries.map((_, i) => past?.facets?.[`input${i}`]?.count ?? 0)
        results.push({ strategy, docs: selectDiverseDocs(pools, wanted, { counts, matches, lead }) })
    }
    const serverUnreachable = attempted > 0 ? reached === 0 : !(await solrReachable(solrEndpoint))
    return { results, serverUnreachable }
}

// Cheap liveness check: a match-all query asking for zero rows. true only on a
// successful (2xx) Solr response; a thrown fetch or non-OK status means unreachable.
async function solrReachable(solrEndpoint) {
    try {
        await fetchSolr(solrEndpoint, { q: "*:*", fq: [] }, 0)
        return true
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

// Form-encoded POST keeps growing history out of the URL and works through the
// read proxy without a CORS preflight. Repeated fq parameters stay separate.
async function fetchSolr(endpoint, { q, fq, sort, params = {} }, limit) {
    const body = new URLSearchParams({ q, ...params, rows: String(limit), wt: "json" })
    for (const f of fq) body.append("fq", f)
    if (sort) body.set("sort", sort)
    const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
    })
    if (!response.ok) throw new Error(`Solr ${response.status}`)
    return response.json()
}
