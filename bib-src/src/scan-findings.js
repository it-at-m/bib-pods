import { getProfileSubject, quadKey, RDF_TYPE, RDFS_LABEL } from "cori-sdk/utils.js"
import { scanLabel } from "./scan-rules.js"

// One selectable entry per profile fact, even if several sources/rules propose it.
// Only its own label accompanies a selection; unrelated findings stay in the preview.
export function collectScanCandidates(reports) {
    const candidates = new Map()
    for (const { result } of reports) {
        if (!result) continue
        for (const finding of result.findings) {
            for (const quad of finding.quads) {
                if (quad.subject.value !== getProfileSubject() || quad.predicate.value === RDF_TYPE) continue
                const key = quadKey(quad)
                if (!candidates.has(key)) {
                    candidates.set(key, {
                        quad,
                        label: quad.object.termType === "Literal" ? quad.object.value : scanLabel(quad.object.value, finding.quads),
                        propertyLabel: scanLabel(quad.predicate.value),
                        quads: [quad, ...finding.quads.filter(q =>
                            q.subject.equals(quad.object) && q.predicate.value === RDFS_LABEL)],
                        reasons: [],
                    })
                }
                candidates.get(key).reasons.push({
                    source: result.sourceLabel,
                    rule: finding.label,
                    action: finding.action,
                    evidence: (finding.evidence ?? [])
                        .filter(e => e.property?.equals(quad.predicate) && e.value?.equals(quad.object)),
                })
            }
        }
    }
    return [...candidates.values()]
}

// Two sides of the applied mapping, rendered consistently for every source.
// The field occurs only on the input side; the output is the proposed profile fact.
export function scanReasonSteps(candidate, reason) {
    return reason.evidence.map(e => ({
        field: e.fieldLabel ?? e.field?.value ?? "Angabe",
        answer: e.sourceValue?.value ?? null,
        property: candidate.propertyLabel,
        value: candidate.label,
    }))
}
