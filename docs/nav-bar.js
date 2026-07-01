// Shared top navigation bar. Usage: <nav-bar current="query"></nav-bar>
// Renders into the light DOM so the .nav-bar rules in styles.css apply.
// Each page is a lowercase directory slug; the link label is the slug with a
// capitalised first letter, overridden via LABELS where that isn't enough.
// The "bib-pods" brand (= home link) stays visible; on narrow screens the rest
// of the links collapse behind the .nav-toggle hamburger.
const PAGES = ["vocabulary", "query", "plugin", "recommendations", "more"]
const LABELS = { api: "API" }
// Pages that carry a dropdown of sub-pages. Neither has a landing page of its own —
// Plugin's is reached via its "Hauptseite" child — so the toggle is always a <button>,
// never a link: opening the menu should never also navigate.
const CHILDREN = {
    plugin: [
        { slug: "plugin", label: "Hauptseite" },
        { slug: "example", label: "Beispielseite" },
    ],
    more: [
        { slug: "interactions", label: "Interactions" },
        { slug: "api", label: "API" },
        { slug: "search", label: "Search" },
        { slug: "parking-lot", label: "Parking Lot" },
    ],
}

class NavBar extends HTMLElement {
    connectedCallback() {
        const current = this.getAttribute("current")
        const root = current === "home" ? "./" : "../"
        const label = (page) => LABELS[page] ?? page[0].toUpperCase() + page.slice(1)
        const link = (slug, text, active) => `<a${active ? ' class="brand"' : ""} href="${root}${slug}/">${text}</a>`

        const items = PAGES.map((page) => {
            const children = CHILDREN[page]
            if (!children) return link(page, label(page), page === current)
            // Highlighted whenever one of its children is current (a page with its own
            // landing route lists itself as a child too, e.g. Plugin's "Hauptseite").
            const active = children.some((c) => c.slug === current)
            const parent = `<button type="button" class="nav-dropdown-toggle${active ? " brand" : ""}">${label(page)}<span class="nav-caret">▾</span></button>`
            const menu = children.map((c) => link(c.slug, c.label, c.slug === current)).join("")
            return `<span class="nav-dropdown-parent">${parent}<span class="nav-dropdown">${menu}</span></span>`
        })

        this.innerHTML = `
            <nav class="nav-bar">
                <a class="nav-brand" href="${root}">bib-pods</a>
                <button class="nav-toggle" type="button" aria-label="Toggle navigation" aria-expanded="false">☰</button>
                <div class="nav-links">
                    ${items.join("\n                    ")}
                    <span class="spacer"></span>
                    <a href="https://github.com/it-at-m/bib-pods">Code</a>
                </div>
            </nav>`
        const nav = this.querySelector(".nav-bar")
        const toggle = this.querySelector(".nav-toggle")
        toggle.addEventListener("click", () => {
            const open = nav.classList.toggle("open")
            toggle.setAttribute("aria-expanded", String(open))
        })
    }
}

customElements.define("nav-bar", NavBar)
