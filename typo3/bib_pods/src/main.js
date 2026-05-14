import { newStore, addTriple, storeToTurtle } from "@foerderfunke/sem-ops-utils"

const STORAGE_KEY = "bib-pods.storage"

const chooser = document.getElementById("bp-chooser")
const statusBox = document.getElementById("bp-status")
const statusText = document.getElementById("bp-status-text")
const solrOutput = document.getElementById("bp-solr-output")
const turtleSection = document.getElementById("bp-turtle-section")
const turtleOutput = document.getElementById("bp-turtle-output")

const STATUS_LABELS = {
    local: "Speicherung: lokal in deinem Browser",
    solid: "Speicherung: in deinem Solid Pod",
}

function applyChoice() {
    const choice = localStorage.getItem(STORAGE_KEY)
    const isChosen = choice === "local" || choice === "solid"
    chooser.hidden = isChosen
    statusBox.hidden = !isChosen
    if (isChosen) statusText.textContent = STATUS_LABELS[choice]
}

document.getElementById("bp-choose-local-btn").addEventListener("click", () => {
    localStorage.setItem(STORAGE_KEY, "local")
    applyChoice()
})

document.getElementById("bp-choose-solid-btn").addEventListener("click", () => {
    localStorage.setItem(STORAGE_KEY, "solid")
    applyChoice()
})

document.getElementById("bp-switch-btn").addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY)
    applyChoice()
})

document.getElementById("bp-query-solr-btn").addEventListener("click", async () => {
    solrOutput.textContent = "Lade..."
    try {
        const res = await fetch(`${__SOLR_ENDPOINT__}?q=*:*&rows=0&wt=json`)
        const json = await res.json()
        solrOutput.textContent = `Solr: ${json.response.numFound} Dokumente im Index`
    } catch (err) {
        solrOutput.textContent = `Solr error: ${err.message}`
    }
})

async function demoTriple() {
    const store = newStore()
    addTriple(
        store,
        "http://example.org/alice",
        "http://xmlns.com/foaf/0.1/knows",
        "http://example.org/bob",
    )
    turtleOutput.textContent = await storeToTurtle(store, {
        ex: "http://example.org/",
        foaf: "http://xmlns.com/foaf/0.1/",
    })
    turtleSection.hidden = false
}

function decorateHeading(h2) {
    const btn = document.createElement("button")
    btn.textContent = "+"
    btn.title = "Zu Favoriten hinzufügen"
    btn.style.cssText = "margin-left: 0.5em; font-size: 0.7em; padding: 0.1em 0.4em;"
    btn.addEventListener("click", () => console.log(h2.id))
    h2.appendChild(btn)
}

document.querySelectorAll("h2").forEach(decorateHeading)

applyChoice()
demoTriple()
