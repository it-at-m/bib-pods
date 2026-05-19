import { parseTurtle, contractTerm, BP, RDF_TYPE, RDFS_LABEL } from "./utils.js"
import vocabularyTtl from "../definitions/vocabulary.ttl?raw"

export function getUserActionGraphs() {
    const store = parseTurtle(vocabularyTtl)
    const subjects = store.getSubjects(RDF_TYPE, BP + "UserAction", null).map(t => t.value)
    return subjects.map(iri => buildGraph(store, iri))
}

function buildGraph(store, rootIri) {
    const nodes = []
    const links = []
    let litCounter = 0
    const ownLabel = preferredLabel(store, rootIri)
    const classIri = store.getObjects(rootIri, RDF_TYPE, null)[0]?.value
    const classLabel = classIri ? preferredLabel(store, classIri) : null
    const heading = classLabel ? `${classLabel}: ${ownLabel}` : ownLabel

    nodes.push({ id: rootIri, label: ownLabel, type: "NamedNode" })

    for (const target of store.getObjects(rootIri, BP + "followUpQuestion", null)) {
        const label = preferredLabelTerm(store, target.value)
        if (!label) continue
        const litId = `lit:${++litCounter}`
        nodes.push({ id: litId, label: label.value, type: "Literal" })
        links.push({ source: rootIri, target: litId, label: "bp:followUpQuestion" })
    }

    return { iri: rootIri, label: heading, nodes, links }
}

function preferredLabelTerm(store, iri) {
    const labels = store.getObjects(iri, RDFS_LABEL, null)
    return labels.find(t => t.language === "de") ?? labels[0] ?? null
}

function preferredLabel(store, iri) {
    return preferredLabelTerm(store, iri)?.value ?? contractTerm(iri)
}
