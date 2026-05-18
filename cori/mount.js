import { initSession, login, logout, isLoggedIn, getWebId, currentPageUrl, ensurePodSetup, testReadPodFile, testWritePodTriple } from "./solid.js"
import { getChoice, setChoice, clearChoice } from "./storage.js"

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

const TEMPLATE = `
    <section id="bp-chooser">
        <p>Wo sollen deine Daten gespeichert werden?</p>
        <button id="bp-choose-local-btn">Lokal im Browser</button>
        <button id="bp-choose-solid-btn">In meinem Solid Pod</button>
    </section>
    <section id="bp-solid-setup" hidden>
        <p>Du hast noch keinen Pod? Hier sind einige Anbieter:</p>
        <ul id="bp-solid-suggestions"></ul>
        <p>
            <input type="url" id="bp-solid-input" placeholder="Provider URL">
            <button id="bp-solid-connect-btn">Verbinden</button>
        </p>
        <button id="bp-solid-cancel-btn">Zurück</button>
    </section>
    <section id="bp-status" hidden>
        <p id="bp-status-text"></p>
        <button id="bp-switch-btn">Speicherort wechseln</button>
        <span id="bp-test-actions" hidden>
            &nbsp;&nbsp;<a id="bp-test-write-btn" href="#">test write</a>
            &nbsp;<a id="bp-test-read-btn" href="#">test read</a>
        </span>
    </section>
`

export async function mount(root, { solrEndpoint, solidCallbackUrl } = {}) {
    root.innerHTML = TEMPLATE

    const chooser = root.querySelector("#bp-chooser")
    const solidSetup = root.querySelector("#bp-solid-setup")
    const suggestionsList = root.querySelector("#bp-solid-suggestions")
    const statusBox = root.querySelector("#bp-status")
    const statusText = root.querySelector("#bp-status-text")
    const switchBtn = root.querySelector("#bp-switch-btn")
    const testActions = root.querySelector("#bp-test-actions")
    const testWriteBtn = root.querySelector("#bp-test-write-btn")
    const testReadBtn = root.querySelector("#bp-test-read-btn")
    const solidInput = root.querySelector("#bp-solid-input")

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
        chooser.hidden = isChosen || isInSolidSetup
        solidSetup.hidden = isChosen || !isInSolidSetup
        statusBox.hidden = !isChosen
        if (isChosen) {
            const label = STATUS_LABELS[choice]
            const webId = choice === "solid" ? getWebId() : null
            statusText.textContent = webId ? `${label} (${webId})` : label
            switchBtn.textContent = SWITCH_LABELS[choice]
            testActions.hidden = choice !== "solid" || !isLoggedIn()
        }
    }

    const redirectUri = solidCallbackUrl ?? currentPageUrl()
    await initSession({ redirectUri })
    if (isLoggedIn()) {
        if (getChoice() !== "solid") setChoice("solid")
        ensurePodSetup().catch(err => console.error("Solid pod setup failed:", err))
    }

    root.querySelector("#bp-choose-local-btn").addEventListener("click", () => {
        setChoice("local")
        applyState()
    })

    root.querySelector("#bp-choose-solid-btn").addEventListener("click", () => {
        isInSolidSetup = true
        applyState()
    })

    root.querySelector("#bp-solid-cancel-btn").addEventListener("click", () => {
        isInSolidSetup = false
        applyState()
    })

    root.querySelector("#bp-solid-connect-btn").addEventListener("click", async () => {
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
        await testWritePodTriple()
    })

    testReadBtn.addEventListener("click", async (e) => {
        e.preventDefault()
        await testReadPodFile()
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
