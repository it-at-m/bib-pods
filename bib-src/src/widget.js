import { getChoice, setChoice, clearChoice, isActivated, isStorageReady, warmupStorage, loadStore, listMessages, markMessageRead, addMessageIfNew, replaceSubjectObjects } from "cori-sdk/storage/index.js"
import { initSession, login, logout, isLoggedIn, currentPageUrl } from "cori-sdk/storage/solid.js"
import { getProfileSubject, storageErrorMessage } from "cori-sdk/utils.js"
import "cori-sdk/ui/profile.js" // registers the <cori-profile> primitive
import { decorateCards, undecorateCards } from "./decorate-cards.js"
import { runRecommendations, getStrategies, readDisabledStrategies, explainStrategy, escapeHtml, DISABLED_STRATEGY, SETTINGS_SUBJECT } from "./recommendations.js"
import { sopacCatalogueUrl, fetchBook } from "./catalogue.js"
import { cleanAuthorName } from "./book-prompt.js"
import { BP } from "./vocab.js"
import styleCss from "./ui/style.css?inline"
import entryHtml from "./ui/entry.html?raw"
import landingHtml from "./ui/landing.html?raw"
import modalHtml from "./ui/modal.html?raw"

// Concise "where your data lives" line for the main page's Konto block. The chooser is
// the login; once a location is picked this just states it — switching means logging
// out and choosing again, so there's no separate "switch location" control.
const STORAGE_LABELS = {
    local: "Gespeichert: lokal im Browser",
    session: "Gespeichert: nur in dieser Sitzung",
    solid: "Gespeichert: in deinem Solid Pod",
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

// Host's .button pill styling is scoped to .maincontents. On pages where TYPO3 places
// #bp-root outside that scope (e.g. the homepage header), reparent it so the entry button
// + modal sit inside .maincontents and inherit the host's styling. Already inside → no-op.
function reparentIntoMainContents(root) {
    const mainContents = document.querySelector(".maincontents")
    if (mainContents && !root.closest(".maincontents")) mainContents.prepend(root)
}

function warmup() {
    warmupStorage().catch(err => console.error("Storage warmup failed:", err))
}

// Unread recommendation messages, or null when storage can't be read at all (e.g. a Solid
// session that hasn't been restored) — lets callers tell "none" apart from "unknown".
async function readUnread() {
    if (!isStorageReady()) return null
    return (await listMessages()).filter(m => !m.read)
}

// The single reverse action behind every "Abmelden": end any Solid session and forget the
// stored choice. Callers reset their own view state and re-render afterwards.
async function endSession() {
    if (getChoice() === "solid") await logout()
    clearChoice()
}

// Inline SVG icons so the carousel needs no icon font: the city library's coverflow uses
// Font Awesome for its arrows/no-cover glyph, which is loaded on TYPO3 but absent on docs.
const CHEVRON_LEFT = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M15.5 4.5 8 12l7.5 7.5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
const CHEVRON_RIGHT = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M8.5 4.5 16 12l-7.5 7.5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
// An open book, not a "broken image" glyph: this state means "no cover available", not
// "something failed" (a 404 from inspira's partial-coverage image endpoint is expected,
// not an error — see the img error handler in buildCard below).
const NO_COVER = `<svg viewBox="0 0 64 64" width="72" height="72" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M32 20 C 27 15 17 13 10 15 V46 C17 44 27 46 32 51 C37 46 47 44 54 46 V15 C47 13 37 15 32 20 Z"/><line x1="32" y1="20" x2="32" y2="51"/></svg>`

function buildNoCoverPlaceholder() {
    const placeholder = document.createElement("div")
    placeholder.className = "bp-cf-noimage"
    placeholder.setAttribute("aria-hidden", "true")
    placeholder.innerHTML = NO_COVER
    return placeholder
}

// A lane = an optional heading + the city library's coverflow carousel of book cards.
// The DOM here is inert; initCarousel() wires the arrows and page dots once the lane
// is in the document and its widths are measurable. ctx carries { onDismiss, tip,
// explanation } shared by every card in the lane. buildSlide makes the full strategy
// card by default; the profile's Merkliste passes buildMiniCard for cover-only tiles.
function buildLane(label, items, ctx, buildSlide = buildCard) {
    const lane = document.createElement("div")
    lane.className = "bp-cf"
    if (label) {
        const heading = document.createElement("h4")
        heading.className = "bp-cf-title"
        heading.textContent = label
        lane.appendChild(heading)
    }

    const viewport = document.createElement("div")
    viewport.className = "bp-cf-viewport"
    const prev = document.createElement("button")
    prev.type = "button"
    prev.className = "bp-cf-nav bp-cf-prev"
    prev.setAttribute("aria-label", "Vorherige")
    prev.innerHTML = CHEVRON_LEFT
    const track = document.createElement("ul")
    track.className = "bp-cf-track"
    for (const item of items) track.appendChild(buildSlide(item, ctx))
    const next = document.createElement("button")
    next.type = "button"
    next.className = "bp-cf-nav bp-cf-next"
    next.setAttribute("aria-label", "Nächste")
    next.innerHTML = CHEVRON_RIGHT
    viewport.append(prev, track, next)
    lane.appendChild(viewport)

    const dots = document.createElement("div")
    dots.className = "bp-cf-dots"
    lane.appendChild(dots)
    return lane
}

// One coverflow slide: the cover on top, then the title (linked to the catalogue when we
// have a SOPAC id) and author below — the library's column-reverse card. Adds our two
// affordances the library card lacks: a "seen" dismiss control over the cover, and the
// lane's "why recommended" tooltip on hover.
function buildCard({ uri, title, author, sopacId, coverUrl }, { onDismiss, tip, explanation }) {
    const slide = document.createElement("li")
    slide.className = "bp-cf-slide"
    if (explanation) {
        slide.addEventListener("mouseenter", () => tip.schedule(explanation, slide))
        slide.addEventListener("mouseleave", () => tip.hide())
    }
    const wrap = document.createElement("div")
    wrap.className = "bp-cf-wrap"

    const desc = document.createElement("div")
    desc.className = "bp-cf-desc"
    const heading = document.createElement("h3")
    const titleEl = document.createElement(sopacId ? "a" : "span")
    titleEl.textContent = title || sopacId || ""
    if (sopacId) {
        titleEl.href = sopacCatalogueUrl(sopacId)
        titleEl.target = "_blank"
        titleEl.rel = "noopener"
    }
    heading.appendChild(titleEl)
    desc.appendChild(heading)
    if (author) {
        const authorEl = document.createElement("div")
        authorEl.className = "bp-cf-author"
        authorEl.textContent = author
        desc.appendChild(authorEl)
    }

    const image = document.createElement("div")
    image.className = "bp-cf-image"
    if (coverUrl) {
        const img = document.createElement("img")
        img.src = coverUrl
        img.alt = ""             // decorative; the title sits right below
        img.loading = "lazy"
        // coverUrl only reflects "this book has an ISBN", not "inspira has a cover image
        // for it" (coverage is partial — see cover_images note) — a 404 there must fall
        // back to the same placeholder as "no ISBN at all", not fail silently as a blank box.
        // replaceWith (not image.replaceChildren) swaps just the failed <img> in place — by
        // the time "error" fires, the dismiss button is already a sibling in .bp-cf-image,
        // and replaceChildren would have wiped it out along with the image.
        img.addEventListener("error", () => img.replaceWith(buildNoCoverPlaceholder()), { once: true })
        image.appendChild(img)
    } else {
        image.appendChild(buildNoCoverPlaceholder())
    }
    const dismiss = document.createElement("button")
    dismiss.type = "button"
    dismiss.className = "bp-cf-dismiss bp-round-btn"
    dismiss.textContent = "✕"
    dismiss.title = "Als gesehen markieren"
    dismiss.setAttribute("aria-label", "Als gesehen markieren")
    dismiss.addEventListener("click", () => onDismiss(uri))
    image.appendChild(dismiss)

    // DOM order desc → image; the wrap's column-reverse renders the cover on top, text below.
    wrap.append(desc, image)
    slide.appendChild(wrap)
    return slide
}

// A compact slide for the profile's Merkliste: just the cover (or the no-cover
// placeholder) linking to the catalogue entry. Title + author live in the shared
// tooltip — shown instantly (no schedule() delay), since these tiles carry no
// visible text at all.
function buildMiniCard({ title, author, sopacId, coverUrl }, { tip }) {
    const slide = document.createElement("li")
    slide.className = "bp-cf-slide"
    const tipHtml = `<strong>${escapeHtml(title)}</strong>${author ? "<br>" + escapeHtml(author) : ""}`
    slide.addEventListener("mouseenter", () => tip.show(tipHtml, slide))
    slide.addEventListener("mouseleave", () => tip.hide())
    const link = document.createElement("a")
    link.className = "bp-cf-image"
    link.href = sopacCatalogueUrl(sopacId)
    link.target = "_blank"
    link.rel = "noopener"
    link.setAttribute("aria-label", author ? `${title} – ${author}` : title)
    if (coverUrl) {
        const img = document.createElement("img")
        img.src = coverUrl
        img.alt = ""
        img.loading = "lazy"
        // same expected-404 fallback as buildCard: partial cover coverage, not an error
        img.addEventListener("error", () => img.replaceWith(buildNoCoverPlaceholder()), { once: true })
        link.appendChild(img)
    } else {
        link.appendChild(buildNoCoverPlaceholder())
    }
    slide.appendChild(link)
    return slide
}

// Turn a built lane into a working carousel: the arrows page by one viewport width, a dot
// per page tracks and drives the scroll position, and both disappear when every slide
// already fits. Native scroll-snap does the sliding, so there's no library to load. Returns
// a cleanup that disconnects the resize observer — called before each re-render.
function initCarousel(lane) {
    const track = lane.querySelector(".bp-cf-track")
    const prev = lane.querySelector(".bp-cf-prev")
    const next = lane.querySelector(".bp-cf-next")
    const dots = lane.querySelector(".bp-cf-dots")

    const pageWidth = () => track.clientWidth || 1
    // Round up so a trailing partial page still gets a dot; the small tolerance keeps a
    // track that really fits (sub-pixel overflow) at a single page.
    const pageCount = () => Math.max(1, Math.ceil(track.scrollWidth / pageWidth() - 0.02))
    const maxScroll = () => Math.max(0, track.scrollWidth - track.clientWidth)
    // Item counts rarely divide evenly by slides-per-page, so the last page is usually
    // partial and its native scroll distance is less than a full pageWidth — dividing
    // scrollLeft by pageWidth would then round the true rightmost scroll position back down
    // to an earlier page (arrows/dots never reaching "last"). Scaling scrollLeft's fraction
    // of the *actual* scrollable range across the page buckets instead always lands on the
    // last page at the true native max, regardless of how full that last page is.
    const currentPage = () => {
        const max = maxScroll()
        if (max <= 0) return 0
        return Math.min(pageCount() - 1, Math.round((track.scrollLeft / max) * (pageCount() - 1)))
    }

    function update() {
        const page = currentPage()
        const pages = pageCount()
        for (let i = 0; i < dots.children.length; i++) dots.children[i].classList.toggle("is-active", i === page)
        prev.disabled = page <= 0
        next.disabled = page >= pages - 1
    }

    // Rebuild the dots when the page count changes (container resize shifts slides-per-view).
    function layout() {
        const pages = pageCount()
        lane.classList.toggle("bp-cf-static", track.scrollWidth - track.clientWidth <= 1)
        if (dots.childElementCount !== pages) {
            dots.replaceChildren()
            for (let i = 0; i < pages; i++) {
                const dot = document.createElement("button")
                dot.type = "button"
                dot.className = "bp-cf-dot"
                dot.setAttribute("aria-label", `Seite ${i + 1}`)
                dot.addEventListener("click", () => track.scrollTo({ left: i * pageWidth(), behavior: "smooth" }))
                dots.appendChild(dot)
            }
        }
        update()
    }

    prev.addEventListener("click", () => track.scrollBy({ left: -pageWidth(), behavior: "smooth" }))
    next.addEventListener("click", () => track.scrollBy({ left: pageWidth(), behavior: "smooth" }))
    track.addEventListener("scroll", update, { passive: true })
    const ro = new ResizeObserver(layout)
    ro.observe(track)
    layout()
    return () => ro.disconnect()
}

// Shared "why recommended" tooltip for lane cards — fixed-position so the lane's overflow
// can't clip it; sits above the hovered card, flipping below near the top edge.
function createTip(root) {
    const el = document.createElement("div")
    el.className = "bp-tip"
    el.hidden = true
    root.appendChild(el)
    let timer = 0
    const tip = {
        // Hover briefly before showing, so sweeping across cards doesn't flash tooltips.
        schedule(html, anchor) {
            clearTimeout(timer)
            timer = setTimeout(() => tip.show(html, anchor), 600)
        },
        show(html, anchor) {
            if (!html) return
            el.innerHTML = html
            el.hidden = false
            const a = anchor.getBoundingClientRect()
            const t = el.getBoundingClientRect()
            const left = Math.max(8, Math.min(a.left + a.width / 2 - t.width / 2, window.innerWidth - t.width - 8))
            const top = a.top - t.height - 8
            el.style.left = `${left}px`
            el.style.top = `${top < 8 ? a.bottom + 8 : top}px`
        },
        hide() { clearTimeout(timer); el.hidden = true },
    }
    return tip
}

// Two embeds share this entry point. The main (bib-pods) page inlines the whole control
// centre (mountLanding); every other library page gets just a button + modal (mountCompact).
// Card decoration and the notification count are common; each embed owns its own DOM.
export async function installWidget(root, { solrEndpoint, qdrantEndpoint, solidCallbackUrl, openBookPrompt, landing = false, mainHref } = {}) {
    injectStyles()
    reparentIntoMainContents(root)

    // Bootstrap the session before the first render so isStorageReady()/isActivated() are
    // truthful (a persisted Solid login is restored, or its absence is settled).
    const redirectUri = solidCallbackUrl ?? currentPageUrl()
    await initSession({ redirectUri })
    if (isLoggedIn() && getChoice() !== "solid") setChoice("solid")
    if (isStorageReady()) warmup()

    const ctx = { root, solrEndpoint, qdrantEndpoint, solidCallbackUrl, openBookPrompt, mainHref, redirectUri }
    return landing ? mountLanding(ctx) : mountCompact(ctx)
}

// Compact embed (every non-main library page): an entry button opening a modal with the
// session control, the unread-recommendations count, and links back to the main page. It
// also decorates the host page's catalogue cards. Only reached when already activated
// (the host gates the mount), so a logged-out state here means the user just hit Abmelden.
function mountCompact({ root, solrEndpoint, openBookPrompt, mainHref }) {
    // insertAdjacentHTML appends, so the book-prompt dialog installed in main.js survives.
    root.insertAdjacentHTML("beforeend", entryHtml)
    // Native <dialog> via showModal() renders in the browser's top layer, so parent
    // overflow/z-index can't clip it. Attached inside `root` (not <body>) so on TYPO3 it
    // inherits the brand's button/link styling from within .maincontents.
    const modalHost = document.createElement("div")
    modalHost.innerHTML = modalHtml
    const dialog = modalHost.firstElementChild
    root.appendChild(dialog)

    const openBtn = root.querySelector(".bp-open-btn")
    const badge = root.querySelector(".bp-badge")
    const closeBtn = dialog.querySelector(".bp-modal-close")
    const logoutBtn = dialog.querySelector(".bp-logout")
    const loginHint = dialog.querySelector("#bp-login-hint")
    const noNotifications = dialog.querySelector("#bp-no-notifications")
    const recLink = dialog.querySelector("#bp-recommendations-link")
    const loginLink = dialog.querySelector("#bp-login-link")
    const homeLink = dialog.querySelector("#bp-home-link")

    // All three links target the main page (present on every compact embed). The login
    // hint points at the Anmelden CTA — the visible first step, not the hidden chooser.
    recLink.href = (mainHref ?? "") + "#bp-showcase"
    loginLink.href = (mainHref ?? "") + "#bp-login-cta"
    homeLink.href = mainHref ?? "#"
    // Close the dialog first, then let the browser follow the href.
    for (const a of [recLink, loginLink, homeLink]) a.addEventListener("click", () => dialog.close())

    // Unread count → button badge + modal line. null means storage can't be read (Solid
    // session gone), so we neither show a count nor claim an empty inbox.
    async function renderCount() {
        const unread = await readUnread()
        const n = unread?.length ?? 0
        badge.hidden = n === 0
        recLink.hidden = n === 0
        if (n > 0) {
            badge.textContent = n > 9 ? "9+" : String(n)
            recLink.textContent = `${n} neue Empfehlung${n === 1 ? "" : "en"}`
        }
        noNotifications.hidden = !(unread && n === 0)
    }

    function applyState() {
        const active = isActivated()
        // A single "Abmelden" whenever a location is chosen; the login hint (→ main page)
        // appears when nothing is chosen or a Solid session has lapsed.
        logoutBtn.hidden = !active
        loginHint.hidden = active && isStorageReady()
        renderCount()
        if (active) decorateCards({ solrEndpoint, onBookClick: openBookPrompt })
        else undecorateCards()
    }

    openBtn.addEventListener("click", () => { applyState(); dialog.showModal() })
    closeBtn.addEventListener("click", () => dialog.close())
    dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close() })
    logoutBtn.addEventListener("click", async () => { await endSession(); applyState() })

    applyState()
    return { applyState }
}

// Landing embed (the bib-pods main page): the whole control centre, inlined. Logged out it
// walks a small state machine — Anmelden CTA → storage chooser → (optional) Solid setup;
// logged in it shows the Konto block, the Schaufenster (recommendation lanes + "prüfen"),
// and the profile. It also decorates any catalogue cards on the page.
function mountLanding({ root, solrEndpoint, qdrantEndpoint, solidCallbackUrl, openBookPrompt, redirectUri }) {
    root.insertAdjacentHTML("beforeend", landingHtml)

    const landingRoot = root.querySelector(".bp-landing")
    const loginCta = root.querySelector("#bp-login-cta")
    const anmeldenBtn = root.querySelector("#bp-anmelden-btn")
    const chooser = root.querySelector("#bp-chooser")
    const solidSetup = root.querySelector("#bp-solid-setup")
    const solidInput = root.querySelector("#bp-solid-input")
    const storageLabel = root.querySelector("#bp-storage-label")
    const logoutBtn = root.querySelector(".bp-logout")
    const activatedBlocks = root.querySelectorAll(".bp-when-activated")
    const profileEl = root.querySelector("cori-profile")
    // The Merkliste renders as a compact coverflow instead of chips: each SOPAC id
    // resolves to its Solr doc once per page view (the map caches the promise; a
    // failed lookup degrades that book to the no-cover placeholder with its raw id).
    const savedBookDocs = new Map()
    function fetchSavedBook(id) {
        if (!savedBookDocs.has(id)) savedBookDocs.set(id, fetchBook(solrEndpoint, id).catch(() => null))
        return savedBookDocs.get(id)
    }
    let savedBooksCleanup = null
    profileEl.renderFieldValues = async (predicate, objects) => {
        if (predicate !== BP + "savedBook") return null
        const items = await Promise.all(objects.map(async ({ value }) => {
            const doc = await fetchSavedBook(value)
            const isbn = doc?.isbn?.[0]
            return {
                // titles occasionally carry "| marketing subtitle" appendices — the tooltip shows the main title
                title: doc?.title?.[0]?.split(" | ")[0] ?? value,
                author: doc?.author?.[0] ? cleanAuthorName(doc.author[0]) : "",
                sopacId: value,
                coverUrl: isbn && coverBase ? coverBase + encodeURIComponent(isbn) : null,
            }
        }))
        const lane = buildLane(null, items, { tip }, buildMiniCard)
        lane.classList.add("bp-cf-mini")
        // carousel wiring needs measured widths: wait until <cori-profile> has inserted
        // the lane (a superseded refresh never inserts it — then there's nothing to wire)
        requestAnimationFrame(() => {
            if (!lane.isConnected) return
            savedBooksCleanup?.()
            savedBooksCleanup = initCarousel(lane)
        })
        return lane
    }
    const lanes = root.querySelector("#bp-lanes")
    const checkRecLink = root.querySelector("#bp-check-recommendations-link")
    const strategyToggles = root.querySelector("#bp-strategy-toggles")

    // Book covers come from the inspira service's open /image/{isbn} route (same origin as
    // the recommend endpoint; VLB is 403-locked, Onleihe URLs need an underivable hash).
    // null if no qdrant endpoint → cards fall back to the grey placeholder.
    const coverBase = qdrantEndpoint ? new URL("/image/", qdrantEndpoint).href : null
    const tip = createTip(root)

    // Logged-out flow as a small state machine; each step reveals exactly one block.
    let loginStep = "cta"   // 'cta' | 'chooser' | 'solid'
    // Tracks the last activation state so the top blocks collapse/expand only on the
    // transition — not on every re-render (a manually expanded block then survives).
    let lastActivation = null

    function applyState() {
        const active = isActivated()

        // Logged-out flow (one block per step) vs the activated control centre.
        loginCta.hidden = active || loginStep !== "cta"
        chooser.hidden = active || loginStep !== "chooser"
        solidSetup.hidden = active || loginStep !== "solid"
        for (const block of activatedBlocks) block.hidden = !active

        if (active) {
            renderStorageLabel()
            profileEl.refresh()
            renderStrategyToggles()
            renderLanes()
            decorateCards({ solrEndpoint, onBookClick: openBookPrompt })
        } else {
            lanes.hidden = true
            undecorateCards()
        }

        landingRoot.classList.toggle("is-activated", active)
        if (active !== lastActivation) {
            for (const d of landingRoot.querySelectorAll(".bp-collapsible")) d.open = !active
            lastActivation = active
        }
    }

    // The Konto block's one-line "where your data lives".
    function renderStorageLabel() {
        const choice = getChoice()
        storageLabel.textContent = choice === "solid" && !isStorageReady()
            ? "Solid Pod – Sitzung unterbrochen"
            : STORAGE_LABELS[choice] ?? ""
    }

    // The Schaufenster: one carousel per strategy of unread recommendations (seen ones drop
    // out, so a fully-seen strategy disappears). Empty / unreadable → hide the lanes.
    // Each render replaces the lanes wholesale, so first tear down the previous carousels'
    // resize observers to avoid leaking them across renders.
    let carouselCleanups = []
    async function renderLanes() {
        for (const cleanup of carouselCleanups) cleanup()
        carouselCleanups = []
        const unread = await readUnread()
        if (!unread || unread.length === 0) { lanes.replaceChildren(); lanes.hidden = true; return }
        try {
            const profileStore = await loadStore()
            const profileSubject = getProfileSubject()
            const strategyByLabel = new Map(getStrategies().map(s => [s.label, s]))
            // Message content is "label\ntitle\nauthor\nisbn" (see checkRecommendations);
            // refersTo is the SOPAC id. Group the unread into one lane per strategy.
            const byStrategy = new Map()
            for (const m of unread) {
                const [label, title, author, isbn] = m.content.split("\n")
                if (!byStrategy.has(label)) byStrategy.set(label, [])
                const coverUrl = isbn && coverBase ? coverBase + encodeURIComponent(isbn) : null
                byStrategy.get(label).push({ uri: m.uri, title, author, sopacId: m.refersTo, coverUrl })
            }
            const frag = document.createDocumentFragment()
            for (const [label, items] of byStrategy) {
                const strategy = strategyByLabel.get(label)
                const explanation = strategy ? await explainStrategy(strategy, profileStore, profileSubject) : null
                frag.appendChild(buildLane(label, items, { onDismiss: dismissCard, tip, explanation }))
            }
            lanes.replaceChildren(frag)
            lanes.hidden = false
            // Now that the lanes are in the document, wire each into a working carousel
            // (dot counts need measured widths, so this must run post-insertion).
            for (const lane of lanes.querySelectorAll(".bp-cf")) carouselCleanups.push(initCarousel(lane))
        } catch (err) {
            console.error("[bib-pods] showcase render failed:", err)
            lanes.replaceChildren()
            lanes.hidden = true
        }
    }

    // Mark a recommendation seen: it leaves its lane, and the lane goes once it's empty.
    async function dismissCard(uri) {
        try { await markMessageRead(uri); renderLanes() }
        catch (err) { console.error("[bib-pods] markMessageRead failed:", err) }
    }

    // "Empfehlungen prüfen": generate recommendations here and store the new ones as
    // messages (surfaced as notifications everywhere). Guards against concurrent runs.
    let recCheckBusy = false
    async function checkRecommendations() {
        if (recCheckBusy) return
        if (!isStorageReady()) {
            // Only Solid can be not-ready: the choice is persisted but the session wasn't
            // restored (pod offline or expired).
            window.alert("Keine Verbindung zum Pod. Lade die Seite neu, sobald dein Pod wieder erreichbar ist.")
            return
        }
        recCheckBusy = true
        const label = checkRecLink.textContent
        checkRecLink.textContent = "Lädt …"
        try {
            const profileStore = await loadStore()
            const { results, serverUnreachable } = await runRecommendations(profileStore, getProfileSubject(), { solrEndpoint, qdrantEndpoint })
            const items = results.flatMap(({ strategy, docs }) => docs.map(doc => ({ strategy, doc })))
            if (items.length === 0) {
                window.alert(serverUnreachable
                    ? "Der Empfehlungsdienst ist zurzeit nicht erreichbar. Bitte versuche es später erneut."
                    : "Keine Empfehlungen gefunden — vielleicht fehlen noch Profileinträge?")
            } else {
                // Identical recommendations (same strategy + book) are skipped, whether
                // already seen or still unread (see addMessageIfNew).
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
            checkRecLink.textContent = label
            recCheckBusy = false
        }
    }

    // Strategy toggles (opt-out, persisted to the profile). Built once from the vocab here;
    // checked states then sync from the profile on each render, a change writes the set.
    const strategyCheckboxes = new Map()
    for (const strategy of getStrategies()) {
        const option = document.createElement("label")
        option.className = "bp-strategy-option"
        const checkbox = document.createElement("input")
        checkbox.type = "checkbox"
        checkbox.checked = true
        checkbox.addEventListener("change", persistStrategyToggles)
        option.append(checkbox, document.createTextNode(" " + strategy.label))
        strategyToggles.append(option)
        // Surface the strategy's rdfs:comment (e.g. the inspira note that this sends the
        // Merkliste to another City of Munich server) right where the user enables it.
        if (strategy.comment) {
            const note = document.createElement("p")
            note.className = "bp-strategy-note"
            note.textContent = strategy.comment
            strategyToggles.append(note)
        }
        strategyCheckboxes.set(strategy.iri, checkbox)
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
        if (!isStorageReady()) return
        try {
            const store = await loadStore()
            const disabled = readDisabledStrategies(store)
            for (const [iri, cb] of strategyCheckboxes) cb.checked = !disabled.has(iri)
        } catch (err) {
            console.error("[bib-pods] strategy toggles render failed:", err)
        }
    }

    // --- listeners: the logged-out state machine + the activated actions ---
    anmeldenBtn.addEventListener("click", () => { loginStep = "chooser"; applyState() })
    root.querySelector("#bp-choose-local-btn").addEventListener("click", () => { setChoice("local"); applyState(); warmup() })
    root.querySelector("#bp-choose-session-btn").addEventListener("click", () => { setChoice("session"); applyState(); warmup() })
    root.querySelector("#bp-choose-solid-btn").addEventListener("click", () => { loginStep = "solid"; applyState() })
    root.querySelector("#bp-solid-cancel-btn").addEventListener("click", () => { loginStep = "chooser"; applyState() })
    root.querySelector("#bp-solid-connect-btn").addEventListener("click", async () => {
        const issuer = solidInput.value.trim()
        if (!issuer) return
        try {
            await login(issuer, { redirectUri, returnUrl: solidCallbackUrl ? window.location.href : undefined })
        } catch (err) {
            console.error("[bib-pods] Solid login failed:", err)
            window.alert(`Verbindung zu ${issuer} fehlgeschlagen:\n${err?.message ?? err}`)
        }
    })
    // "Abmelden" → back to the Anmelden CTA. Deactivating un-mounts the widget on non-main
    // pages on the next load. To switch storage location, log out and choose again.
    logoutBtn.addEventListener("click", async () => { await endSession(); loginStep = "cta"; applyState() })
    // A profile mutation (add / clear) can wipe the whole store, so re-run the broad state.
    profileEl.addEventListener("cori-profile:change", () => applyState())
    checkRecLink.addEventListener("click", (e) => { e.preventDefault(); checkRecommendations() })

    applyState()

    // Arriving via a modal's #bp-showcase link: the landing content mounts async, so the
    // browser's on-load fragment jump can miss it — scroll once it's in place.
    if (location.hash === "#bp-showcase") root.querySelector("#bp-showcase")?.scrollIntoView()

    return { applyState }
}
