// The options the book dialogs offer and the profile changes they make, kept free of
// DOM so they can be tested. A follow-up spec comes from getFollowUpsFor(); an option
// is one value the book carries for it: { rawLabel, cleanedLabel, iri }.
import { RDFS_LABEL } from "cori-sdk/utils.js"
import { BP, LOCAL, NO_IRI } from "./vocab.js"
import { profileFactsMatching } from "./recommendations.js"

// MARC 100 author strings arrive as "Lastname, Firstname YYYY-YYYY?"
// strip the trailing date range and swap the comma'd name to its natural order
export function cleanAuthorName(s) {
    const withoutDates = s.replace(/\s+\d{4}-\d{0,4}\s*$/, "").trim()
    const comma = withoutDates.indexOf(",")
    if (comma === -1) return withoutDates
    const last = withoutDates.slice(0, comma).trim()
    const first = withoutDates.slice(comma + 1).trim()
    return first ? `${first} ${last}` : last
}

// One option per value the book carries in the spec's index fields.
export function collectOptions(spec, book) {
    const clean = spec.source === BP + "favoriteAuthor" ? cleanAuthorName : (s) => s
    const options = []
    for (const f of spec.fields) {
        const labels = book[f.labelField]
        if (!labels || labels.length === 0) continue
        const iris = f.iriField ? book[f.iriField] : null
        for (let i = 0; i < labels.length; i++) {
            const iri = iris?.[i]
            options.push({ rawLabel: labels[i], cleanedLabel: clean(labels[i]), iri: iri === NO_IRI ? undefined : iri })
        }
    }
    return options
}

// The facts that store an option under `predicate`.
export function valueFacts(predicate, { rawLabel, cleanedLabel, iri }) {
    // authority IRI is the source of truth, we store however the cleaned label locally
    if (iri) return [{ predicate, object: iri }, { subject: iri, predicate: RDFS_LABEL, object: cleanedLabel }]
    // no authority IRI, mint a local URN so the entity has a graph node to attach facts to
    if (rawLabel !== cleanedLabel) {
        const localUri = LOCAL + "author:" + encodeURIComponent(rawLabel)
        return [
            { predicate, object: localUri },
            { subject: localUri, predicate: RDFS_LABEL, object: cleanedLabel },
            { subject: localUri, predicate: BP + "sourceLabel", object: rawLabel },
        ]
    }
    // no IRI, rawLabel === cleanedLabel, nothing to preserve, store as plain literal
    return [{ predicate, object: cleanedLabel }]
}

// The profile's values of the spec's taste field that stand for this option, however
// they got there (book prompt, picker, assistant).
export function profileValuesFor(spec, option, profileStore, profileSubject) {
    const doc = {}
    for (const f of spec.fields) {
        doc[f.labelField] = [option.rawLabel]
        if (f.iriField && option.iri) doc[f.iriField] = [option.iri]
    }
    return profileFactsMatching(spec.source, doc, profileStore, profileSubject)
}

// Does the book carry this option in any of the spec's index fields?
export function bookHasOption(spec, option, book) {
    return spec.fields.some(f => [].concat(book[f.labelField] ?? []).includes(option.rawLabel)
        || (option.iri && f.iriField && [].concat(book[f.iriField] ?? []).includes(option.iri)))
}

// What „Nicht mehr vorschlagen“ changes: the title goes to its exclusion property; every
// ticked value is blocked, and removed from the profile's tastes if it is among them.
// Removals run first (see changeProfileFacts), so a value whose node the removal clears
// gets its labels back with the block.
//   chosen = { sopacId, title: bool, titleProperty, options: [{ spec, option }] }
export function dismissalChanges(chosen, profileStore, profileSubject) {
    const remove = []
    const add = chosen.title ? [{ predicate: chosen.titleProperty, object: chosen.sopacId }] : []
    for (const { spec, option } of chosen.options) {
        const present = profileValuesFor(spec, option, profileStore, profileSubject)
        remove.push(...present.map(object => ({ predicate: spec.source, object })))
        add.push(...valueFacts(spec.property, option))
    }
    return { remove, add }
}
