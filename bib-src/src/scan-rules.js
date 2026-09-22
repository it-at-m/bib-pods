// Pure RDF → RDF mappings. Pod access and profile writes belong to the caller.
import { sparqlAsk, sparqlConstruct } from "@foerderfunke/sem-ops-utils/sparql"
import { newStore } from "@foerderfunke/sem-ops-utils/core"
import { parseTurtle, getLabel, RDF_TYPE, RDFS_LABEL } from "cori-sdk/utils.js"
import { BP } from "./vocab.js"
import scanRuleDocuments from "../definitions/scan-rules.ttl.js"

const definitions = newStore()
for (const ttl of scanRuleDocuments) definitions.addQuads(parseTurtle(ttl).getQuads())
const values = (subject, predicate) => definitions.getObjects(subject, predicate, null)

export function scanLabel(iri, quads = []) {
    const labels = [
        ...quads.filter(q => q.subject.value === iri && q.predicate.value === RDFS_LABEL).map(q => q.object),
        ...values(iri, RDFS_LABEL),
    ]
    return labels.find(t => t.language === "de")?.value ?? labels[0]?.value ?? getLabel(iri) ?? iri
}

export function getScanSources() {
    return definitions.getSubjects(RDF_TYPE, BP + "ScanSource", null).map(({ value: iri }) => {
        const ruleSet = values(iri, BP + "ruleSet")[0].value
        return {
            iri,
            label: scanLabel(iri),
            path: values(iri, BP + "podPath")[0].value,
            formatDescription: values(iri, BP + "formatDescription")[0].value,
            recognitionQuery: values(iri, BP + "recognitionQuery")[0].value,
            ruleSet: { iri: ruleSet, label: scanLabel(ruleSet) },
            rules: values(ruleSet, BP + "scanRule").map(({ value: rule }) => ({
                iri: rule,
                label: scanLabel(rule),
                action: values(rule, BP + "action")[0].value,
                query: values(rule, BP + "constructQuery")[0].value,
            })),
        }
    })
}

export async function matchesScanSource(source, sourceStore) {
    return sparqlAsk(source.recognitionQuery, [sourceStore])
}

// Preserve rule identity alongside the result so a preview can explain each finding.
// A fresh store deduplicates repeated matches without changing the input graph.
export async function applyScanRules(source, sourceStore) {
    const findings = []
    for (const rule of source.rules) {
        const result = newStore()
        await sparqlConstruct(rule.query, [sourceStore], result)
        findings.push({ rule: rule.iri, label: rule.label, action: rule.action, quads: result.getQuads() })
    }
    return findings
}
