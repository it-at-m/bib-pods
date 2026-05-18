import { getChoice, setChoice, clearChoice, isStorageReady, warmupStorage, addTriple, loadAsTurtle, loadQuads, getStorageInfo, clearStorage } from "./storage/index.js"
import { initSession, login, logout, isLoggedIn, currentPageUrl } from "./storage/solid.js"
import { expandTerm, contractTerm, getLabel } from "./utils.js"
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

function injectStyles() {
    if (document.getElementById(STYLE_ID)) return
    const style = document.createElement("style")
    style.id = STYLE_ID
    style.textContent = cockpitCss
    document.head.appendChild(style)
}


export async function mount(root, { solrEndpoint, solidCallbackUrl } = {}) {
    injectStyles()
    root.innerHTML = entryHtml

    // Native <dialog> opened via showModal() renders in the browser's top layer,
    // so parent overflow/z-index can't clip it. Attached to <body> as a neutral
    // host outside the cori-controlled root. Created once per mount() call.
    const modalHost = document.createElement("div")
    modalHost.innerHTML = modalHtml
    const dialog = modalHost.firstElementChild
    document.body.appendChild(dialog)

    const welcomeText = root.querySelector(".bp-welcome-text")
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

        welcomeText.textContent = isChosen ? "Bibliotheks-Pods Plugin" : "Willkommen zum Bibliotheks-Pods Plugin"
        openBtn.textContent = isChosen ? "Cockpit" : "Einrichten"
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

    addTripleBtn.addEventListener("click", async () => {
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

    downloadBtn.addEventListener("click", async () => {
        try {
            await downloadProfile()
        } catch (err) {
            console.error("[bib-pods] download failed:", err)
        }
    })

    clearBtn.addEventListener("click", async () => {
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
