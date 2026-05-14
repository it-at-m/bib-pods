import { newStore, addTriple, storeToTurtle } from "@foerderfunke/sem-ops-utils"

const STORAGE_KEY = "bib-pods.storage"
const root = document.getElementById("bib-pods-root")
let turtleOutput = ""
let solrOutput = ""

async function querySolr() {
    solrOutput = "Lade..."
    render()
    try {
        const res = await fetch(`${__SOLR_ENDPOINT__}?q=*:*&rows=0&wt=json`)
        const json = await res.json()
        solrOutput = `Solr: ${json.response.numFound} Dokumente im Index`
    } catch (err) {
        solrOutput = `Solr error: ${err.message}`
    }
    render()
}

async function demoTriple() {
    const store = newStore()
    addTriple(
        store,
        "http://example.org/alice",
        "http://xmlns.com/foaf/0.1/knows",
        "http://example.org/bob",
    )
    turtleOutput = await storeToTurtle(store, {
        ex: "http://example.org/",
        foaf: "http://xmlns.com/foaf/0.1/",
    })
    render()
}

const views = {
    chooser: () => `
        <p>Wo sollen deine Daten gespeichert werden?</p>
        <button data-choice="local">Lokal im Browser</button>
        <button data-choice="solid">In meinem Solid Pod</button>
    `,
    local: () => `
        <p>Speicherung: lokal in deinem Browser</p>
        <button data-action="switch">Speicherort wechseln</button>
    `,
    solid: () => `
        <p>Speicherung: in deinem Solid Pod</p>
        <button data-action="switch">Speicherort wechseln</button>
    `,
}

const escapeHtml = (s) => s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")

function render() {
    const choice = localStorage.getItem(STORAGE_KEY)
    const view = choice === "local" || choice === "solid" ? choice : "chooser"
    const turtleBlock = turtleOutput
        ? `<hr><p>Example turtle:</p><pre>${escapeHtml(turtleOutput)}</pre>`
        : ""
    const solrBlock = `
        <hr>
        <button data-action="solr">Query Solr</button>
        ${solrOutput ? `<p>${escapeHtml(solrOutput)}</p>` : ""}
    `
    root.innerHTML = `${views[view]()}${solrBlock}${turtleBlock}`
}

root.addEventListener("click", (event) => {
    const { choice, action } = event.target.dataset
    if (choice === "local" || choice === "solid") {
        localStorage.setItem(STORAGE_KEY, choice)
        render()
    } else if (action === "switch") {
        localStorage.removeItem(STORAGE_KEY)
        render()
    } else if (action === "solr") {
        querySolr()
    }
})

demoTriple()
render()
