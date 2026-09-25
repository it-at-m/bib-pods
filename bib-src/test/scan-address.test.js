import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { parseTurtle, getProfileSubject, RDF_TYPE } from "cori-sdk/utils.js"
import { getScanSources, matchesScanSource, applyScanRules, isProfileScanFinding } from "../src/scan-rules.js"
import { collectScanCandidates, collectBranchLookups } from "../src/scan-findings.js"
import { BP } from "../src/vocab.js"

const VCARD = "http://www.w3.org/2006/vcard/ns#"
const subject = getProfileSubject()
const source = getScanSources().find(s => s.iri === BP + "kielPrototypeContact")
const fixture = await readFile(new URL("./fixtures/kiel-prototype-contact.ttl", import.meta.url), "utf8")
const input = (ttl = fixture, root = "https://pod.example/hannah/") =>
    parseTurtle(`@base <${new URL(source.path, root).href}> .\n${ttl}`)
const reports = async store => [{ result: {
    sourceLabel: source.label, findings: await applyScanRules(source, store),
} }]
const lookups = async store => collectBranchLookups(await reports(store))

test("kiel-prototype recognizes the linked vCard address at a Pod-relative path", async () => {
    assert.equal(source.path, "personal/contact.ttl")
    assert.equal(source.ruleSet.label, "kiel-prototype")
    const store = input()
    assert.equal(await matchesScanSource(source, store), true)
    const survey = getScanSources().find(s => s.iri === BP + "wuppertalHealthQuestionnaire")
    assert.equal(await matchesScanSource(survey, store), false)
    assert.equal(await matchesScanSource(source, parseTurtle('<urn:x> <urn:p> "hello" .')), false)
})

test("address supplies a branch action with four components and no profile additions", async () => {
    const report = await reports(input())
    const [lookup, ...rest] = collectBranchLookups(report)
    assert.equal(rest.length, 0)
    assert.equal(lookup.label, "Fleethörn 9, 24103 Kiel, Deutschland")
    assert.equal(lookup.actionLabel, "Nächstgelegene Bibliothek finden")
    assert.deepEqual(lookup.address, {
        street: "Fleethörn 9", postalCode: "24103", city: "Kiel", country: "Deutschland",
    })
    assert.deepEqual(collectScanCandidates(report), [])
    const [finding] = report[0].result.findings
    assert.equal(isProfileScanFinding(finding), false)
    assert.ok(finding.quads.every(q => q.subject.value === "https://pod.example/hannah/personal/contact.ttl#addr-current"))
    assert.deepEqual(new Set(finding.quads.map(q => q.predicate.value)), new Set([
        RDF_TYPE,
        ...["street-address", "postal-code", "locality", "country-name"].map(p => VCARD + p),
    ]))
    assert.equal(finding.quads.length, 5) // No name, credential or provenance.
    // Even action data using the profile's subject must never enter its save path.
    finding.quads.push(...parseTurtle(`<${subject}> <${VCARD}locality> "Kiel" .`).getQuads())
    assert.deepEqual(collectScanCandidates(report), [])
})

test("unlinked and work addresses are ignored; no name, city or node ID is hardcoded", async () => {
    assert.equal((await lookups(input(fixture.replace('vcard:hasAddress <#addr-current>', 'vcard:hasAddress <#elsewhere>')))).length, 0)
    assert.equal((await lookups(input(fixture.replace('vcard:Home', 'vcard:Work')))).length, 0)
    const changed = fixture.replaceAll('#addr-current', '#home').replace('#me', '#person')
        .replace('Erika Mustermann', 'Hannah').replace('Fleethörn 9', 'Beispielstraße 7')
        .replace('24103', '01234').replace('"Kiel"', '"München"')
    const [lookup] = await lookups(input(changed, "https://different.example/"))
    assert.equal(lookup.label, "Beispielstraße 7, 01234 München, Deutschland")
    assert.equal(lookup.address.postalCode, "01234")
})

test("incomplete and contradictory addresses do not enable a branch action", async () => {
    for (const ttl of [
        fixture.replace('vcard:postal-code "24103" ;', ''),
        fixture.replace('vcard:postal-code "24103"', 'vcard:postal-code 24103'),
        fixture.replace('vcard:street-address "Fleethörn 9"', 'vcard:street-address ""'),
        fixture.replace('vcard:street-address "Fleethörn 9"', 'vcard:street-address "   "'),
        fixture.replace('vcard:street-address "Fleethörn 9"', 'vcard:street-address <urn:street>'),
        fixture.replace('vcard:locality "Kiel"', 'vcard:locality "Kiel", "München"'),
    ]) assert.equal((await lookups(input(ttl))).length, 0)
})

test("distinct addresses get separate actions; duplicate reports do not duplicate buttons", async () => {
    const report = await reports(input())
    assert.equal(collectBranchLookups([...report, ...report, { result: null }, { error: new Error("offline") }]).length, 1)
    const both = fixture + '\n<#me> vcard:hasAddress <#second> .\n' +
        fixture.slice(fixture.indexOf('<#addr-current> a')).replaceAll('#addr-current', '#second').replace('Fleethörn 9', 'Fleethörn 10')
    const choices = await lookups(input(both))
    assert.deepEqual(choices.map(c => c.address.street).sort(), ["Fleethörn 10", "Fleethörn 9"])
})

test("accepting all profile suggestions from a mixed scan excludes every address field", async () => {
    const report = await reports(input())
    const survey = getScanSources().find(s => s.iri === BP + "wuppertalHealthQuestionnaire")
    const ttl = await readFile(new URL("./fixtures/wuppertal-health-export.ttl", import.meta.url), "utf8")
    report.push({ result: { sourceLabel: survey.label, findings: await applyScanRules(survey, parseTurtle(ttl)) } })
    const candidates = collectScanCandidates(report)
    assert.equal(candidates.length, 3)
    assert.ok(candidates.every(c => c.quad.predicate.value === BP + "interestedIn"))
    assert.ok(candidates.flatMap(c => c.quads).every(q =>
        !q.predicate.value.startsWith(VCARD) && !q.object.value.includes("Fleethörn")))
    assert.equal(collectBranchLookups(report).length, 1)
})
