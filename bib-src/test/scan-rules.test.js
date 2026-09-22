import test from "node:test"
import assert from "node:assert/strict"
import { parseTurtle, getProfileSubject, RDFS_LABEL } from "cori-sdk/utils.js"
import { applyScanRules, getScanSources, matchesScanSource } from "../src/scan-rules.js"

const BP = "https://www.muenchner-stadtbibliothek.de/bib-pods#"
const SELFCARE = "https://d-nb.info/gnd/4782241-7"
const VEGETARIAN_FOOD = "https://d-nb.info/gnd/4062436-5"
const WALKING = "https://d-nb.info/gnd/4064532-0"
const RELAXATION = "https://d-nb.info/gnd/4014917-1"
const MOVEMENT_NUTRITION_TOPICS = [SELFCARE, VEGETARIAN_FOOD, WALKING].sort()
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

test("category presence supplies themes despite changed answers, scores, labels and node names", async () => {
    for (const option of ["under-1h", "some-new-option"]) {
        const result = await run(`
            x:changed a h:HealthQuestionnaireAssessment ;
                h:hasCategoryScore x:food, x:activity ; h:hasAnswer x:reply .
            x:food h:categoryId "nutrition" ; h:percentage 0 ; h:trafficLight "red" .
            x:activity h:categoryId "movement" ; h:percentage 100 ; h:trafficLight "green" .
            x:reply h:questionId "movement-sport-frequency" ; h:optionId "${option}" ;
                s:position 400 ; s:text "Different wording"@en .
        `)
        assert.equal(result.recognized, true)
        assert.deepEqual(result.themes, MOVEMENT_NUTRITION_TOPICS)
    }
})

test("linked answers supply domains when category summaries are absent, without duplicate findings", async () => {
    const result = await run(`
        x:result a h:HealthQuestionnaireAssessment ; h:hasAnswer x:a, x:b, x:c .
        x:a h:questionId "movement-active-days" ; h:optionId "1" .
        x:b h:questionId "movement-active-duration" ; h:optionId "10-30" .
        x:c h:questionId "nutrition-fruit-vegetables" ; h:optionId "no" .
    `)
    assert.equal(result.recognized, true)
    assert.deepEqual(result.themes, MOVEMENT_NUTRITION_TOPICS)
})

test("unlinked answers and categories do not create observations or inferred themes", async () => {
    const result = await run(`
        x:result a h:HealthQuestionnaireAssessment ; h:hasAnswer x:mental .
        x:mental h:questionId "mental-general" ; h:optionId "fair" .
        x:orphan h:questionId "movement-sport-frequency" ; h:optionId "under-1h" .
        x:orphanCategory h:categoryId "nutrition" .
    `)
    assert.deepEqual(result.themes, [RELAXATION, SELFCARE])
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
        x:unanswered h:questionId "movement-sport-frequency" .
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
    assert.equal(result.findings.length, 2)
    assert.deepEqual(result.findings.map(f => f.rule), source.rules.map(r => r.iri))
    assert.deepEqual(result.findings.map(f => f.action), [BP + "Derive", BP + "Derive"])
    assert.deepEqual(result.findings.map(f => f.quads.length), [2, 0])
})

test("a similar health survey using another vocabulary is not recognized as Wuppertal data", async () => {
    const result = await run(`
        x:result a x:HealthQuestionnaireAssessment ;
            s:name "Wuppertaler Gesundheitsfragebogen" ;
            x:hasAnswer x:a ; x:hasCategoryScore x:n .
        x:a x:questionId "movement-sport-frequency" ; x:optionId "under-1h" .
        x:n x:categoryId "nutrition" .
    `)
    assert.equal(result.recognized, false)
    assert.deepEqual(result.themes, [])
})

test("Wuppertal answer predicates alone do not identify a Wuppertal assessment", async () => {
    const result = await run(`
        x:result a s:Questionnaire ; h:hasAnswer x:a .
        x:a h:questionId "movement-sport-frequency" ; h:optionId "under-1h" .
    `)
    assert.equal(result.recognized, false)
    assert.deepEqual(result.themes, [])
})
