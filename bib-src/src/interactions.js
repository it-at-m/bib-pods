import { contractTerm, getLabel, CORI, RDF_TYPE, RDFS, getVocab } from "cori-sdk/utils.js"
import { BP, getFollowUpsFor } from "./vocab.js"

// Every cori:UserAction in the vocabulary with the profile fields its dialog offers, in
// dialog order: first the title itself (bp:addsTitleTo, pre-ticked), then the
// follow-up questions.
//   [{ iri, label, trigger, fields: [{ property, label, preselected }] }]
export async function getUserActions(store = getVocab()) {
    const actions = store.getSubjects(RDF_TYPE, CORI + "UserAction", null).map(t => t.value)
    return Promise.all(actions.map(async iri => {
        const titleProperties = store.getObjects(iri, BP + "addsTitleTo", null).map(t => t.value)
        const followUps = (await getFollowUpsFor(iri)).map(({ property }) => property)
        const field = (property, preselected) => ({ property, label: getLabel(property) ?? contractTerm(property), preselected })
        return {
            iri,
            label: germanText(store, iri, RDFS + "label") ?? contractTerm(iri),
            trigger: germanText(store, iri, RDFS + "comment"),
            fields: [...titleProperties.map(p => field(p, true)), ...followUps.map(p => field(p, false))],
        }
    }))
}

function germanText(store, iri, predicate) {
    const values = store.getObjects(iri, predicate, null)
    return values.find(t => t.language === "de")?.value ?? values[0]?.value ?? null
}
