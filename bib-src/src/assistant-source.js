// What the catalogue contributes to the cards of the profile assistant
// (cori-sdk/ui/assistant.js): a search over the values the index itself holds, what is
// frequent in the stock as suggestions to tap, values that occur together with a
// chosen one, how much the filters leave over, and which lanes a field feeds.
// A value picked here is stored the way the book dialog stores it (valueFacts): the
// catalogue's own entry, with its authority IRI where the index has one. Nothing typed
// goes into the profile unmatched.
// Every request is a /select on the index, the one path its read proxy lets through.
import { getVocab, getProfileSubject, getLabel, getOne, RDF_TYPE, CORI } from "cori-sdk/utils.js"
import { BP, NO_IRI } from "./vocab.js"
import {
    getLinkedIndices, escapeSolr, getStrategies, readStrategyChoices, resolveStrategyEnabled,
    buildValueQuery, buildShelfQuery, hasPreferenceFilters, countMatches,
} from "./recommendations.js"
import { cleanAuthorName, valueFacts } from "./book-options.js"

const SKOS = "http://www.w3.org/2004/02/skos/core#"
const AUTHOR = BP + "favoriteAuthor"
const TOPIC = BP + "interestedIn"
const GENRE = BP + "favoriteGenre"
const PLACE = BP + "interestedInPlace"

// The authors card has a second snapshot for a profile narrowed to children's age
// groups (bp:preferredAudience without the adults' group): the children's authors.
// Both names are minted by scripts/extract-value-sets.js.
const AUDIENCE = BP + "preferredAudience"
const ADULTS = BP + "audience-Erwachsene"
const CHILDRENS_AUTHORS = BP + "ChildrensAuthorSuggestions"

// Suggestions describe the newer part of the stock: what was published in the last
// eight years, as books (the raw tokens behind the media types Buch and E-Book).
const RECENT = `publishDateSort:[${new Date().getFullYear() - 8} TO *]`
const BOOKS = 'format:(Druckschrift OR "E-Book")'

// Subject headings that are frequent but no taste: too general to say anything, a
// form filed as a subject (Führer), the stock of language-learning and school material,
// and the philately collection.
const TOPIC_SKIP = new Set([
    "Kind", "Frau", "Mann", "Mensch", "Alltag", "Kritik", "Recht", "Unternehmen", "Führung", "Führer",
    "Bewältigung", "Prävention", "Deutsch", "Englisch", "Französisch", "Italienisch", "Spanisch",
    "Fremdsprache", "Fremdsprachenlektüre", "Landeskunde", "Kindertagesstätte", "Grundschule",
    "Gymnasium", "Prüfungsvorbereitung", "Postgeschichte <Fach>", "Berühmte Sammlung <Philatelie>",
    "Klassische Briefmarke",
])

// Per field whose suggestions come from the live index: which records they are counted
// over, and the line that says so on the card. A field with bp:suggestedValues offers
// that snapshot instead (authors: their ranking is too slow to ask for live).
const SUGGESTIONS = {
    [TOPIC]: {
        caption: "Häufige Themen in neueren Büchern des Bestands, ohne Lern- und Nachschlagewerke",
        q: `${BOOKS} AND ${RECENT} -genre:(Aufgabensammlung OR Lehrbuch OR Lehrmittel OR Schulbuch OR Übungssammlung`
            + ` OR Wörterbuch OR Kommentar OR Formularsammlung OR Kindersachbuch OR Jugendsachbuch OR Auktionskatalog`
            + ` OR Verzeichnis OR Quelle)`,
        skip: TOPIC_SKIP,
    },
    [PLACE]: {
        caption: "Häufige Orte und Regionen in neueren Büchern des Bestands",
        q: `${BOOKS} AND ${RECENT}`,
    },
}
const SUGGESTION_COUNT = 36

// Neighbours are looked for among topics and places, for a value of any field that
// shares their lane.
const RELATED_IN = [TOPIC, PLACE]
const RELATED_FOR = [TOPIC, PLACE, GENRE]
const RELATED_COUNT = 6
const RELATED_MIN_RECORDS = 5

const number = n => n.toLocaleString("de-DE")

// The words of a text as the index tokenises them: lower-cased runs of letters and
// digits. Used both to build prefix queries and to check facet values against them.
const words = s => s.toLocaleLowerCase("de-DE").split(/[^\p{L}\p{N}]+/u).filter(Boolean)

// Every typed word starts a word of the value: "cornelia fu" finds "Funke, Cornelia".
const matches = (value, tokens) => {
    const valueWords = words(value)
    return tokens.every(t => valueWords.some(w => w.startsWith(t)))
}

// "1958-" / "1903-1989" at the end of a catalogue name: the life dates that tell
// namesakes apart.
function lifeDates(raw) {
    const m = raw.match(/\s(\d{4})-(\d{0,4})\s*$/)
    return m ? `${m[1]}–${m[2]}` : null
}

// One person under two name forms: the library's own records name an author with life
// dates and a GND link ("Kemmerer, Brigid 1978-"), the Onleihe's e-book records often
// only as a co-author without either ("Kemmerer, Brigid"). [raw, count] pairs come back
// with each undated form folded into the dated one of the same name, counts added up and
// the undated forms kept as `alsoRaw`; where several dated forms share a name
// (namesakes), the undated one could be any of them and stays apart.
function foldUndated(counted) {
    const name = raw => raw.replace(/\s\d{4}-\d{0,4}\s*$/, "")
    const dated = new Map()
    for (const [raw] of counted) {
        if (lifeDates(raw)) dated.set(name(raw), dated.has(name(raw)) ? null : raw)
    }
    const folded = new Map(counted.map(([raw, count]) => [raw, { raw, count, alsoRaw: [] }]))
    for (const [raw, count] of counted) {
        const into = !lifeDates(raw) && dated.get(raw)
        if (!into) continue
        folded.get(into).count += count
        folded.get(into).alsoRaw.push(raw)
        folded.delete(raw)
    }
    return [...folded.values()]
}

export function createAssistantSource({ solrEndpoint }) {
    // Form-encoded POST, as the lanes' queries: no CORS preflight through the read
    // proxy. Array values repeat their parameter (facet.field).
    async function select(params) {
        const body = new URLSearchParams({ wt: "json" })
        for (const [key, value] of Object.entries(params)) {
            for (const v of [].concat(value)) body.append(key, String(v))
        }
        const response = await fetch(solrEndpoint, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body,
        })
        if (!response.ok) throw new Error(`Solr ${response.status}`)
        return response.json()
    }

    // Facets come off the *_str twins of the label fields (the base fields are
    // tokenised and yield no buckets), as [{ value, count }].
    const facetField = labelField => `${labelField}_str`
    function facetValues(json, labelField) {
        const flat = json.facet_counts?.facet_fields?.[facetField(labelField)] ?? []
        const values = []
        for (let i = 0; i < flat.length; i += 2) values.push({ value: flat[i], count: flat[i + 1] })
        return values
    }
    const labelFields = field => getLinkedIndices(getVocab(), field).map(m => m.labelField).filter(Boolean)

    // A catalogue value as the cards show it. Authors read in natural order, with their
    // life dates beside the name; `raw` stays the index's own form.
    function toItem(field, raw, count) {
        const author = field === AUTHOR
        return {
            field,
            raw,
            label: author ? cleanAuthorName(raw) : raw,
            note: author ? lifeDates(raw) : null,
            count,
        }
    }

    // Type-ahead: the field's index values in which every typed word starts a word,
    // most frequent first. The query narrows to records carrying such a value; the
    // facets over those records also hold their other values, which the word check
    // drops.
    async function search(field, text) {
        const tokens = words(text)
        const fields = labelFields(field)
        if (fields.length === 0 || tokens.join("").length < 2) return []
        const prefixes = `(${tokens.map(t => `${t}*`).join(" AND ")})`
        const longest = tokens.reduce((a, b) => b.length > a.length ? b : a)
        const json = await select({
            q: fields.map(f => `${f}:${prefixes}`).join(" OR "),
            rows: 0,
            facet: "true",
            "facet.field": fields.map(facetField),
            "facet.limit": 60,
            "facet.mincount": 1,
            "facet.contains": longest,
            "facet.contains.ignoreCase": "true",
        })
        const counts = new Map()
        for (const f of fields) {
            for (const { value, count } of facetValues(json, f)) {
                if (matches(value, tokens)) counts.set(value, (counts.get(value) ?? 0) + count)
            }
        }
        const values = field === AUTHOR ? foldUndated([...counts]) : [...counts].map(([raw, count]) => ({ raw, count, alsoRaw: [] }))
        return values
            .sort((a, b) => b.count - a.count || a.raw.localeCompare(b.raw, "de"))
            .slice(0, 8)
            .map(({ raw, count, alsoRaw }) => ({ ...toItem(field, raw, count), alsoRaw, hint: count === 1 ? "1 Titel" : `${number(count)} Titel` }))
    }

    // What storing a picked value writes. The authority IRI is read off a record that
    // carries the value: label and IRI arrays are position-aligned. A value without one
    // (or an index that doesn't answer) is stored by its label, as the book dialog does.
    async function facts({ field, raw, label, alsoRaw = [] }) {
        let iri
        try {
            for (const m of getLinkedIndices(getVocab(), field)) {
                if (!m.labelField || !m.iriField) continue
                const json = await select({
                    q: `${facetField(m.labelField)}:"${escapeSolr(raw)}"`,
                    rows: 5,
                    fl: `${m.labelField},${m.iriField}`,
                })
                for (const doc of json.response.docs) {
                    const candidate = doc[m.iriField]?.[(doc[m.labelField] ?? []).indexOf(raw)]
                    if (candidate && candidate !== NO_IRI) { iri = candidate; break }
                }
                if (iri) break
            }
        } catch (err) {
            console.error("[bib-pods] authority lookup failed, storing the label:", err)
        }
        return valueFacts(field, { rawLabel: raw, cleanedLabel: label, iri, alsoRaw })
    }

    // The snapshot a field's card offers to this profile: its bp:suggestedValues, for
    // authors the children's list where the profile looks for children only.
    function snapshotOf(field, store) {
        const v = getVocab()
        if (field === AUTHOR && v.getObjects(CHILDRENS_AUTHORS, SKOS + "hasTopConcept", null).length > 0) {
            const audiences = store.getObjects(getProfileSubject(), AUDIENCE, null).map(o => o.value)
            if (audiences.length > 0 && !audiences.includes(ADULTS)) return CHILDRENS_AUTHORS
        }
        return getOne(v, field, BP + "suggestedValues")
    }

    // A field's snapshot of suggestions as { caption, items }, or null.
    function snapshotSuggestions(field, store) {
        const v = getVocab()
        const scheme = snapshotOf(field, store)
        if (!scheme) return null
        const concepts = v.getObjects(scheme, SKOS + "hasTopConcept", null).map(c => ({
            raw: getOne(v, c.value, SKOS + "prefLabel"),
            order: Number(getOne(v, c.value, CORI + "order") ?? Number.MAX_SAFE_INTEGER),
        })).filter(c => c.raw).sort((a, b) => a.order - b.order)
        return {
            caption: getOne(v, scheme, SKOS + "definition") ?? "",
            items: concepts.map(c => toItem(field, c.raw, null)),
        }
    }

    // The same for every profile, so each field's list is fetched once per page view.
    const suggestionCache = new Map()
    function suggest(field, store) {
        const snapshot = snapshotSuggestions(field, store)
        if (snapshot) return snapshot
        const spec = SUGGESTIONS[field]
        const labelField = labelFields(field)[0]
        if (!spec || !labelField) return null
        if (!suggestionCache.has(field)) {
            suggestionCache.set(field, select({
                q: spec.q,
                rows: 0,
                facet: "true",
                "facet.field": facetField(labelField),
                "facet.limit": SUGGESTION_COUNT + (spec.skip?.size ?? 0),
                "facet.mincount": 1,
            }).then(json => ({
                caption: spec.caption,
                items: facetValues(json, labelField)
                    .filter(({ value }) => !spec.skip?.has(value))
                    .slice(0, SUGGESTION_COUNT)
                    .map(({ value, count }) => toItem(field, value, count)),
            })).catch(err => {
                suggestionCache.delete(field)
                throw err
            }))
        }
        return suggestionCache.get(field)
    }

    // Topics and places the catalogue records together with a chosen value, across the
    // field borders: books on Wandern are often about the Bayerische Alpen.
    // anchor = { object, label }: the chosen value's RDF term and display text.
    async function related(field, anchor, store) {
        if (!RELATED_FOR.includes(field)) return null
        const q = buildValueQuery(field, anchor.object, store)
        if (!q) return null
        const targets = RELATED_IN.map(f => ({ field: f, labelField: labelFields(f)[0] })).filter(t => t.labelField)
        const json = await select({
            q,
            rows: 0,
            facet: "true",
            "facet.field": targets.map(t => facetField(t.labelField)),
            "facet.limit": 20,
            "facet.mincount": RELATED_MIN_RECORDS,
        })
        const items = targets.flatMap(t => facetValues(json, t.labelField)
            .filter(({ value }) => value !== anchor.label && !TOPIC_SKIP.has(value))
            .map(({ value, count }) => ({ ...toItem(t.field, value, count), kind: getLabel(t.field) })))
            .sort((a, b) => b.count - a.count)
            .slice(0, RELATED_COUNT)
        return items.length ? { caption: `Kommt im Katalog oft zusammen mit „${anchor.label}“ vor`, items } : null
    }

    async function filterNote(store, subject) {
        if (!hasPreferenceFilters(store, subject)) return null
        const [all, left] = await Promise.all([
            countMatches(buildShelfQuery(store, subject, { preferences: false }), solrEndpoint),
            countMatches(buildShelfQuery(store, subject), solrEndpoint),
        ])
        if (!all || left === null) return null
        const note = document.createElement("p")
        note.className = "bp-filter-note"
        note.classList.toggle("is-empty", left === 0)
        note.textContent = left === 0
            ? `Mit deinen Einschränkungen bleibt von ${number(all)} passenden Titeln keiner übrig.`
            : `Mit deinen Einschränkungen ${left === 1 ? "bleibt" : "bleiben"} ${number(left)} von ${number(all)} passenden Titeln übrig.`
        return note
    }

    // Which lanes a field's entries feed, or that the lane for them is switched off.
    function hint(field, store) {
        const usedBy = getStrategies().filter(s => s.properties.includes(field))
        if (usedBy.length === 0) return null
        const choices = readStrategyChoices(store)
        const on = usedBy.filter(s => resolveStrategyEnabled(s, choices))
        const names = list => new Intl.ListFormat("de", { type: "conjunction" }).format(list.map(s => `„${s.label}“`))
        if (on.length === 0) {
            return (usedBy.length === 1 ? `Die Reihe ${names(usedBy)} ist ausgeschaltet.` : `Die Reihen ${names(usedBy)} sind ausgeschaltet.`)
                + " Im Schaufenster schaltest du sie unter „Reihen auswählen“ ein."
        }
        return on.length === 1 ? `Daraus entsteht die Reihe ${names(on)}.` : `Daraus entstehen die Reihen ${names(on)}.`
    }

    // What the answers on a card do. Only the filter cards have something to show: how
    // much of what the lanes draw on the profile's filters leave over.
    function preview(field, store) {
        const isFilter = getVocab().getQuads(field, RDF_TYPE, BP + "RecommendationFilter", null).length > 0
        return isFilter ? filterNote(store, getProfileSubject()) : null
    }

    return { search, facts, suggest, related, preview, hint }
}
