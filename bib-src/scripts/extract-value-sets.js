#!/usr/bin/env node
// Extracts the closed value sets the profile assistant offers as chips from the live
// catalogue index and writes them as SKOS concept schemes into resources/ (committed snapshots, like
// the vendored gnd-sc.ttl — bundling keeps both hosts identical and offline-safe).
// Run `npm run extract-value-sets` after each reindex — it invokes this script and
// then ttl-to-js, so the bundled copies stay in sync.
//
//   node scripts/extract-value-sets.js [solr-select-endpoint]
//
// Currently emits:
//   genre-values.ttl — the catalogue's genre vocabulary. MSB's 655 carries
//     bibliographic *forms* (Kochbuch, Ratgeber, Biografie, Führer …), not literary
//     fiction genres (no Krimi/Fantasy; fiction is just "Fiktionale Darstellung"),
//     and virtually no authority links — so the honest value set is these catalogue
//     labels, stored as literals (cori:LabelLiteral) that match the index's genre
//     field directly.
//   language-values.ttl — the languages of the holdings. The index carries ISO
//     639-2/B codes ("ger"), so each concept displays a German name and carries the
//     code as bp:indexValue for query building. Stored as concept IRIs.
//   medium-values.ttl — the media types (format field). Catalogue jargon is
//     relabeled for users ("Druckschrift" -> "Buch") and combo values are merged
//     into their base medium, so a concept may carry several bp:indexValue tokens.
//     Stored as concept IRIs.
//   author-suggestions.ttl — not a closed set but what the assistant offers to tap on
//     the authors card: the authors the library invests in most visibly, those whose
//     recent German titles it holds as book, e-book and audiobook alike. The index has
//     no lending figures; breadth of forms is the nearest sign of demand it carries.
// Every concept carries a cori:order: the assistant shows the first few chips and folds
// the rest away, so the order decides what a reader sees first.

import { writeFileSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const SOLR = process.argv[2] ?? "https://bib-pods.ngrok.dev/solr/interim-index/select"
const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "resources")

const BP = "https://www.muenchner-stadtbibliothek.de/bib-pods#"

// Only values with at least this many records are offered: rarer genres would
// produce lanes too thin to fill.
const GENRE_MIN_COUNT = 300

// The forms a reader would name as a taste, in the order they are offered. Everything
// else (the academic and reference forms: Aufsatzsammlung, Kongress, Verzeichnis …)
// follows by record count, behind the assistant's "weitere" fold. A curation point
// like GENRE_EXCLUDE.
const GENRE_FIRST = [
    "Ratgeber", "Kochbuch", "Biografie", "Führer", "Bildband", "Reisebericht",
    "Erlebnisbericht", "Comic", "Kinderbuch", "Bilderbuch", "Jugendbuch", "Kindersachbuch",
    "Jugendsachbuch", "Autobiografie", "Humoristische Darstellung", "Fiktionale Darstellung",
]

// 655 values that describe the physical/media form rather than a content genre a
// user would pick as taste. Qualifier variants ("Musiktonträger <für Kinder>") are
// excluded with their base. This list is the curation point — extend as needed.
const GENRE_EXCLUDE = new Set([
    "Musikdruck", "Musiktonträger", "CD", "CD-ROM", "DVD-Video", "Blu-Ray-Disc",
    "Tonkassette", "Karte", "Text", "Musikhandschrift", "Sampler",
])

// Facets need the *_str copyField twins — the base fields are schemaless
// text_general and yield no buckets (see interim-index/field-notes.md §6).
// Fetches the complete facet (mincount=1, no limit) so the caller can report
// exactly how much the threshold cuts off.
async function facetValues(field) {
    const url = `${SOLR}?q=*:*&rows=0&wt=json&facet=true&facet.field=${field}&facet.limit=-1&facet.mincount=1`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Solr ${res.status}: ${res.statusText}`)
    const flat = (await res.json()).facet_counts.facet_fields[field]
    const values = []
    for (let i = 0; i < flat.length; i += 2) values.push({ label: flat[i], count: flat[i + 1] })
    return values
}

// How many records a query matches.
async function countRecords(q) {
    const res = await fetch(`${SOLR}?q=${encodeURIComponent(q)}&rows=0&wt=json`)
    if (!res.ok) throw new Error(`Solr ${res.status}: ${res.statusText}`)
    return (await res.json()).response.numFound
}

// Concept IRIs are minted from the label (stable across re-extractions, so diffs
// show real vocabulary changes); the label itself stays authoritative via prefLabel.
function slug(label) {
    return label.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "")
}

function ttlString(s) {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

// `definition` is user-facing: the dialog assistant shows it with the chips, so say in
// one or two plain German sentences where the values come from.
// `values` arrive in the order they are offered (emitted as cori:order). They may carry
// `indexValues`: the raw catalogue tokens the concept stands for, emitted as
// bp:indexValue — needed whenever the display label isn't the index token.
function conceptScheme({ schemeName, schemeLabel, conceptPrefix, values, comment, definition }) {
    const concepts = values.map((v, i) => ({ ...v, order: i + 1, iri: `bp:${conceptPrefix}-${slug(v.label)}` }))
    const lines = [
        `# GENERATED by scripts/extract-value-sets.js — edit the script, not this file.`,
        `# ${comment}`,
        `# Snapshot: ${new Date().toISOString().slice(0, 10)}, source: ${SOLR}`,
        ``,
        `@prefix bp:   <${BP}> .`,
        `@prefix cori: <https://cori.systems/core#> .`,
        `@prefix skos: <http://www.w3.org/2004/02/skos/core#> .`,
        ``,
        `bp:${schemeName} a skos:ConceptScheme ;`,
        `    skos:prefLabel ${ttlString(schemeLabel)}@de ;`,
        `    skos:definition ${ttlString(definition)}@de ;`,
        `    skos:hasTopConcept`,
        [...concepts].sort((a, b) => a.label.localeCompare(b.label, "de")).map(c => `        ${c.iri}`).join(",\n") + " .",
        ``,
    ]
    for (const c of concepts) {
        lines.push(`${c.iri} a skos:Concept ;`)
        lines.push(`    skos:prefLabel ${ttlString(c.label)}@de ;`)
        if (c.indexValues) lines.push(`    bp:indexValue ${c.indexValues.map(ttlString).join(", ")} ;`)
        lines.push(`    cori:order ${c.order} . # ${c.count.toLocaleString("en")} records`)
    }
    return lines.join("\n") + "\n"
}

const allGenres = await facetValues("genre_str")
const belowThreshold = allGenres.filter(v => v.count < GENRE_MIN_COUNT)
const frequent = allGenres.filter(v => v.count >= GENRE_MIN_COUNT)
const rank = v => GENRE_FIRST.includes(v.label) ? GENRE_FIRST.indexOf(v.label) : GENRE_FIRST.length
const genres = frequent
    .filter(v => !GENRE_EXCLUDE.has(v.label.replace(/\s*<[^>]*>\s*$/, "")))
    .sort((a, b) => rank(a) - rank(b) || b.count - a.count)
const mediumLike = frequent.length - genres.length
for (const label of GENRE_FIRST.filter(l => !genres.some(v => v.label === l))) {
    console.warn(`GENRE_FIRST names a genre the catalogue no longer offers: ${label}`)
}

const outPath = resolve(OUT_DIR, "genre-values.ttl")
writeFileSync(outPath, conceptScheme({
    schemeName: "GenreValues",
    schemeLabel: "Genres im Katalog",
    conceptPrefix: "genre",
    values: genres,
    comment: `The catalogue's genre value set: ${genres.length} of ${allGenres.length} distinct genre_str facet values. `
        + `Excluded: ${belowThreshold.length} values below ${GENRE_MIN_COUNT} records `
        + `(a long tail of one-offs and typos covering ${belowThreshold.reduce((n, v) => n + v.count, 0).toLocaleString("en")} records in total) `
        + `and ${mediumLike} medium-like terms (physical form, not content genre). `
        + `Offered in GENRE_FIRST order, then by record count.`,
    definition: `Die ${genres.length} häufigsten Genre-Angaben im Katalog. `
        + `Romane tragen dort meist kein Genre: Sie findest du über Autor*innen und Titel.`,
}))
console.log(`wrote ${outPath} (${genres.length} concepts; dropped ${belowThreshold.length} below min-count, ${mediumLike} medium-like)`)

// ----- Languages (bp:preferredLanguage) -----

const LANGUAGE_MIN_COUNT = 300

// The index stores ISO 639-2/B codes; the chips must display German names. Every
// frequent code needs an entry here — unmapped frequent codes are dropped loudly
// (console warning), so a reindex introducing new codes surfaces at extraction.
const LANGUAGE_LABELS = new Map([
    ["ara", "Arabisch"], ["chi", "Chinesisch"], ["cze", "Tschechisch"], ["dan", "Dänisch"],
    ["dut", "Niederländisch"], ["eng", "Englisch"], ["fin", "Finnisch"], ["fre", "Französisch"],
    ["ger", "Deutsch"], ["gre", "Griechisch"], ["heb", "Hebräisch"], ["hrv", "Kroatisch"],
    ["hun", "Ungarisch"], ["ita", "Italienisch"], ["jpn", "Japanisch"], ["kor", "Koreanisch"],
    ["lat", "Latein"], ["nor", "Norwegisch"], ["per", "Persisch"], ["pol", "Polnisch"],
    ["por", "Portugiesisch"], ["rum", "Rumänisch"], ["rus", "Russisch"], ["spa", "Spanisch"],
    ["swe", "Schwedisch"], ["tur", "Türkisch"], ["ukr", "Ukrainisch"],
])

// Codes that aren't a language a user could prefer: unb (MSB's "unbestimmt" — no
// language recorded, the single biggest bucket), zxx (no linguistic content, e.g.
// instrumental music), mul (multiple), mis (miscellaneous), und (undetermined),
// xxd (local placeholder).
const LANGUAGE_EXCLUDE = new Set(["unb", "zxx", "mul", "mis", "und", "xxd"])

const allLanguages = await facetValues("language_str")
const languagesBelow = allLanguages.filter(v => v.count < LANGUAGE_MIN_COUNT)
const frequentLanguages = allLanguages.filter(v => v.count >= LANGUAGE_MIN_COUNT && !LANGUAGE_EXCLUDE.has(v.label))
const nonLanguage = allLanguages.filter(v => v.count >= LANGUAGE_MIN_COUNT && LANGUAGE_EXCLUDE.has(v.label))
for (const v of frequentLanguages.filter(v => !LANGUAGE_LABELS.has(v.label))) {
    console.warn(`SKIPPING frequent language code without a German label: ${v.label} (${v.count} records) — extend LANGUAGE_LABELS`)
}
const languages = frequentLanguages
    .filter(v => LANGUAGE_LABELS.has(v.label))
    .map(v => ({ label: LANGUAGE_LABELS.get(v.label), count: v.count, indexValues: [v.label] }))
    .sort((a, b) => b.count - a.count)

// A language filter keeps only records that carry a language, and for a large part of
// the books (the older stock) none is recorded. The card says so, with the share.
const BOOKS = 'format:(Druckschrift OR "E-Book")'
const NO_LANGUAGE = `language:(${[...LANGUAGE_EXCLUDE].join(" OR ")})`
const RECENT_FROM = new Date().getFullYear() - 8
const books = await countRecords(BOOKS)
const booksWithoutLanguage = await countRecords(`${BOOKS} AND ${NO_LANGUAGE}`)
const recentBooks = await countRecords(`${BOOKS} AND publishDateSort:[${RECENT_FROM} TO *]`)
const recentBooksWithoutLanguage = await countRecords(`${BOOKS} AND publishDateSort:[${RECENT_FROM} TO *] AND ${NO_LANGUAGE}`)
const shareWithoutLanguage = Math.round(100 * booksWithoutLanguage / books)

const languagesPath = resolve(OUT_DIR, "language-values.ttl")
writeFileSync(languagesPath, conceptScheme({
    schemeName: "LanguageValues",
    schemeLabel: "Sprachen im Katalog",
    conceptPrefix: "language",
    values: languages,
    comment: `The catalogue's language value set: ${languages.length} of ${allLanguages.length} distinct language_str facet values, `
        + `ISO 639-2/B codes relabeled to German names (the code stays queryable as bp:indexValue). `
        + `Excluded: ${languagesBelow.length} values below ${LANGUAGE_MIN_COUNT} records `
        + `(covering ${languagesBelow.reduce((n, v) => n + v.count, 0).toLocaleString("en")} records in total) `
        + `and the non-language codes ${nonLanguage.map(v => v.label).join("/")} `
        + `(covering ${nonLanguage.reduce((n, v) => n + v.count, 0).toLocaleString("en")} records). `
        + `Offered by record count. Books without a language: ${booksWithoutLanguage.toLocaleString("en")} of ${books.toLocaleString("en")}; `
        + `published since ${RECENT_FROM}: ${recentBooksWithoutLanguage.toLocaleString("en")} of ${recentBooks.toLocaleString("en")}.`,
    definition: `Die ${languages.length} häufigsten Sprachen im Katalog, die häufigste zuerst. `
        + `Bei ${shareWithoutLanguage} % der Bücher, vor allem älteren, ist keine Sprache erfasst: `
        + `Sie fallen heraus, sobald du eine Sprache wählst.`,
}))
console.log(`wrote ${languagesPath} (${languages.length} concepts; dropped ${languagesBelow.length} below min-count, ${nonLanguage.length} non-language codes)`)

// ----- Media types (bp:preferredMedium) -----

const MEDIUM_MIN_COUNT = 300

// Catalogue jargon -> user-facing label. Values mapping to the same label merge into
// one concept carrying all their raw tokens as bp:indexValue (counts add up): a user
// picking "Buch" shouldn't have to know that book+CD sets are catalogued separately.
// Frequent values not listed keep their raw label (CD, E-Book, LP, ... are fine as-is).
const MEDIUM_RELABEL = new Map([
    ["Druckschrift", "Buch"],
    ["Buch + CD", "Buch"],
    ["Buch + CD-ROM", "Buch"],
    ["Noten + CD", "Noten"],
    ["DVD-Video", "DVD"],
    ["Karte allgemein", "Karte"],
])

// Formats nobody picks as a media preference: archival material, opaque legacy codes
// (CC/VC = audio/video cassette), and the catch-all Medienkombination.
const MEDIUM_EXCLUDE = new Set([
    "Microfilm", "Musikhandschrift", "Medienkombination", "E-Speichermedium", "CC", "VC",
])

const allMedia = await facetValues("format_str")
const mediaBelow = allMedia.filter(v => v.count < MEDIUM_MIN_COUNT)
const frequentMedia = allMedia.filter(v => v.count >= MEDIUM_MIN_COUNT)
const mediaExcluded = frequentMedia.filter(v => MEDIUM_EXCLUDE.has(v.label))
const byLabel = new Map()
for (const v of frequentMedia) {
    if (MEDIUM_EXCLUDE.has(v.label)) continue
    const label = MEDIUM_RELABEL.get(v.label) ?? v.label
    if (!byLabel.has(label)) byLabel.set(label, { label, count: 0, indexValues: [] })
    const c = byLabel.get(label)
    c.count += v.count
    c.indexValues.push(v.label)
}
const media = [...byLabel.values()].sort((a, b) => b.count - a.count)
const merged = frequentMedia.length - mediaExcluded.length - media.length

const mediaPath = resolve(OUT_DIR, "medium-values.ttl")
writeFileSync(mediaPath, conceptScheme({
    schemeName: "MediumValues",
    schemeLabel: "Medienarten im Katalog",
    conceptPrefix: "medium",
    values: media,
    comment: `The catalogue's media-type value set: ${media.length} concepts from ${allMedia.length} distinct format_str facet values, `
        + `relabeled/merged for users (raw tokens stay queryable as bp:indexValue; ${merged} combo values merged into their base medium). `
        + `Excluded: ${mediaBelow.length} values below ${MEDIUM_MIN_COUNT} records `
        + `(covering ${mediaBelow.reduce((n, v) => n + v.count, 0).toLocaleString("en")} records in total) `
        + `and ${mediaExcluded.length} archival/opaque formats (${mediaExcluded.map(v => v.label).join(", ")}). `
        + `Offered by record count.`,
    definition: `Die häufigsten Medienarten im Katalog, die häufigste zuerst. `
        + `Manche Katalogbegriffe heißen hier anders: Aus „Druckschrift“ wird „Buch“.`,
}))
console.log(`wrote ${mediaPath} (${media.length} concepts; dropped ${mediaBelow.length} below min-count, ${mediaExcluded.length} excluded, ${merged} merged)`)

// ----- Author suggestions (bp:favoriteAuthor) -----

// The forms a title can be read or listened to in (raw format tokens): print, e-book,
// and audiobook as download, MP3-CD or CD. Music on CD carries no language, so the
// German-language restriction keeps it out.
const READING_FORMS = ["Druckschrift", "E-Book", "E-Audio", "MP3-CD", "CD"]
const AUTHOR_SUGGESTIONS = 36
// How many authors (by record count) are looked at; those further down hold too few
// recent titles to lead a list of suggestions anyway.
const AUTHOR_POOL = 1000

const authorQuery = `language:ger AND publishDateSort:[${RECENT_FROM} TO *] AND format:(${READING_FORMS.map(f => `"${f}"`).join(" OR ")}) AND author:[* TO *]`
const authorFacet = { authors: { type: "terms", field: "author_str", limit: AUTHOR_POOL, facet: { forms: "unique(format_str)" } } }
const authorRes = await fetch(`${SOLR}?q=${encodeURIComponent(authorQuery)}&rows=0&wt=json&json.facet=${encodeURIComponent(JSON.stringify(authorFacet))}`)
if (!authorRes.ok) throw new Error(`Solr ${authorRes.status}: ${authorRes.statusText}`)
const authorPool = (await authorRes.json()).facets.authors.buckets
// most forms first, then most records
const suggestedAuthors = authorPool
    .map(b => ({ label: b.val, count: b.count, forms: b.forms }))
    .sort((a, b) => b.forms - a.forms || b.count - a.count)
    .slice(0, AUTHOR_SUGGESTIONS)
const fewestForms = Math.min(...suggestedAuthors.map(a => a.forms))

const authorsPath = resolve(OUT_DIR, "author-suggestions.ttl")
writeFileSync(authorsPath, conceptScheme({
    schemeName: "AuthorSuggestions",
    schemeLabel: "Vorschläge für Autor*innen",
    conceptPrefix: "author-suggestion",
    values: suggestedAuthors,
    comment: `Author suggestions: of the ${authorPool.length} authors with the most German-language records published since ${RECENT_FROM} `
        + `in the forms ${READING_FORMS.join(", ")}, the ${suggestedAuthors.length} held in the most of these forms `
        + `(${fewestForms} to ${READING_FORMS.length}), ties broken by record count. The label is the catalogue's own name form.`,
    definition: `Im Bestand als Buch, E-Book und Hörbuch vertreten, mit vielen neueren Titeln.`,
}))
console.log(`wrote ${authorsPath} (${suggestedAuthors.length} authors, each in ${fewestForms}+ of ${READING_FORMS.length} forms)`)
