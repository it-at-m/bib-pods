import { getChoice, setChoice, clearChoice, isStorageReady, warmupStorage, addTriple, loadAsTurtle, loadStore, getStorageInfo, getStorageEntryName, clearStorage, listMessages, markMessageRead, addMessage } from "cori-sdk/storage/index.js"
import { initSession, login, logout, isLoggedIn, currentPageUrl } from "cori-sdk/storage/solid.js"
import { expandTerm, contractTerm, getLabel, getOne, getProfileSubject, RDFS_LABEL } from "cori-sdk/utils.js"
import { decorateBooks, undecorateBooks } from "./decorate-books.js"
import { runRecommendations } from "./recommendations.js"
import { sopacCatalogueUrl } from "./catalogue.js"
import styleCss from "./ui/style.css?raw"
import entryHtml from "./ui/entry.html?raw"
import landingHtml from "./ui/landing.html?raw"
import modalHtml from "./ui/modal.html?raw"

const SWITCH_LABELS = {
    local: "Speicherort wechseln",
    solid: "Aus Pod abmelden",
}

// scoped styles injected once into <head>: both hosts (docs, TYPO3) get the same look without coordinating stylesheets
const STYLE_ID = "bp-styles"

function injectStyles() {
    if (document.getElementById(STYLE_ID)) return
    const style = document.createElement("style")
    style.id = STYLE_ID
    style.textContent = styleCss
    document.head.appendChild(style)
}

// lazy CDN load of Prism
let prismLoaded = null
function ensurePrism() {
    if (prismLoaded) return prismLoaded
    prismLoaded = (async () => {
        const css = document.createElement("link")
        css.rel = "stylesheet"
        css.href = "https://cdn.jsdelivr.net/npm/prismjs@1.29.0/themes/prism-okaidia.min.css"
        document.head.appendChild(css)
        await loadScript("https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-core.min.js")
        await loadScript("https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-turtle.min.js")
    })()
    return prismLoaded
}

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const s = document.createElement("script")
        s.src = src
        s.onload = () => resolve()
        s.onerror = reject
        document.head.appendChild(s)
    })
}

function renderMessageContent(m) {
    const fragment = document.createDocumentFragment()
    const nl = m.content.indexOf("\n")
    const prefix = nl < 0 ? null : m.content.slice(0, nl)
    const body = nl < 0 ? m.content : m.content.slice(nl + 1)
    if (prefix !== null) {
        const span = document.createElement("span")
        span.className = "bp-msg-prefix"
        span.textContent = prefix
        fragment.appendChild(span)
        fragment.appendChild(document.createElement("br"))
    }
    if (m.refersTo) {
        const a = document.createElement("a")
        a.href = sopacCatalogueUrl(m.refersTo)
        a.target = "_blank"
        a.rel = "noopener"
        a.className = "bp-msg-link"
        a.textContent = body
        fragment.appendChild(a)
    } else {
        fragment.appendChild(document.createTextNode(body))
    }
    return fragment
}

function buildTurtleDialog() {
    const d = document.createElement("dialog")
    d.className = "bp-modal bp-turtle-view"
    d.innerHTML = `
        <div class="bp-modal-content">
            <div class="bp-modal-header">
                <h3>Profil-Turtle</h3>
                <button type="button" class="bp-modal-close">Schließen</button>
            </div>
            <pre style="margin: 0; max-height: 60vh; overflow: auto;"><code class="language-turtle"></code></pre>
        </div>`
    d.querySelector(".bp-modal-close").addEventListener("click", () => d.close())
    d.addEventListener("click", (e) => { if (e.target === d) d.close() })
    return d
}

export async function installCockpit(root, { solrEndpoint, solidCallbackUrl, openBookPrompt, landing = false, mainHref } = {}) {
    injectStyles()
    // Host's .button pill styling is scoped to .maincontents. On pages where
    // TYPO3 places #bp-root outside that scope (e.g. homepage header), reparent
    // it so the entry button + modal sit inside .maincontents and pick up the
    // host's styling naturally. On /bib-pods (already inside) this is a no-op.
    const mainContents = document.querySelector(".maincontents")
    if (mainContents && !root.closest(".maincontents")) {
        mainContents.prepend(root)
    }
    // Append (don't overwrite) so siblings already attached to root — notably the
    // book-prompt dialog installed in main.js before installCockpit — survive.
    // On the main page render the full landing page and drop the open button into
    // its activation slot; elsewhere render just the compact button.
    if (landing) {
        root.insertAdjacentHTML("beforeend", landingHtml)
        root.querySelector(".bp-entry-mount").insertAdjacentHTML("beforeend", entryHtml)
    } else {
        root.insertAdjacentHTML("beforeend", entryHtml)
    }

    // Native <dialog> opened via showModal() renders in the browser's top layer,
    // so parent overflow/z-index can't clip it regardless of DOM position. We
    // attach inside `root` (not <body>) so the dialog stays within the host's
    // content scope — e.g. on TYPO3 it sits inside `.maincontents` and inherits
    // the brand's button/link styling. Created once per installCockpit() call.
    const modalHost = document.createElement("div")
    modalHost.innerHTML = modalHtml
    const dialog = modalHost.firstElementChild
    root.appendChild(dialog)

    const openBtn = root.querySelector(".bp-open-btn")
    const openBtnLabel = root.querySelector(".bp-open-btn-label")
    const badge = root.querySelector(".bp-badge")
    // Landing-page blocks revealed only after a storage choice is made; empty in
    // the compact embed, so the toggle below is a no-op there.
    const activatedBlocks = root.querySelectorAll(".bp-when-activated")
    // Present only in the landing embed (null otherwise).
    const landingRoot = root.querySelector(".bp-landing")

    const closeBtn = dialog.querySelector(".bp-modal-close")
    const chooser = dialog.querySelector("#bp-chooser")
    const solidSetup = dialog.querySelector("#bp-solid-setup")
    const statusBox = dialog.querySelector("#bp-status")
    const switchBtn = dialog.querySelector("#bp-switch-btn")
    const infoDetails = dialog.querySelector("#bp-info-details")
    // The profile section and the recommendations list ("Empfehlungen") live in
    // the landing page (landing embed only). The modal keeps the storage info,
    // the "prüfen" button, and a link sending users to the main page.
    const profileDetails = root.querySelector("#bp-profile-details")
    const messagesSection = root.querySelector("#bp-messages")
    const msgOldSection = root.querySelector("#bp-msg-old-section")
    const msgNewList = root.querySelector("#bp-msg-new")
    const msgOldList = root.querySelector("#bp-msg-old")
    const checkRecBtn = dialog.querySelector("#bp-check-recommendations-btn")
    const checkRecLink = root.querySelector("#bp-check-recommendations-link")
    const recommendationsLink = dialog.querySelector("#bp-recommendations-link")
    if (recommendationsLink) {
        const link = recommendationsLink.querySelector("a")
        // mainHref is absent in single-page embeds (e.g. the docs demo); the anchor
        // alone then scrolls within the current page.
        link.href = (mainHref ?? "") + "#bp-showcase"
        // Close the modal first, then let the browser follow the href — navigating
        // to the main page when off it, or just scrolling to the showcase if here.
        link.addEventListener("click", () => dialog.close())
    }
    const addTripleBtn = root.querySelector("#bp-add-triple-btn")
    const downloadBtn = root.querySelector("#bp-download-btn")
    const clearBtn = root.querySelector("#bp-clear-btn")
    const profileHeading = root.querySelector("#bp-profile-heading")
    const solidInput = dialog.querySelector("#bp-solid-input")
    let turtleViewDialog = null

    let isInSolidSetup = false
    // Tracks the last activation state applied to the landing's top blocks, so we
    // only collapse/expand them on the transition — not on every re-render.
    let lastLandingActivation = null

    function applyState() {
        const choice = getChoice()
        const isChosen = choice === "local" || choice === "solid"

        openBtnLabel.textContent = isChosen ? "Bibliotheks-Pods Cockpit" : "Bibliotheks-Pods aktivieren"
        if (isChosen) {
            switchBtn.textContent = SWITCH_LABELS[choice]
            renderInfo()
            renderProfile()
            renderMessages()
            decorateBooks({ solrEndpoint, onBookClick: openBookPrompt })
        } else {
            badge.hidden = true
            messagesSection.hidden = true
            undecorateBooks()
        }

        chooser.hidden = isChosen || isInSolidSetup
        solidSetup.hidden = isChosen || !isInSolidSetup
        statusBox.hidden = !isChosen
        for (const block of activatedBlocks) block.hidden = !isChosen

        if (landingRoot) {
            landingRoot.classList.toggle("is-activated", isChosen)
            // Collapse the top blocks to links on activation, expand them on
            // deactivation — only on the transition, so a manually expanded block
            // survives later re-renders (e.g. closing the modal).
            if (isChosen !== lastLandingActivation) {
                for (const d of landingRoot.querySelectorAll(".bp-collapsible")) d.open = !isChosen
                lastLandingActivation = isChosen
            }
        }
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
        if (!profileDetails) return
        profileDetails.innerHTML = ""
        if (!isStorageReady()) return
        try {
            const store = await loadStore()
            // show only profile-triples
            // subject column omitted — every row is the default profile subject (ex:me), self-evident from context
            for (const q of store.getQuads(getProfileSubject(), null, null, null)) {
                const tr = profileDetails.insertRow()
                tr.insertCell().textContent = getLabel(q.predicate.value) ?? contractTerm(q.predicate.value)
                // IRI objects: prefer the locally stored and cleaned rdfs:label; literals pass through
                tr.insertCell().textContent = q.object.termType === "NamedNode"
                    ? (getOne(store, q.object.value, RDFS_LABEL) ?? contractTerm(q.object.value))
                    : q.object.value
            }
        } catch (err) {
            console.error("[bib-pods] profile render failed:", err)
        }
    }

    function resetMessagesUI() {
        msgNewList?.replaceChildren()
        msgOldList?.replaceChildren()
        badge.hidden = true
        if (messagesSection) messagesSection.hidden = true
        if (msgOldSection) msgOldSection.hidden = true
        if (recommendationsLink) recommendationsLink.hidden = true
    }

    async function renderMessages() {
        if (!isStorageReady()) return resetMessagesUI()
        try {
            const messages = await listMessages()
            if (messages.length === 0) return resetMessagesUI()
            const unread = messages.filter(m => !m.read)
            const readMessages = messages.filter(m => m.read)

            badge.hidden = unread.length === 0
            badge.textContent = unread.length > 9 ? "9+" : String(unread.length)

            // Modal link to the main page (where the list lives), shown whenever
            // there are unread recommendations.
            if (recommendationsLink) {
                const showLink = unread.length > 0
                recommendationsLink.hidden = !showLink
                if (showLink) {
                    recommendationsLink.querySelector("a").textContent =
                        `${unread.length} neue Empfehlung${unread.length === 1 ? "" : "en"} ansehen`
                }
            }

            // The list itself only exists in the landing embed.
            if (!messagesSection) return

            // Clear only after the load completes — keeps the old DOM visible during
            // the await so re-renders (e.g. "mark as read") don't flash empty.
            msgNewList.replaceChildren()
            msgOldList.replaceChildren()
            messagesSection.hidden = false
            msgOldSection.hidden = readMessages.length === 0
            for (const m of unread) {
                const li = document.createElement("li")
                li.appendChild(renderMessageContent(m))
                const markLink = document.createElement("a")
                markLink.href = "#"
                markLink.className = "bp-mark-read"
                markLink.textContent = "Als gelesen markieren"
                markLink.addEventListener("click", async (e) => {
                    e.preventDefault()
                    try {
                        await markMessageRead(m.uri)
                        renderMessages()
                    } catch (err) {
                        console.error("[bib-pods] markMessageRead failed:", err)
                    }
                })
                li.appendChild(document.createElement("br"))
                li.appendChild(markLink)
                msgNewList.appendChild(li)
            }
            for (const m of readMessages) {
                const li = document.createElement("li")
                li.appendChild(renderMessageContent(m))
                msgOldList.appendChild(li)
            }
        } catch (err) {
            console.error("[bib-pods] messages render failed:", err)
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
        try {
            await login(issuer, {
                redirectUri,
                returnUrl: solidCallbackUrl ? window.location.href : undefined,
            })
        } catch (err) {
            console.error("[bib-pods] Solid login failed:", err)
            window.alert(`Verbindung zu ${issuer} fehlgeschlagen:\n${err?.message ?? err}`)
        }
    })

    switchBtn.addEventListener("click", async () => {
        if (getChoice() === "solid") await logout()
        clearChoice()
        isInSolidSetup = false
        applyState()
    })

    profileHeading?.addEventListener("click", async () => {
        if (!isStorageReady()) return
        try {
            await ensurePrism()
            const ttl = await loadAsTurtle()
            if (!turtleViewDialog) {
                turtleViewDialog = buildTurtleDialog()
                root.appendChild(turtleViewDialog)
            }
            turtleViewDialog.querySelector("h3").textContent = getStorageEntryName()
            const code = turtleViewDialog.querySelector("code")
            code.textContent = ttl
            window.Prism.highlightElement(code)
            turtleViewDialog.showModal()
        } catch (err) {
            console.error("[bib-pods] profile turtle view failed:", err)
        }
    })

    // Triggered from the modal button and the Schaufenster link. Guards against
    // concurrent runs and shows a loading label on whichever triggers exist.
    let recCheckBusy = false
    async function checkRecommendations() {
        if (!isStorageReady() || recCheckBusy) return
        recCheckBusy = true
        const triggers = [checkRecBtn, checkRecLink].filter(Boolean)
        const labels = triggers.map(t => t.textContent)
        triggers.forEach(t => { t.textContent = "Lädt …"; if ("disabled" in t) t.disabled = true })
        try {
            const profileStore = await loadStore()
            const results = await runRecommendations(profileStore, getProfileSubject(), solrEndpoint)
            let count = 0
            for (const { strategy, docs } of results) {
                for (const doc of docs) {
                    const title = doc.title?.[0] ?? doc.id
                    await addMessage(`${strategy.label}\n${title}`, doc.id)
                    count++
                }
            }
            if (count === 0) {
                window.alert("Keine Empfehlungen gefunden — vielleicht fehlen noch Profileinträge?")
            }
            applyState()
        } catch (err) {
            console.error("[bib-pods] recommendations failed:", err)
            window.alert("Empfehlungen konnten nicht geladen werden:\n" + (err?.message ?? err))
        } finally {
            triggers.forEach((t, i) => { t.textContent = labels[i]; if ("disabled" in t) t.disabled = false })
            recCheckBusy = false
        }
    }
    checkRecBtn?.addEventListener("click", () => checkRecommendations())
    checkRecLink?.addEventListener("click", (e) => { e.preventDefault(); checkRecommendations() })

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
            applyState()
        } catch (err) {
            console.error("[bib-pods] clearStorage failed:", err)
        }
    })

    applyState()

    // Arriving via the modal's recommendations link (#bp-showcase): the landing
    // content mounts asynchronously, so the browser's on-load fragment jump can
    // miss it — scroll once it's in place. applyState has just revealed the block.
    if (landing && location.hash === "#bp-showcase") {
        root.querySelector("#bp-showcase")?.scrollIntoView()
    }

    return { applyState }
}
