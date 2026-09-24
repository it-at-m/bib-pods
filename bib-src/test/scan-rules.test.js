import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { parseTurtle, getProfileSubject, RDFS_LABEL } from "cori-sdk/utils.js"
import { applyScanRules, getScanSources, matchesScanSource } from "../src/scan-rules.js"

const BP = "https://www.muenchner-stadtbibliothek.de/bib-pods#"
const HEALTHY_EATING = "https://d-nb.info/gnd/4340678-6"
const MOVEMENT = "https://d-nb.info/gnd/4006311-2"
const SLEEP = "https://d-nb.info/gnd/4052580-6"
const NEIGHBOURHOOD = "https://d-nb.info/gnd/4041030-4"
const MOVEMENT_NUTRITION_TOPICS = [HEALTHY_EATING, MOVEMENT].sort()
const prefixes = `
@prefix h: <https://raw.githubusercontent.com/hoelk-f/solid-health-questionnaire/main/public/vocab.ttl#> .
@prefix s: <https://schema.org/> .
@prefix x: <https://different-pod.example/survey/> .
`
const source = getScanSources().find(s => s.iri === BP + "wuppertalHealthQuestionnaire")
const run = async body => {
    const store = parseTurtle(prefixes + body)
    const before = store.getQuads().map(q => JSON.stringify(q)).sort()
    const recognized = await matchesScanSource(source, store)
    const findings = await applyScanRules(source, store)
    assert.deepEqual(store.getQuads().map(q => JSON.stringify(q)).sort(), before, "mapping must not mutate its input")
    const facts = findings.flatMap(f => f.quads)
    const topics = facts.filter(q => q.subject.value === getProfileSubject())
    assert.ok(topics.every(q => q.predicate.value === BP + "interestedIn"))
    assert.ok(facts.filter(q => q.subject.value !== getProfileSubject()).every(q =>
        q.predicate.value === RDFS_LABEL && topics.some(t => t.object.equals(q.subject))))
    return {
        recognized,
        findings,
        themes: topics.map(q => q.object.value).sort(),
    }
}

test("the anonymised real export is recognized with its original literal types and answer links", async () => {
    const ttl = await readFile(new URL("./fixtures/wuppertal-health-export.ttl", import.meta.url), "utf8")
    const result = await run(ttl)
    assert.equal(result.recognized, true)
    assert.deepEqual(result.themes, [...MOVEMENT_NUTRITION_TOPICS, NEIGHBOURHOOD].sort())
    const evidence = result.findings.flatMap(f => f.evidence)
    assert.deepEqual(evidence.map(e => [e.field.value, e.sourceValue.value]).sort(), [
        ["movement-active-days", "An einem Tag"],
        ["nutrition-fruit-vegetables", "Ja"],
        ["social-neighbour-help", "Einfach"],
    ])
    const hq = "https://raw.githubusercontent.com/hoelk-f/solid-health-questionnaire/main/public/vocab.ttl#"
    const input = parseTurtle(ttl)
    const day = input.getQuads(null, hq + "optionId", null, null).find(q => q.object.value === "1").object
    assert.equal(day.datatype.value, "http://www.w3.org/2001/XMLSchema#string")
    assert.ok(input.getQuads(null, hq + "optionId", null, null).some(q => q.object.value === "no"))
    assert.ok(!result.themes.includes(SLEEP), "the original export answers no to sleep difficulties")
})

test("neighbourhood follows easy access to neighbours' help, not other answers or social scores", async () => {
    for (const option of ["easy", "difficult", "unknown", null]) {
        const result = await run(`
            x:result a h:HealthQuestionnaireAssessment ; h:hasAnswer x:help, x:close ; h:hasCategoryScore x:social .
            x:help h:questionId "social-neighbour-help" ${option === null ? "" : `; h:optionId "${option}"`} ; s:text "Einfach"@de .
            x:close h:questionId "social-close-people" ; h:optionId "over-6" .
            x:social h:categoryId "social" ; h:trafficLight "green" .
            x:orphan h:questionId "social-neighbour-help" ; h:optionId "easy" .
        `)
        assert.equal(result.recognized, true)
        assert.deepEqual(result.themes, option === "easy" ? [NEIGHBOURHOOD] : [])
        const evidence = result.findings.flatMap(f => f.evidence)
        assert.equal(evidence.length, option === "easy" ? 1 : 0)
        if (option === "easy") {
            assert.equal(evidence[0].fieldLabel, "Praktische Hilfe von Nachbarn erhalten")
            assert.equal(evidence[0].sourceValue.value, "Einfach")
            assert.equal(evidence[0].sourceNode.value, "https://different-pod.example/survey/help")
        }
    }
})

test("explicit answers supply suggestions despite changed scores, labels and node names", async () => {
    const result = await run(`
        x:changed a h:HealthQuestionnaireAssessment ; h:hasAnswer x:active, x:food .
        x:active h:questionId "movement-active-days" ; h:optionId "1" ;
            s:position 400 ; s:text "Different wording"@en ; h:achievedScore 999 .
        x:food h:questionId "nutrition-fruit-vegetables" ; h:optionId "yes" .
    `)
    assert.equal(result.recognized, true)
    assert.deepEqual(result.themes, MOVEMENT_NUTRITION_TOPICS)
})

test("movement follows reported active days and its evidence names that answer", async () => {
    for (const option of ["1", "2", "3", "4", "5", "6", "7"]) {
        const result = await run(`
            x:result a h:HealthQuestionnaireAssessment ; h:hasAnswer x:active .
            x:active h:questionId "movement-active-days" ; h:optionId "${option}" .
        `)
        assert.deepEqual(result.themes, [MOVEMENT])
        const evidence = result.findings.flatMap(f => f.evidence)
        assert.equal(evidence.length, 1)
        assert.equal(evidence[0].field.value, "movement-active-days")
        assert.equal(evidence[0].sourceValue.value, option)
        assert.equal(evidence[0].sourceNode.value, "https://different-pod.example/survey/active")
    }
})

test("low sport frequency alone, zero, invalid or missing active days do not suggest movement", async () => {
    for (const option of [null, "0", "-1", "8", "some-new-option"]) {
        const result = await run(`
            x:result a h:HealthQuestionnaireAssessment ; h:hasAnswer x:sport, x:active .
            x:sport h:questionId "movement-sport-frequency" ; h:optionId "under-1h" .
            x:active h:questionId "movement-active-days" ${option === null ? "" : `; h:optionId "${option}"`} .
        `)
        assert.equal(result.recognized, true)
        assert.deepEqual(result.themes, [])
        assert.deepEqual(result.findings.flatMap(f => f.evidence), [])
    }
})

test("different, unknown and missing answers do not acquire the same interests", async () => {
    for (const option of ["no", "some-new-option"]) {
        const result = await run(`
            x:result a h:HealthQuestionnaireAssessment ; h:hasAnswer x:food, x:sleep .
            x:food h:questionId "nutrition-fruit-vegetables" ; h:optionId "${option}" .
            x:sleep h:questionId "sleep-difficulties" ; h:optionId "${option}" .
        `)
        assert.equal(result.recognized, true)
        assert.deepEqual(result.themes, [])
    }
})

test("unlinked answers and category scores do not establish reading interests", async () => {
    const result = await run(`
        x:result a h:HealthQuestionnaireAssessment ; h:hasCategoryScore x:category .
        x:category h:categoryId "sleep" ; h:trafficLight "red" .
        x:orphan h:questionId "movement-active-days" ; h:optionId "1" .
    `)
    assert.equal(result.recognized, true)
    assert.deepEqual(result.themes, [])
})

test("empty data, unrelated graphs and an assessment without results yield nothing", async () => {
    for (const body of ["", "x:a s:text \"nutrition\" .", "x:a a h:HealthQuestionnaireAssessment ."]) {
        const result = await run(body)
        assert.equal(result.recognized, false)
        assert.deepEqual(result.themes, [])
    }
})

test("an unanswered question cannot activate a domain or a direct observation", async () => {
    const result = await run(`
        x:result a h:HealthQuestionnaireAssessment ; h:hasAnswer x:unanswered .
        x:unanswered h:questionId "movement-active-days" .
    `)
    assert.equal(result.recognized, false)
    assert.deepEqual(result.themes, [])
})

test("findings keep their rule identities, including rules that found no matches", async () => {
    const result = await run(`
        x:result a h:HealthQuestionnaireAssessment ; h:hasCategoryScore x:n .
        x:n h:categoryId "social" .
    `)
    assert.equal(result.recognized, true)
    assert.equal(source.ruleSet.iri, BP + "wuppertalHealthRules")
    assert.equal(result.findings.length, 1)
    assert.deepEqual(result.findings.map(f => f.rule), source.rules.map(r => r.iri))
    assert.deepEqual(result.findings.map(f => f.action), [BP + "Derive"])
    assert.deepEqual(result.findings.map(f => f.quads.length), [0])
})

test("a similar health survey using another vocabulary is not recognized as Wuppertal data", async () => {
    const result = await run(`
        x:result a x:HealthQuestionnaireAssessment ;
            s:name "Wuppertaler Gesundheitsfragebogen" ;
            x:hasAnswer x:a ; x:hasCategoryScore x:n .
        x:a x:questionId "movement-active-days" ; x:optionId "1" .
        x:n x:categoryId "nutrition" .
    `)
    assert.equal(result.recognized, false)
    assert.deepEqual(result.themes, [])
})

test("Wuppertal answer predicates alone do not identify a Wuppertal assessment", async () => {
    const result = await run(`
        x:result a s:Questionnaire ; h:hasAnswer x:a .
        x:a h:questionId "movement-active-days" ; h:optionId "1" .
    `)
    assert.equal(result.recognized, false)
    assert.deepEqual(result.themes, [])
})

test("evidence records the matched field and answer, and never becomes a profile fact", async () => {
    for (const option of ["yes", "no"]) {
        const result = await run(`
            x:result a h:HealthQuestionnaireAssessment ; h:hasAnswer x:sleep .
            x:sleep h:questionId "sleep-difficulties" ; h:optionId "${option}" .
        `)
        assert.deepEqual(result.themes, option === "yes" ? [SLEEP] : [])
        const evidence = result.findings.flatMap(f => f.evidence)
        assert.equal(evidence.length, option === "yes" ? 1 : 0)
        if (option === "yes") {
            assert.equal(evidence[0].field.value, "sleep-difficulties")
            assert.equal(evidence[0].fieldLabel, "Schlafschwierigkeiten")
            assert.equal(evidence[0].sourceValue.value, "yes")
            assert.equal(evidence[0].sourceNode.value, "https://different-pod.example/survey/sleep")
            assert.equal(evidence[0].property.value, BP + "interestedIn")
            assert.equal(evidence[0].value.value, SLEEP)
        }
        assert.equal(result.findings.flatMap(f => f.quads).length, option === "yes" ? 2 : 0)
    }
})

test("evidence uses the source's answer text, preferring German to untagged and English labels", async () => {
    const result = await run(`
        x:result a h:HealthQuestionnaireAssessment ; h:hasAnswer x:active .
        x:active h:questionId "movement-active-days" ; h:optionId "1" ;
            s:text "One day"@en, "1 day", "An einem Tag"@de .
    `)
    const evidence = result.findings.flatMap(f => f.evidence)
    assert.equal(evidence.length, 1)
    assert.equal(evidence[0].sourceValue.value, "An einem Tag")
    assert.equal(evidence[0].sourceValue.language, "de")
    assert.equal(result.findings.flatMap(f => f.quads).length, 2)
})
