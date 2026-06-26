// Shared top navigation bar. Usage: <nav-bar current="query"></nav-bar>
// Renders into the light DOM so the .nav-bar rules in styles.css apply.
// Each page is a lowercase directory slug; the link label is the slug with a
// capitalised first letter, overridden via LABELS where that isn't enough.
const PAGES = ["home", "vocabulary", "query", "plugin", "interactions", "recommendations", "api", "search"]
const LABELS = { api: "API" }

class NavBar extends HTMLElement {
    connectedCallback() {
        const current = this.getAttribute("current")
        const root = current === "home" ? "./" : "../"
        const links = PAGES.map((page) => {
            const href = page === "home" ? root : `${root}${page}/`
            const brand = page === current ? ' class="brand"' : ""
            const label = LABELS[page] ?? page[0].toUpperCase() + page.slice(1)
            return `<a${brand} href="${href}">${label}</a>`
        })
        this.innerHTML = `
            <nav class="nav-bar">
                ${links.join("\n                ")}
                <span class="spacer"></span>
                <a href="https://github.com/it-at-m/bib-pods">Code</a>
            </nav>`
    }
}

customElements.define("nav-bar", NavBar)
