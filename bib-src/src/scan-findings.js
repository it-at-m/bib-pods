import { getProfileSubject, quadKey, RDF_TYPE, RDFS_LABEL } from "cori-sdk/utils.js"
import { newStore } from "@foerderfunke/sem-ops-utils/core"
import { isProfileScanFinding, scanLabel } from "./scan-rules.js"
import { BP } from "./vocab.js"

// One selectable entry per profile fact, even if several sources/rules propose it.
// Only its own label accompanies a selection; unrelated findings stay in the preview.
export function collectScanCandidates(reports) {
    const candidates = new Map()
    for (const { result } of reports) {
        if (!result) continue
        for (const finding of result.findings) {
            if (!isProfileScanFinding(finding)) continue
            for (const quad of finding.quads) {
                if (quad.subject.value !== getProfileSubject() || quad.predicate.value === RDF_TYPE) continue
                const key = quadKey(quad)
                if (!candidates.has(key)) {
                    candidates.set(key, {
                        quad,
                        scanSource: result.scanSource,
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

// Kept apart from selectable profile facts: these values are used only by the
// explicit branch action, regardless of which source supplied the address.
export function collectBranchLookups(reports) {
    const vcard = "http://www.w3.org/2006/vcard/ns#"
    const lookups = new Map()
    for (const { result } of reports) {
        for (const finding of result?.findings ?? []) {
            if (finding.action !== BP + "FindNearestBranch") continue
            const store = newStore()
            store.addQuads(finding.quads)
            for (const node of store.getSubjects(RDF_TYPE, vcard + "Address", null)) {
                // One nonempty text value per field, preserving postcode leading zeros.
                const value = property => {
                    const terms = store.getObjects(node, vcard + property, null)
                    if (terms.length !== 1 || terms[0].datatype?.value !== "http://www.w3.org/2001/XMLSchema#string") return null
                    return terms[0].value.trim()
                }
                const address = {
                    street: value("street-address"),
                    postalCode: value("postal-code"),
                    city: value("locality"),
                    country: value("country-name"),
                }
                if (!Object.values(address).every(Boolean)) continue
                lookups.set(JSON.stringify(address), {
                    address,
                    scanSource: result.scanSource,
                    label: `${address.street}, ${address.postalCode} ${address.city}, ${address.country}`,
                    actionLabel: scanLabel(finding.action),
                })
            }
        }
    }
    return [...lookups.values()]
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
