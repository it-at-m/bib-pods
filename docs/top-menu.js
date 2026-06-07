// Shared top navigation bar. Usage: <top-menu current="query"></top-menu>
// Renders into the light DOM so the .top-menu rules in styles.css apply.
const PAGES = ["home", "vocabulary", "query", "plugin", "interactions", "recommendations", "api"]

class TopMenu extends HTMLElement {
    connectedCallback() {
        const current = this.getAttribute("current")
        const root = current === "home" ? "./" : "../"
        const links = PAGES.map((page) => {
            const href = page === "home" ? root : `${root}${page}/`
            const brand = page === current ? ' class="brand"' : ""
            return `<a${brand} href="${href}">${page}</a>`
        })
        this.innerHTML = `
            <nav class="top-menu">
                ${links.join("\n                ")}
                <span class="spacer"></span>
                <a href="https://github.com/it-at-m/bib-pods">GitHub</a>
            </nav>`
    }
}

customElements.define("top-menu", TopMenu)
