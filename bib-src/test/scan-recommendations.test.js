import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { parseTurtle, getProfileSubject, RDFS_LABEL } from "cori-sdk/utils.js"
import { validateProfile } from "cori-sdk/shacl.js"
import { getScanSources, applyScanRules, scanLabel } from "../src/scan-rules.js"
import { BP, GND } from "../src/vocab.js"
import { buildQuery, getStrategies, readStrategyChoices, resolveStrategyEnabled, explainDocMatches, SETTINGS_SUBJECT, DISABLED_STRATEGY } from "../src/recommendations.js"

const subject = getProfileSubject()
const source = getScanSources().find(s => s.iri === BP + "wuppertalHealthQuestionnaire")
const strategy = getStrategies().find(s => s.iri === BP + "topicMatch")
const profile = async () => {
    const input = parseTurtle(await readFile(new URL("./fixtures/wuppertal-health-export.ttl", import.meta.url), "utf8"))
    const store = parseTurtle(`<${subject}> a <https://cori.systems/core#Profile> .`)
    for (const finding of await applyScanRules(source, input)) store.addQuads(finding.quads)
    return store
}

test("scanner proposals use only the existing topics category and its default strategy", async () => {
    const store = await profile()
    const topics = store.getObjects(subject, BP + "interestedIn", null).map(t => t.value).sort()
    assert.deepEqual(topics, ["4006311-2", "4340678-6", "4041030-4"].map(id => GND + id).sort())
    assert.equal(store.getQuads(subject, null, null, null).length, 4) // type + three interests
    assert.equal(resolveStrategyEnabled(strategy, readStrategyChoices(store)), true)
    const query = buildQuery(strategy, store, subject)
    assert.deepEqual(query, {
        q: `(${["4006311-2", "4340678-6", "4041030-4"].map(id => `topic_uri_str_mv:"${GND + id}"`).join(" OR ")})`,
        fq: [],
    })
    assert.equal((await validateProfile(store)).conforms, true)
})

test("topic labels support the existing profile display and recommendation explanations", async () => {
    const store = await profile()
    const topics = store.getObjects(subject, BP + "interestedIn", null)
    for (const topic of topics) {
        assert.equal(store.getObjects(topic, RDFS_LABEL, null).length, 1)
        assert.notEqual(scanLabel(topic.value, store.getQuads()), topic.value)
    }
    assert.equal(scanLabel(GND + "4006311-2", store.getQuads()), "Bewegung")
    const explanation = explainDocMatches({ topic_uri_str_mv: [GND + "4340678-6"] }, store, subject, strategy.properties)
    assert.match(explanation, /Gesunde Ernährung/)
    assert.doesNotMatch(explanation, /gnd:|https:/)
    const neighbourhood = explainDocMatches({ topic_uri_str_mv: [GND + "4041030-4"] }, store, subject, strategy.properties)
    assert.match(neighbourhood, /Nachbarschaft/)
    assert.doesNotMatch(neighbourhood, /Bewegung|Gesunde Ernährung/)
})

test("scan proposals leave strategy settings and other profile categories alone", async () => {
    const store = await profile()
    assert.equal(store.getQuads(SETTINGS_SUBJECT, null, null, null).length, 0)
    for (const property of ["favoriteGenre", "hobby", "interestedInPlace", "preferredLanguage", "preferredMedium"]) {
        assert.equal(store.getObjects(subject, BP + property, null).length, 0)
    }
    store.addQuads(parseTurtle(`<${SETTINGS_SUBJECT}> <${DISABLED_STRATEGY}> <${strategy.iri}> .`).getQuads())
    assert.equal(resolveStrategyEnabled(strategy, readStrategyChoices(store)), false)
})

test("separate place information does not masquerade as a location filter in the existing topic strategy", async () => {
    const store = await profile()
    const before = buildQuery(strategy, store, subject)
    store.addQuads(parseTurtle(`<${subject}> <${BP}interestedInPlace> <${GND}4127793-4> .`).getQuads())
    assert.deepEqual(buildQuery(strategy, store, subject), before)
})
