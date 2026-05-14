import { querySolrCount, buildDemoTurtle } from "./lib.js"

const STORAGE_KEY = "bib-pods.storage"

const STATUS_LABELS = {
    local: "Speicherung: lokal in deinem Browser",
    solid: "Speicherung: in deinem Solid Pod",
}

const TEMPLATE = `
    <section id="bp-chooser">
        <p>Wo sollen deine Daten gespeichert werden?</p>
        <button id="bp-choose-local-btn">Lokal im Browser</button>
        <button id="bp-choose-solid-btn">In meinem Solid Pod</button>
    </section>
    <section id="bp-status" hidden>
        <p id="bp-status-text"></p>
        <button id="bp-switch-btn">Speicherort wechseln</button>
    </section>

    <hr>
    <button id="bp-query-solr-btn">Query Solr</button>
    <p id="bp-solr-output"></p>

    <section id="bp-turtle-section" hidden>
        <hr>
        <p>Example turtle:</p>
        <pre id="bp-turtle-output"></pre>
    </section>
`

const DUMMY_H2S = `
    <hr>
    <section id="bp-dummy-h2s">
        <h2 id="dummy-book-id-1">Buch 1</h2>
        <h2 id="dummy-book-id-2">Buch 2</h2>
    </section>
`

export function mount(root, { solrEndpoint, isLocalDev = false }) {
    root.innerHTML = TEMPLATE
    if (isLocalDev) root.insertAdjacentHTML("afterend", DUMMY_H2S)

    const chooser = root.querySelector("#bp-chooser")
    const statusBox = root.querySelector("#bp-status")
    const statusText = root.querySelector("#bp-status-text")
    const solrOutput = root.querySelector("#bp-solr-output")
    const turtleSection = root.querySelector("#bp-turtle-section")
    const turtleOutput = root.querySelector("#bp-turtle-output")

    function applyChoice() {
        const choice = localStorage.getItem(STORAGE_KEY)
        const isChosen = choice === "local" || choice === "solid"
        chooser.hidden = isChosen
        statusBox.hidden = !isChosen
        if (isChosen) statusText.textContent = STATUS_LABELS[choice]
    }

    root.querySelector("#bp-choose-local-btn").addEventListener("click", () => {
        localStorage.setItem(STORAGE_KEY, "local")
        applyChoice()
    })

    root.querySelector("#bp-choose-solid-btn").addEventListener("click", () => {
        localStorage.setItem(STORAGE_KEY, "solid")
        applyChoice()
    })

    root.querySelector("#bp-switch-btn").addEventListener("click", () => {
        localStorage.removeItem(STORAGE_KEY)
        applyChoice()
    })

    root.querySelector("#bp-query-solr-btn").addEventListener("click", async () => {
        solrOutput.textContent = "Lade..."
        try {
            const count = await querySolrCount(solrEndpoint)
            solrOutput.textContent = `Solr: ${count} Dokumente im Index`
        } catch (err) {
            solrOutput.textContent = `Solr error: ${err.message}`
        }
    })

    buildDemoTurtle().then(turtle => {
        turtleOutput.textContent = turtle
        turtleSection.hidden = false
    })

    applyChoice()
}

function decorateHeading(h2) {
    const btn = document.createElement("button")
    btn.textContent = "+"
    btn.title = "Zu Favoriten hinzufügen"
    btn.style.cssText = "margin-left: 0.5em; font-size: 0.7em; padding: 0.1em 0.4em;"
    btn.addEventListener("click", () => console.log(h2.id))
    h2.appendChild(btn)
}

export function decorateH2s() {
    document.querySelectorAll("h2").forEach(decorateHeading)
}
