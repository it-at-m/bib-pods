import { initSession, login, logout, isLoggedIn, getWebId, currentPageUrl } from "./storage/solid.js"
import { getChoice, setChoice, clearChoice, isStorageReady, warmupStorage, testRead, testWrite } from "./storage/index.js"
import cockpitCss from "./ui/cockpit.css?raw"
import entryHtml from "./ui/entry.html?raw"
import modalHtml from "./ui/modal.html?raw"

const STATUS_LABELS = {
    local: "Speicherung: lokal in deinem Browser",
    solid: "Speicherung: in deinem Solid Pod",
}

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
    const statusText = dialog.querySelector("#bp-status-text")
    const switchBtn = dialog.querySelector("#bp-switch-btn")
    const testActions = dialog.querySelector("#bp-test-actions")
    const testWriteBtn = dialog.querySelector("#bp-test-write-btn")
    const testReadBtn = dialog.querySelector("#bp-test-read-btn")
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
            const label = STATUS_LABELS[choice]
            const webId = choice === "solid" ? getWebId() : null
            statusText.textContent = webId ? `${label} (${webId})` : label
            switchBtn.textContent = SWITCH_LABELS[choice]
            testActions.hidden = !isStorageReady()
        }

        chooser.hidden = isChosen || isInSolidSetup
        solidSetup.hidden = isChosen || !isInSolidSetup
        statusBox.hidden = !isChosen
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

    testWriteBtn.addEventListener("click", async (e) => {
        e.preventDefault()
        await testWrite()
    })

    testReadBtn.addEventListener("click", async (e) => {
        e.preventDefault()
        await testRead()
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
