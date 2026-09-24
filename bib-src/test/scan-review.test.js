import test from "node:test"
import assert from "node:assert/strict"
import { parseTurtle, getProfileSubject, RDFS_LABEL, CORI } from "cori-sdk/utils.js"
import { collectScanCandidates, scanReasonSteps } from "../src/scan-findings.js"
import { BP, GND } from "../src/vocab.js"

const subject = getProfileSubject()
const walking = GND + "4064532-0"
const relaxation = GND + "4014917-1"
const proposals = parseTurtle(`
    <${subject}> <${BP}interestedIn> <${walking}>, <${relaxation}> .
    <${walking}> <${RDFS_LABEL}> "Wandern" .
    <${relaxation}> <${RDFS_LABEL}> "Entspannung" .
`)
const report = (quads = proposals.getQuads()) => ({ result: {
    source: "https://pod.example/survey.ttl", sourceLabel: "Beispieldaten",
    findings: [{ label: "Themen ableiten", action: BP + "Derive", quads }],
} })

test("review deduplicates facts across sources and offers the same findings on every scan", () => {
    const reports = [report(), report(), { result: null }, { error: new Error("offline") }]
    const candidates = collectScanCandidates(reports)
    assert.equal(candidates.length, 2)
    assert.equal(candidates[0].reasons.length, 2)
    assert.deepEqual(collectScanCandidates(reports), candidates)
    assert.deepEqual(candidates[1].quads.map(q => q.subject.value), [subject, relaxation])
})

test("review keeps literal values and their RDF types, and does not offer the profile type", () => {
    const quads = parseTurtle(`
        <${subject}> a <${CORI}Profile> ; <${BP}interestedIn> "Wandern"@de, "Wandern" .
    `).getQuads()
    const candidates = collectScanCandidates([report(quads)])
    assert.equal(candidates.length, 2)
    assert.ok(candidates.every(c => c.label === "Wandern" && c.quads.length === 1))
    assert.notEqual(candidates[0].quad.object.language, candidates[1].quad.object.language)
})

test("each selectable fact keeps only its own structured evidence", () => {
    const scan = report()
    const [walkingTerm, relaxationTerm] = proposals.getObjects(subject, BP + "interestedIn", null)
    const property = proposals.getQuads(subject, BP + "interestedIn", null, null)[0].predicate
    const answer = parseTurtle('<urn:a> <urn:p> "Spaziergänge"@de .').getQuads()[0].object
    scan.result.findings[0].evidence = [
        { property, value: walkingTerm, fieldLabel: "Freizeit", sourceValue: answer },
        { property, value: relaxationTerm, fieldLabel: "Erholung" },
        { property: walkingTerm, value: walkingTerm, fieldLabel: "Unrelated property" },
    ]
    const candidates = collectScanCandidates([scan])
    assert.equal(candidates[0].reasons[0].evidence.length, 1)
    assert.equal(candidates[1].reasons[0].evidence.length, 1)
    assert.deepEqual(scanReasonSteps(candidates[0], candidates[0].reasons[0]),
        [{ field: "Freizeit", answer: "Spaziergänge", property: "Thema", value: "Wandern" }])
    assert.deepEqual(scanReasonSteps(candidates[1], candidates[1].reasons[0]),
        [{ field: "Erholung", answer: null, property: "Thema", value: "Entspannung" }])
    assert.ok(candidates.every(c => c.quads.length === 2))
})
