// Concepts defined by a query (age groups, "Hörbuch").
import test from "node:test"
import assert from "node:assert/strict"
import { parseTurtle, getProfileSubject, registerVocab } from "cori-sdk/utils.js"
import { BP } from "../src/vocab.js"
import { buildQuery, getStrategies } from "../src/recommendations.js"
import { indexOffering } from "./index-fields.js"

registerVocab(`
    @prefix bp: <${BP}> .
    @prefix skos: <http://www.w3.org/2004/02/skos/core#> .
    bp:test-audience-6-9 a skos:Concept ; bp:indexQuery "audience_age:[6 TO 9]" .
    bp:test-audience-adults a skos:Concept ; bp:indexQuery "(*:* -audience_age:[0 TO 15])" .
    bp:test-medium-audiobook a skos:Concept ; bp:indexQuery "content_uri_str_mv:\\"https://id.loc.gov/vocabulary/contentTypes/spw\\"" .
`)

const subject = getProfileSubject()
const topics = getStrategies().find(s => s.iri === BP + "topicMatch")

test("a concept defined by a query filters with that query, OR-ed with its neighbours", () => {
    indexOffering()
    const one = parseTurtle(`<${subject}> <${BP}interestedIn> "Dorf" ; <${BP}preferredAudience> <${BP}test-audience-6-9> .`)
    assert.deepEqual(buildQuery(topics, one, subject).fq, ["audience_age:[6 TO 9]"])
    const two = parseTurtle(`<${subject}> <${BP}interestedIn> "Dorf" ;
        <${BP}preferredAudience> <${BP}test-audience-6-9>, <${BP}test-audience-adults> .`)
    const [fq] = buildQuery(topics, two, subject).fq
    assert.ok(fq === "(audience_age:[6 TO 9] OR (*:* -audience_age:[0 TO 15]))"
        || fq === "((*:* -audience_age:[0 TO 15]) OR audience_age:[6 TO 9])")
})

test("a query-defined concept takes the place of the field's own index mapping", () => {
    indexOffering()
    const store = parseTurtle(`<${subject}> <${BP}interestedIn> "Dorf" ;
        <${BP}preferredMedium> <${BP}test-medium-audiobook>, <${BP}medium-E-Book> .`)
    const [fq] = buildQuery(topics, store, subject).fq
    assert.ok(fq.includes('content_uri_str_mv:"https://id.loc.gov/vocabulary/contentTypes/spw"'))
    assert.ok(fq.includes('format:"E-Book"'))
    assert.ok(!fq.includes("format:\"https://"), "the concept's IRI is not looked for in the medium field")
})
