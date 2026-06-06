import { isActivated } from "cori-sdk/storage/index.js"
import { fetchBook } from "./catalogue.js"

// aDIS/BMS SOPAC URLs use `sp=S<key>` where the leading `S` is a service-param
// type tag and the numeric portion is zero-padded to 8 digits. Solr stores the
// bare MARC 001 (e.g. "AK4250109"), so strip both.
const SOPAC_RE = /[?&]sp=S(AK)0*(\d+)/

// Onleihe mediaInfo URLs carry the divibib media id as the third dash-segment
// after the comma; the surrounding segments are navigation/view state and vary
// between pages, so only the media id is a stable key.
const ONLEIHE_RE = /onleihe\.de\/.+\/mediaInfo,\d+-\d+-(\d+)-/

// Event detail slugs end in "<title>-<uid>"; the trailing numeric uid is the
// stable identifier, the title part can change with edits.
const EVENT_RE = /\/veranstaltungen\/details\/[^/?#]*-(\d+)(?:[?#]|$)/

export function decorateCards({ solrEndpoint, onBookClick } = {}) {
    if (!isActivated()) return
    document.querySelectorAll('a[href*="sp=SAK"]').forEach(link => {
        const match = link.href.match(SOPAC_RE)
        if (match) decorateBookCard(link, match[1] + match[2], { solrEndpoint, onBookClick })
    })
    document.querySelectorAll('a[href*="onleihe.de"]').forEach(link => {
        const match = link.href.match(ONLEIHE_RE)
        if (match) decorateOnlineCard(link, match[1])
    })
    document.querySelectorAll('a[href*="/veranstaltungen/details/"]').forEach(link => {
        const match = link.href.match(EVENT_RE)
        if (match) decorateEventCard(link, match[1])
    })
    // Pseudo entities carry the already-clean id directly; used for dev/testing.
    document.querySelectorAll("[data-sopac-id]").forEach(el => {
        decorateBookCard(el, el.dataset.sopacId, { solrEndpoint, onBookClick })
    })
    document.querySelectorAll("[data-onleihe-id]").forEach(el => {
        decorateOnlineCard(el, el.dataset.onleiheId)
    })
    document.querySelectorAll("[data-event-id]").forEach(el => {
        decorateEventCard(el, el.dataset.eventId)
    })
}

export function undecorateCards() {
    document.querySelectorAll(".bp-decoration").forEach(el => el.remove())
    document.querySelectorAll("[data-bp-decorated]").forEach(el => delete el.dataset.bpDecorated)
}

function decorateBookCard(target, sopacId, { solrEndpoint, onBookClick }) {
    const btn = mountDecoration(target)
    if (!btn) return
    btn.addEventListener("click", async () => {
        let book = null
        try {
            book = await fetchBook(solrEndpoint, sopacId)
            console.log("[bib-pods] fetched book:", book)
        } catch (err) {
            console.error("[bib-pods] fetchBook failed:", err)
        }
        onBookClick?.(sopacId, book)
    })
}

// Onleihe media get the same button, but the click only logs the divibib media
// id — resolving it to its catalogue record in Solr is not wired up.
function decorateOnlineCard(target, mediaId) {
    const btn = mountDecoration(target)
    if (!btn) return
    btn.addEventListener("click", () => {
        console.log("[bib-pods] divibib media id:", mediaId)
    })
}

// Events get the same button, but the click only logs the event uid — no
// further wiring yet.
function decorateEventCard(target, eventId) {
    const btn = mountDecoration(target)
    if (!btn) return
    btn.addEventListener("click", () => {
        console.log("[bib-pods] event id:", eventId)
    })
}

// Mounts the "+" button on a card and returns it; null when the card is
// already decorated.
function mountDecoration(target) {
    if (target.dataset.bpDecorated) return null
    target.dataset.bpDecorated = "true"
    // The MSB theme's linkify makes whole cards clickable: bubble-phase
    // mousedown/mouseup listeners on the .linkify element send the browser to
    // the card's first link on mouseup. Carousel covers sit in a
    // .coverflow__wrap linkify card whose parent <li> slide is a mount point
    // outside it; event boxes are themselves the linkify <li> with no wrapper
    // to escape to, so their button mounts inside the card and relies on the
    // stopPropagation shield below. Pseudo entities (dev [data-*-id] elements)
    // host the button inline.
    const msbWrap = target.closest(".coverflow__wrap")
    const eventBox = target.closest(".event-box")
    const host = msbWrap?.parentElement ?? eventBox ?? target

    const btn = document.createElement("button")
    btn.type = "button"
    btn.className = "bp-decoration"
    btn.textContent = "+"
    btn.title = "Zu Favoriten hinzufügen"
    btn.style.cssText = msbWrap || eventBox
        ? "position: absolute; top: 0.4em; right: 0.4em; z-index: 10; width: 1.7em; height: 1.7em; padding: 0; font-size: 1.1em; font-weight: bold; line-height: 1; border: 1px solid currentColor; border-radius: 50%; background: rgba(255,255,255,0.92); cursor: pointer; box-shadow: 0 3px 10px rgba(0,0,0,0.4);"
        : "margin-left: 0.5em; cursor: pointer;"

    if ((msbWrap || eventBox) && getComputedStyle(host).position === "static") host.style.position = "relative"
    // Keep button interactions from bubbling into linkify's card listeners.
    for (const type of ["mousedown", "mouseup", "click"]) {
        btn.addEventListener(type, (e) => e.stopPropagation())
    }
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
    return btn
}
