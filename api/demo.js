const ENDPOINT = "http://localhost:8985/recommendations"

const profile = `
@prefix bp: <https://www.muenchner-stadtbibliothek.de/bib-pods#>.
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#>.
@prefix gnd: <https://d-nb.info/gnd/>.
@prefix cori: <https://cori.systems/core#>.

cori:defaultProfile bp:favoriteAuthor gnd:1137965894 .
gnd:1137965894 rdfs:label "Kübra Gümüşay".`

const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "text/turtle" },
    body: profile,
})

const { results } = await res.json()
// console.log("results", results)
for (const { strategy, docs } of results) {
    console.log("Strategie:", strategy.label)
    for (const doc of docs) console.log(`  - ${doc.title?.[0] ?? doc.id}`)
}
