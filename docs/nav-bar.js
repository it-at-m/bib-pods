// Shared top navigation bar. Usage: <nav-bar current="query"></nav-bar>
// Renders into the light DOM so the .nav-bar rules in styles.css apply.
// Each page is a lowercase directory slug; the link label is the slug with a
// capitalised first letter, overridden via LABELS where that isn't enough.
// The "bib-pods" brand (= home link) stays visible; on narrow screens the rest
// of the links collapse behind the .nav-toggle hamburger.
const PAGES = ["vocabulary", "query", "plugin", "interactions", "recommendations", "api", "search"]
const LABELS = { api: "API" }
// Pages that carry a dropdown of sub-pages. The parent stays a direct link (Plugin →
// its main page); the dropdown lists only the *other* sub-pages, so there's no
// redundant second route to the parent's own page.
const CHILDREN = { plugin: [{ slug: "example", label: "Beispielseite" }] }

class NavBar extends HTMLElement {
    connectedCallback() {
        const current = this.getAttribute("current")
        const root = current === "home" ? "./" : "../"
        const label = (page) => LABELS[page] ?? page[0].toUpperCase() + page.slice(1)
        const link = (slug, text, active) => `<a${active ? ' class="brand"' : ""} href="${root}${slug}/">${text}</a>`

        const items = PAGES.map((page) => {
            const children = CHILDREN[page]
            if (!children) return link(page, label(page), page === current)
            // Parent highlighted when it (or one of its children) is the current page.
            const childActive = children.some((c) => c.slug === current)
            const parent = `<a${page === current || childActive ? ' class="brand"' : ""} href="${root}${page}/">${label(page)}<span class="nav-caret">▾</span></a>`
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
