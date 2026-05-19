import { getChoice, setChoice, clearChoice, isStorageReady, warmupStorage, addTriple, loadAsTurtle, loadQuads, getStorageInfo, clearStorage } from "./storage/index.js"
import { initSession, login, logout, isLoggedIn, currentPageUrl } from "./storage/solid.js"
import { expandTerm, contractTerm, getLabel, fetchBook } from "./utils.js"
import cockpitCss from "./ui/cockpit.css?raw"
import entryHtml from "./ui/entry.html?raw"
import modalHtml from "./ui/modal.html?raw"

const SWITCH_LABELS = {
    local: "Speicherort wechseln",
    solid: "Aus Pod abmelden",
}

const SOLID_POD_SUGGESTIONS = [
    { url: "https://solidcommunity.net/", label: "solidcommunity.net" },
    { url: "https://start.inrupt.com/profile", label: "Inrupt PodSpaces" },
]

// Scoped styles injected once into <head>. Both hosts (docs, TYPO3) get the same
// look without coordinating stylesheets.
const STYLE_ID = "bp-cori-styles"

// Captured from mount() options so decorateBooks() can reach the Solr endpoint
// without changing its public signature.
let solrEndpointUrl = null

function injectStyles() {
    if (document.getElementById(STYLE_ID)) return
    const style = document.createElement("style")
    style.id = STYLE_ID
    style.textContent = cockpitCss
    document.head.appendChild(style)
}


export async function mount(root, { solrEndpoint, solidCallbackUrl } = {}) {
    injectStyles()
    solrEndpointUrl = solrEndpoint
    // Host's .button pill styling is scoped to .maincontents. On pages where
    // TYPO3 places #bp-root outside that scope (e.g. homepage header), reparent
    // it so the entry button + modal sit inside .maincontents and pick up the
    // host's styling naturally. On /bib-pods (already inside) this is a no-op.
    const mainContents = document.querySelector(".maincontents")
    if (mainContents && !root.closest(".maincontents")) {
        mainContents.prepend(root)
    }
    root.innerHTML = entryHtml

    // Native <dialog> opened via showModal() renders in the browser's top layer,
    // so parent overflow/z-index can't clip it regardless of DOM position. We
    // attach inside `root` (not <body>) so the dialog stays within the host's
    // content scope — e.g. on TYPO3 it sits inside `.maincontents` and inherits
    // the brand's button/link styling. Created once per mount() call.
    const modalHost = document.createElement("div")
    modalHost.innerHTML = modalHtml
    const dialog = modalHost.firstElementChild
    root.appendChild(dialog)

    const openBtn = root.querySelector(".bp-open-btn")

    const closeBtn = dialog.querySelector(".bp-modal-close")
    const chooser = dialog.querySelector("#bp-chooser")
    const solidSetup = dialog.querySelector("#bp-solid-setup")
    const suggestionsList = dialog.querySelector("#bp-solid-suggestions")
    const statusBox = dialog.querySelector("#bp-status")
    const switchBtn = dialog.querySelector("#bp-switch-btn")
    const infoDetails = dialog.querySelector("#bp-info-details")
    const profileDetails = dialog.querySelector("#bp-profile-details")
    const addTripleBtn = dialog.querySelector("#bp-add-triple-btn")
    const downloadBtn = dialog.querySelector("#bp-download-btn")
    const clearBtn = dialog.querySelector("#bp-clear-btn")
    const solidInput = dialog.querySelector("#bp-solid-input")

    SOLID_POD_SUGGESTIONS.forEach(({ url, label }) => {
        const li = document.createElement("li")
        const a = document.createElement("a")
        a.href = url
        a.target = "_blank"
        a.rel = "noopener"
        a.textContent = label
        li.appendChild(a)
        suggestionsList.appendChild(li)
    })

    let isInSolidSetup = false

    function applyState() {
        const choice = getChoice()
        const isChosen = choice === "local" || choice === "solid"

        openBtn.textContent = isChosen ? "Bibliotheks-Pods Cockpit" : "Bibliotheks-Pods aktivieren"
        if (isChosen) {
            switchBtn.textContent = SWITCH_LABELS[choice]
            renderInfo()
            renderProfile()
        }

        chooser.hidden = isChosen || isInSolidSetup
        solidSetup.hidden = isChosen || !isInSolidSetup
        statusBox.hidden = !isChosen
    }

    async function renderInfo() {
        infoDetails.innerHTML = ""
        try {
            const info = await getStorageInfo()
            for (const [k, v] of Object.entries(info)) {
                const tr = infoDetails.insertRow()
                tr.insertCell().textContent = k + ":"
                tr.insertCell().textContent = v
            }
        } catch (err) {
            console.error("[bib-pods] info render failed:", err)
        }
    }

    async function renderProfile() {
        profileDetails.innerHTML = ""
        if (!isStorageReady()) return
        try {
            const quads = await loadQuads()
            for (const q of quads) {
                const tr = profileDetails.insertRow()
                tr.insertCell().textContent = contractTerm(q.subject.value)
                tr.insertCell().textContent = getLabel(q.predicate.value) ?? contractTerm(q.predicate.value)
                tr.insertCell().textContent = contractTerm(q.object.value)
            }
        } catch (err) {
            console.error("[bib-pods] profile render failed:", err)
        }
    }

    async function downloadProfile() {
        const ttl = await loadAsTurtle()
        const blob = new Blob([ttl], { type: "text/turtle" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = "bib-pods.ttl"
        a.click()
        URL.revokeObjectURL(url)
    }

    function openModal() {
        applyState()
        dialog.showModal()
    }

    const redirectUri = solidCallbackUrl ?? currentPageUrl()
    await initSession({ redirectUri })
    if (isLoggedIn() && getChoice() !== "solid") setChoice("solid")
    if (isStorageReady()) {
        warmupStorage().catch(err => console.error("Storage warmup failed:", err))
    }

    openBtn.addEventListener("click", openModal)
    closeBtn.addEventListener("click", () => dialog.close())
    dialog.addEventListener("click", (e) => {
        if (e.target === dialog) dialog.close()
    })
    dialog.addEventListener("close", () => {
        isInSolidSetup = false
        applyState()
    })

    dialog.querySelector("#bp-choose-local-btn").addEventListener("click", () => {
        setChoice("local")
        applyState()
        warmupStorage().catch(err => console.error("Storage warmup failed:", err))
    })

    dialog.querySelector("#bp-choose-solid-btn").addEventListener("click", () => {
        isInSolidSetup = true
        applyState()
    })

    dialog.querySelector("#bp-solid-cancel-btn").addEventListener("click", () => {
        isInSolidSetup = false
        applyState()
    })

    dialog.querySelector("#bp-solid-connect-btn").addEventListener("click", async () => {
        const issuer = solidInput.value.trim()
        if (!issuer) return
        await login(issuer, {
            redirectUri,
            returnUrl: solidCallbackUrl ? window.location.href : undefined,
        })
    })

    switchBtn.addEventListener("click", async () => {
        if (getChoice() === "solid") await logout()
        clearChoice()
        isInSolidSetup = false
        applyState()
    })

    addTripleBtn?.addEventListener("click", async () => {
        const input = window.prompt("Triple eingeben (Subjekt Prädikat Objekt, durch Leerzeichen getrennt).\nPräfixe sind möglich, z.B.: ex:alice ex:knows ex:bob",)
        if (!input) return
        const terms = input.trim().split(/\s+/)
        if (terms.length !== 3) {
            console.error(`[bib-pods] expected 3 tokens (subject predicate object), got ${terms.length}:`, terms)
            return
        }
        const [s, p, o] = terms.map(expandTerm)
        try {
            await addTriple(s, p, o)
            renderProfile()
        } catch (err) {
            console.error("[bib-pods] addTriple failed:", err)
        }
    })

    downloadBtn?.addEventListener("click", async () => {
        try {
            await downloadProfile()
        } catch (err) {
            console.error("[bib-pods] download failed:", err)
        }
    })

    clearBtn?.addEventListener("click", async () => {
        if (!window.confirm("Wirklich alle Einträge im Profil löschen? Dies kann nicht rückgängig gemacht werden.")) return
        try {
            await clearStorage()
            renderProfile()
        } catch (err) {
            console.error("[bib-pods] clearStorage failed:", err)
        }
    })

    applyState()
}

// aDIS/BMS SOPAC URLs use `sp=S<key>` where the leading `S` is a service-param
// type tag and the numeric portion is zero-padded to 8 digits. Solr stores the
// bare MARC 001 (e.g. "AK4250109"), so strip both.
const SOPAC_RE = /[?&]sp=S(AK)0*(\d+)/

function decorateBookCard(target, sopacId) {
    // msbWrap is the MSB carousel's .linkify-active wrapper around a real
    // book — truthy means we're on production HTML, null means we're decorating
    // a dev pseudo book (just a [data-sopac-id] element). For real books we
    // must mount the button *outside* this wrapper (linkify can listen capture-
    // phase / at document level, so stopPropagation isn't enough); for pseudo
    // books we mount directly on the target.
    const msbWrap = target.closest(".coverflow__wrap")
    const host = msbWrap?.parentElement ?? target

    const btn = document.createElement("button")
    btn.type = "button"
    btn.textContent = "+"
    btn.title = "Zu Favoriten hinzufügen"
    btn.style.cssText = msbWrap
        ? "position: absolute; top: 0.4em; right: 0.4em; z-index: 10; width: 1.7em; height: 1.7em; padding: 0; font-size: 1.1em; font-weight: bold; line-height: 1; border: 1px solid currentColor; border-radius: 50%; background: rgba(255,255,255,0.92); cursor: pointer; box-shadow: 0 3px 10px rgba(0,0,0,0.4);"
        : "margin-left: 0.5em; cursor: pointer;"

    if (msbWrap && getComputedStyle(host).position === "static") host.style.position = "relative"
    btn.addEventListener("click", async () => {
        try {
            const book = await fetchBook(solrEndpointUrl, sopacId)
            console.log("[bib-pods] book:", book)
        } catch (err) {
            console.error("[bib-pods] fetchBook failed:", err)
        }
    })
    host.appendChild(btn)

    // For carousel books, anchor the button's center to the cover image's
    // top-right corner (slide is wider than the auto-width cover, so em offsets
    // land off the artwork). Re-anchor on image load if it hadn't sized yet.
    const img = msbWrap?.querySelector(".cf-image img")
    if (img) {
        const anchor = () => {
            const hostRect = host.getBoundingClientRect()
            const imgRect = img.getBoundingClientRect()
            if (imgRect.width === 0) return
            btn.style.top = `${imgRect.top - hostRect.top - btn.offsetHeight / 2}px`
            btn.style.right = `${hostRect.right - imgRect.right - btn.offsetWidth / 2}px`
        }
        anchor()
        if (!img.complete) img.addEventListener("load", anchor, { once: true })
    }
}

export function decorateBooks() {
    document.querySelectorAll('a[href*="sp=SAK"]').forEach(link => {
        const match = link.href.match(SOPAC_RE)
        if (match) decorateBookCard(link, match[1] + match[2])
    })
    // Pseudo books carry the already-clean id directly; used for dev/testing.
    document.querySelectorAll("[data-sopac-id]").forEach(el => {
        decorateBookCard(el, el.dataset.sopacId)
    })
}
