// Shared top navigation bar. Usage: <nav-bar current="query"></nav-bar>
// Renders into the light DOM so the .nav-bar rules in styles.css apply.
// Each page is a lowercase directory slug; the link label is the slug with a
// capitalised first letter, overridden via LABELS where that isn't enough.
// The "bib-pods" brand (= home link) stays visible; on narrow screens the rest
// of the links collapse behind the .nav-toggle hamburger.
const PAGES = ["vocabulary", "query", "plugin", "interactions", "recommendations", "api", "search"]
const LABELS = { api: "API" }

class NavBar extends HTMLElement {
    connectedCallback() {
        const current = this.getAttribute("current")
        const root = current === "home" ? "./" : "../"
        const links = PAGES.map((page) => {
            const active = page === current ? ' class="brand"' : ""
            const label = LABELS[page] ?? page[0].toUpperCase() + page.slice(1)
            return `<a${active} href="${root}${page}/">${label}</a>`
        })
        this.innerHTML = `
            <nav class="nav-bar">
                <a class="nav-brand" href="${root}">bib-pods</a>
                <button class="nav-toggle" type="button" aria-label="Toggle navigation" aria-expanded="false">☰</button>
                <div class="nav-links">
                    ${links.join("\n                    ")}
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
