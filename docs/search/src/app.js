// Hub of the search page. The single internal model is the query AST — a
// nested expression tree (see model.js). A panel that parses a valid edit
// commits a new AST; the hub normalizes it, and if it actually changed,
// broadcasts render(ast) to every panel except the one that originated it.
// The force-graph panel is the only one that reshapes the AST (into nodes +
// links); the rest map the tree straight onto their widgets.
import { fromSolr, toSolr, astKey, normalize, DEFAULT_QUERY } from "./model.js"

const ENDPOINT_KEY = "bib-pods.solr-endpoint"
const PUBLIC_ENDPOINT = "https://bib-pods.ngrok.dev/solr/interim-index/select"

let currentAst
const panels = []

function setQuery(ast) {
    currentAst = ast
    window.queryAst = ast // inspectable in the browser console
}
setQuery(fromSolr(DEFAULT_QUERY))

function commit(ast, source) {
    ast = normalize(ast)
    if (astKey(ast) === astKey(currentAst)) return
    setQuery(ast)
    for (const panel of panels) {
        if (panel !== source) panel.render(currentAst)
    }
    updateStatus()
}

// Panels are isolated failure domains: each depends on its own third-party
// code (CDN globals, the esm.sh React island), so one unreachable CDN must
// degrade that panel, not the page. Modules are imported lazily and any
// load/init error lands in the panel's status badge.
async function addPanel(sectionId, moduleName, exportName) {
    try {
        const create = (await import(`./${moduleName}.js`))[exportName]
        const panel = create(ast => commit(ast, panel))
        panels.push(panel)
        panel.render(currentAst)
    } catch (err) {
        document.querySelector(`#${sectionId} .panel-status`).textContent = `✗ panel failed to load: ${err.message}`
    }
}

// ------------------------------------------------------------- examples

// Curated queries that return real results against the index (counts noted
// for reference; verified June 2026). Each is expressible in the model — no
// ranges/boosts. Selecting one loads it into the model, which fans out to
// every panel.
const EXAMPLES = [
    { label: "Bach or Telemann recordings (~163)", q: DEFAULT_QUERY },
    { label: "King as e-book (onleihe), or a book about beekeeping (~110)", q: "(author:King AND electronic:true) OR topic:Imkerei" },
    { label: "The Witcher novels, no e-books (~23)", q: "author:Sapkowski AND NOT electronic:true" },
    { label: "Cats — as an e-book or as a comic (~2)", q: "(electronic:true OR genre:Comic) AND topic:Katze" },
    { label: "Volcanoes or earthquakes, print only (~77)", q: "(topic:Vulkan OR topic:Erdbeben) AND NOT electronic:true" },
    { label: "Discworld available via onleihe (~28)", q: "author:Pratchett AND electronic:true" },
]
const examplesSelect = document.getElementById("examples")
for (const ex of EXAMPLES) {
    const opt = document.createElement("option")
    opt.value = ex.q
    opt.textContent = ex.label
    examplesSelect.appendChild(opt)
}
examplesSelect.addEventListener("change", () => {
    if (!examplesSelect.value) return
    commit(fromSolr(examplesSelect.value), null) // null source → every panel re-renders
    examplesSelect.selectedIndex = 0 // reset to the placeholder
})

// ------------------------------------------------------------- status bar

const statusCount = document.getElementById("status-count")
// the hit count is a shortcut to the run section (final query + results)
statusCount.addEventListener("click", () =>
    document.querySelector(".run-section").scrollIntoView({ behavior: "smooth" }))

const endpointInput = document.getElementById("endpoint")
// Shares the query page's localStorage key; falls back to the public proxy
// without persisting it, so the query page's blank default stays blank.
endpointInput.value = localStorage.getItem(ENDPOINT_KEY) || PUBLIC_ENDPOINT
endpointInput.addEventListener("input", () => {
    localStorage.setItem(ENDPOINT_KEY, endpointInput.value)
    updateStatus()
})

let countTimer = null
let countAbort = null

function updateStatus() {
    const solr = toSolr(currentAst)
    finalQuery.textContent = solr
    statusCount.textContent = "…"
    clearTimeout(countTimer)
    countTimer = setTimeout(() => fetchCount(solr), 400)
    // the results table shows the last *submitted* query; flag it once the
    // live query has moved on, so a stale table doesn't read as current
    markResultsStale(submittedQuery !== null && submittedQuery !== solr)
}

async function fetchCount(solr) {
    countAbort?.abort()
    countAbort = new AbortController()
    const endpoint = endpointInput.value.trim()
    if (!endpoint) { statusCount.textContent = "" ; return }
    try {
        const params = new URLSearchParams({ q: solr, rows: "0", wt: "json" })
        const res = await fetch(`${endpoint}?${params}`, { signal: countAbort.signal })
        const data = await res.json()
        const n = data.response?.numFound
        statusCount.innerHTML = n === undefined
            ? "no result count in response"
            : `→ <strong>${n.toLocaleString("de-DE")}</strong> hits`
    } catch (err) {
        if (err.name !== "AbortError") statusCount.textContent = "endpoint not reachable"
    }
}

// ------------------------------------------------------------ run section

const finalQuery = document.getElementById("final-query")
const submitButton = document.getElementById("submit-query")
const results = document.getElementById("results")
const staleHint = document.getElementById("results-stale")
let submittedQuery = null // paging stays on the query that was submitted, even if panels change

function markResultsStale(stale) {
    staleHint.hidden = !stale
    results.classList.toggle("stale", stale)
}

async function fetchResults(start) {
    const endpoint = endpointInput.value.trim()
    if (!endpoint) { results.message("Set a Solr endpoint first (top of the page)."); return }
    results.message("Loading…")
    try {
        const params = new URLSearchParams({
            q: submittedQuery,
            rows: "10",
            start: String(start),
            fl: "id,title,author,genre,topic,publishDate",
            wt: "json",
        })
        const res = await fetch(`${endpoint}?${params}`)
        results.render(await res.json())
    } catch (err) {
        results.message(`Request failed: ${err.message}`)
    }
}

submitButton.addEventListener("click", () => {
    submittedQuery = toSolr(currentAst)
    markResultsStale(false)
    fetchResults(0)
})
results.addEventListener("page", (e) => fetchResults(e.detail.start))

// ----------------------------------------------------------------- wiring

await addPanel("panel-solr", "solr-panel", "createSolrPanel")
await addPanel("panel-nl", "nl-panel", "createNlPanel")
await addPanel("panel-chips", "chips-panel", "createChipsPanel")
await addPanel("panel-rqb", "rqb-panel", "createRqbPanel")
await addPanel("panel-blockly", "blockly-panel", "createBlocklyPanel")
await addPanel("panel-graph", "graph-panel", "createGraphPanel")

updateStatus()
