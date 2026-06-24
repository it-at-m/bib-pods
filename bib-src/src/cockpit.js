import { getChoice, setChoice, clearChoice, isStorageReady, warmupStorage, loadStore, getStorageInfo, listMessages, markMessageRead, addMessageIfNew, replaceSubjectObjects } from "cori-sdk/storage/index.js"
import { initSession, login, logout, isLoggedIn, currentPageUrl } from "cori-sdk/storage/solid.js"
import { getProfileSubject, storageErrorMessage } from "cori-sdk/utils.js"
import "cori-sdk/ui/profile.js" // registers the <cori-profile> primitive
import { decorateCards, undecorateCards } from "./decorate-cards.js"
import { runRecommendations, getStrategies, readDisabledStrategies, explainStrategy, DISABLED_STRATEGY, SETTINGS_SUBJECT } from "./recommendations.js"
import { sopacCatalogueUrl } from "./catalogue.js"
import { installInterestPicker } from "./interests.js"
import styleCss from "./ui/style.css?raw"
import entryHtml from "./ui/entry.html?raw"
import landingHtml from "./ui/landing.html?raw"
import modalHtml from "./ui/modal.html?raw"

const SWITCH_LABELS = {
    local: "Speicherort wechseln",
    session: "Speicherort wechseln",
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

// A labelled lane = a strategy heading + a horizontally scrolling track of book cards.
// ctx carries { onDismiss, tip, explanation } shared by every card in the lane.
function buildLane(label, items, ctx) {
    const lane = document.createElement("div")
    lane.className = "bp-lane"
    const heading = document.createElement("h4")
    heading.className = "bp-lane-title"
    heading.textContent = label
    lane.appendChild(heading)
    const track = document.createElement("div")
    track.className = "bp-lane-track"
    for (const item of items) track.appendChild(buildCard(item, ctx))
    lane.appendChild(track)
    return lane
}

// One book card: a cover placeholder (real images come later), a "seen" control to
// dismiss it, the title (linked to the catalogue when we have a SOPAC id), and the author.
// On hover it shows the lane's "why recommended" tooltip.
function buildCard({ uri, title, author, sopacId, coverUrl }, { onDismiss, tip, explanation }) {
    const card = document.createElement("article")
    card.className = "bp-card"
    if (explanation) {
        card.addEventListener("mouseenter", () => tip.schedule(explanation, card))
        card.addEventListener("mouseleave", () => tip.hide())
    }
    let cover
    if (coverUrl) {
        cover = document.createElement("img")
        cover.src = coverUrl
        cover.alt = ""           // decorative; the title sits right below
        cover.loading = "lazy"
    } else {
        cover = document.createElement("div")
        cover.setAttribute("aria-hidden", "true")
    }
    cover.className = "bp-card-cover"
    card.appendChild(cover)
    const dismiss = document.createElement("button")
    dismiss.type = "button"
    dismiss.className = "bp-card-dismiss"
    dismiss.textContent = "✕"
    dismiss.title = "Als gesehen markieren"
    dismiss.setAttribute("aria-label", "Als gesehen markieren")
    dismiss.addEventListener("click", () => onDismiss(uri))
    card.appendChild(dismiss)
    const titleEl = document.createElement(sopacId ? "a" : "div")
    titleEl.className = "bp-card-title"
    titleEl.textContent = title || sopacId || ""
    if (sopacId) {
        titleEl.href = sopacCatalogueUrl(sopacId)
        titleEl.target = "_blank"
        titleEl.rel = "noopener"
    }
    card.appendChild(titleEl)
    if (author) {
        const authorEl = document.createElement("div")
        authorEl.className = "bp-card-author"
        authorEl.textContent = author
        card.appendChild(authorEl)
    }
    return card
}

export async function installCockpit(root, { solrEndpoint, qdrantEndpoint, solidCallbackUrl, openBookPrompt, landing = false, mainHref } = {}) {
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
    // The profile (a cori-sdk primitive) and the recommendations list both live on
    // the landing page (landing embed only); null in the compact embed. The modal
    // keeps storage info, the "prüfen" button, and the link to the main page.
    const profileEl = root.querySelector("cori-profile")
    // The "add interest" picker sits directly below the profile (landing embed only).
    if (profileEl) installInterestPicker(profileEl, { onAdded: () => applyState() })
    const lanes = root.querySelector("#bp-lanes")
    // Book covers come from the inspira service's open /image/{isbn} route, same origin as
    // the recommend endpoint (VLB is 403-locked, Onleihe URLs need an underivable hash).
    // null if no qdrant endpoint is configured → cards fall back to the grey placeholder.
    const coverBase = qdrantEndpoint ? new URL("/image/", qdrantEndpoint).href : null
    // Shared "why recommended" tooltip — fixed-position so the lane's overflow can't clip
    // it; sits above the hovered card, flipping below near the top edge.
    const tipEl = document.createElement("div")
    tipEl.className = "bp-tip"
    tipEl.hidden = true
    root.appendChild(tipEl)
    let tipTimer = 0
    const tip = {
        // Hover briefly before showing, so sweeping across cards doesn't flash tooltips.
        schedule(html, anchor) {
            clearTimeout(tipTimer)
            tipTimer = setTimeout(() => tip.show(html, anchor), 600)
        },
        show(html, anchor) {
            if (!html) return
            tipEl.innerHTML = html
            tipEl.hidden = false
            const a = anchor.getBoundingClientRect()
            const t = tipEl.getBoundingClientRect()
            const left = Math.max(8, Math.min(a.left + a.width / 2 - t.width / 2, window.innerWidth - t.width - 8))
            const top = a.top - t.height - 8
            tipEl.style.left = `${left}px`
            tipEl.style.top = `${top < 8 ? a.bottom + 8 : top}px`
        },
        hide() { clearTimeout(tipTimer); tipEl.hidden = true },
    }
    const checkRecBtn = dialog.querySelector("#bp-check-recommendations-btn")
    const checkRecLink = root.querySelector("#bp-check-recommendations-link")
    const strategyToggles = dialog.querySelector("#bp-strategy-toggles")
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
    const solidInput = dialog.querySelector("#bp-solid-input")

    let isInSolidSetup = false
    // Tracks the last activation state applied to the landing's top blocks, so we
    // only collapse/expand them on the transition — not on every re-render.
    let lastLandingActivation = null

    function applyState() {
        const choice = getChoice()
        const isChosen = choice === "local" || choice === "session" || choice === "solid"

        openBtnLabel.textContent = isChosen ? "Bibliotheks-Pods Cockpit" : "Bibliotheks-Pods aktivieren"
        if (isChosen) {
            switchBtn.textContent = SWITCH_LABELS[choice]
            renderInfo()
            profileEl?.refresh()
            renderShowcase()
            renderStrategyToggles()
            decorateCards({ solrEndpoint, onBookClick: openBookPrompt })
        } else {
            badge.hidden = true
            if (lanes) lanes.hidden = true
            undecorateCards()
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

    function resetShowcase() {
        if (lanes) { lanes.replaceChildren(); lanes.hidden = true }
        badge.hidden = true
        if (recommendationsLink) recommendationsLink.hidden = true
    }

    // Renders the unread recommendations as the Schaufenster: one lane per strategy, each
    // a horizontal carousel of book cards. Seen (read) recommendations are hidden, so a
    // strategy whose cards are all seen drops out. The badge + modal link reflect the count.
    async function renderShowcase() {
        if (!isStorageReady()) return resetShowcase()
        try {
            const unread = (await listMessages()).filter(m => !m.read)
            if (unread.length === 0) return resetShowcase()

            badge.hidden = false
            badge.textContent = unread.length > 9 ? "9+" : String(unread.length)
            if (recommendationsLink) {
                recommendationsLink.hidden = false
                recommendationsLink.querySelector("a").textContent =
                    `${unread.length} Empfehlung${unread.length === 1 ? "" : "en"} ansehen`
            }

            // The lanes themselves only exist in the landing embed.
            if (!lanes) return

            const profileStore = await loadStore()
            const profileSubject = getProfileSubject()
            const strategyByLabel = new Map(getStrategies().map(s => [s.label, s]))

            // Group the unread recommendations into one lane per strategy. Message content
            // is "label\ntitle\nauthor\nisbn" (see checkRecommendations); refersTo is the
            // SOPAC id. Lanes with no unread items simply aren't built.
            const byStrategy = new Map()
            for (const m of unread) {
                const [label, title, author, isbn] = m.content.split("\n")
                if (!byStrategy.has(label)) byStrategy.set(label, [])
                const coverUrl = isbn && coverBase ? coverBase + encodeURIComponent(isbn) : null
                byStrategy.get(label).push({ uri: m.uri, title, author, sopacId: m.refersTo, coverUrl })
            }
            // One "why recommended" explanation per strategy, shared by its cards.
            const frag = document.createDocumentFragment()
            for (const [label, items] of byStrategy) {
                const strategy = strategyByLabel.get(label)
                const explanation = strategy ? await explainStrategy(strategy, profileStore, profileSubject) : null
                frag.appendChild(buildLane(label, items, { onDismiss: dismissCard, tip, explanation }))
            }
            lanes.replaceChildren(frag)
            lanes.hidden = false
        } catch (err) {
            console.error("[bib-pods] showcase render failed:", err)
            resetShowcase()
        }
    }

    // Mark a recommendation seen: it disappears from its lane, and the lane disappears too
    // once it has no unread cards left.
    async function dismissCard(uri) {
        try {
            await markMessageRead(uri)
            renderShowcase()
        } catch (err) {
            console.error("[bib-pods] markMessageRead failed:", err)
        }
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

    dialog.querySelector("#bp-choose-session-btn").addEventListener("click", () => {
        setChoice("session")
        applyState()
        warmupStorage().catch(err => console.error("Storage warmup failed:", err))
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

    // A profile mutation (add / clear) can affect more than the profile table —
    // clearing wipes the whole store — so re-run our broader state on change.
    profileEl?.addEventListener("cori-profile:change", () => applyState())

    // Triggered from the modal button and the Schaufenster link. Guards against
    // concurrent runs and shows a loading label on whichever triggers exist.
    let recCheckBusy = false
    async function checkRecommendations() {
        if (recCheckBusy) return
        if (!isStorageReady()) {
            // Only the solid backend can be not-ready: the choice is persisted
            // but the session couldn't be restored (pod offline or session expired).
            window.alert("Keine Verbindung zum Pod. Lade die Seite neu, sobald dein Pod wieder erreichbar ist.")
            return
        }
        recCheckBusy = true
        const triggers = [checkRecBtn, checkRecLink].filter(Boolean)
        const labels = triggers.map(t => t.textContent)
        triggers.forEach(t => { t.textContent = "Lädt …"; if ("disabled" in t) t.disabled = true })
        try {
            const profileStore = await loadStore()
            const { results, serverUnreachable } = await runRecommendations(profileStore, getProfileSubject(), { solrEndpoint, qdrantEndpoint })
            const items = results.flatMap(({ strategy, docs }) => docs.map(doc => ({ strategy, doc })))
            if (items.length === 0) {
                window.alert(serverUnreachable
                    ? "Der Empfehlungsdienst ist zurzeit nicht erreichbar. Bitte versuche es später erneut."
                    : "Keine Empfehlungen gefunden — vielleicht fehlen noch Profileinträge?")
            } else {
                // Identical recommendations (same strategy + book) aren't added twice —
                // whether already seen or still unread, they're skipped (see addMessageIfNew).
                for (const { strategy, doc } of items) {
                    const title = doc.title?.[0] ?? doc.id
                    const author = doc.author?.[0] ?? ""
                    const isbn = doc.isbn?.[0] ?? ""
                    await addMessageIfNew(`${strategy.label}\n${title}\n${author}\n${isbn}`, doc.id)
                }
            }
            applyState()
        } catch (err) {
            console.error("[bib-pods] recommendations failed:", err)
            window.alert("Empfehlungen konnten nicht geladen werden:\n" + storageErrorMessage(err))
        } finally {
            triggers.forEach((t, i) => { t.textContent = labels[i]; if ("disabled" in t) t.disabled = false })
            recCheckBusy = false
        }
    }
    checkRecBtn?.addEventListener("click", () => checkRecommendations())
    checkRecLink?.addEventListener("click", (e) => { e.preventDefault(); checkRecommendations() })

    // Recommendation strategy toggles (opt-out, persisted to the profile). The list is
    // built once from the vocab; checked states sync from the profile on each applyState,
    // and a change writes the full disabled-set (the unchecked strategies) back.
    const strategyCheckboxes = new Map()
    function buildStrategyToggles() {
        if (!strategyToggles || strategyToggles.childElementCount) return
        for (const strategy of getStrategies()) {
            const option = document.createElement("label")
            option.className = "bp-strategy-option"
            const checkbox = document.createElement("input")
            checkbox.type = "checkbox"
            checkbox.checked = true
            checkbox.addEventListener("change", persistStrategyToggles)
            option.append(checkbox, document.createTextNode(" " + strategy.label))
            strategyToggles.append(option)
            // Surface the strategy's rdfs:comment (e.g. the inspira note that this sends
            // the Merkliste to another City of Munich server) so the data flow is visible
            // right where the user enables it.
            if (strategy.comment) {
                const note = document.createElement("p")
                note.className = "bp-strategy-note"
                note.textContent = strategy.comment
                strategyToggles.append(note)
            }
            strategyCheckboxes.set(strategy.iri, checkbox)
        }
    }
    async function persistStrategyToggles() {
        const disabled = [...strategyCheckboxes].filter(([, cb]) => !cb.checked).map(([iri]) => iri)
        try {
            await replaceSubjectObjects(SETTINGS_SUBJECT, DISABLED_STRATEGY, disabled)
        } catch (err) {
            console.error("[bib-pods] saving strategy settings failed:", err)
            window.alert("Einstellung konnte nicht gespeichert werden:\n" + storageErrorMessage(err))
        }
    }
    async function renderStrategyToggles() {
        if (!strategyToggles || !isStorageReady()) return
        try {
            const store = await loadStore()
            const disabled = readDisabledStrategies(store)
            for (const [iri, cb] of strategyCheckboxes) cb.checked = !disabled.has(iri)
        } catch (err) {
            console.error("[bib-pods] strategy toggles render failed:", err)
        }
    }
    buildStrategyToggles()

    applyState()

    // Arriving via the modal's recommendations link (#bp-showcase): the landing
    // content mounts asynchronously, so the browser's on-load fragment jump can
    // miss it — scroll once it's in place. applyState has just revealed the block.
    if (landing && location.hash === "#bp-showcase") {
        root.querySelector("#bp-showcase")?.scrollIntoView()
    }

    return { applyState }
}
