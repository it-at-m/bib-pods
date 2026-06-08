// Shared results renderer. Usage: <solr-results placeholder="Run a query first."></solr-results>
// Renders into the light DOM so the .results-meta/.results-table/.pagination
// rules in styles.css apply. API:
//   el.render(data)    — data is a parsed Solr select response (JSON)
//   el.message(text)   — show a status line (loading, errors) instead
// Paging: prev/next buttons are part of the component. They derive start and
// rows from the response itself and emit a "page" CustomEvent with
// detail.start — the host re-fetches that offset and calls render() again.
class SolrResults extends HTMLElement {
    connectedCallback() {
        if (this.meta) return
        this.meta = document.createElement("p")
        this.meta.className = "results-meta"
        this.meta.textContent = this.getAttribute("placeholder") ?? ""
        this.table = document.createElement("table")
        this.table.className = "results-table"
        this.head = this.table.createTHead()
        this.body = this.table.createTBody()

        this.pagination = document.createElement("div")
        this.pagination.className = "pagination"
        this.pagination.hidden = true
        this.prevBtn = document.createElement("button")
        this.prevBtn.textContent = "← prev"
        this.nextBtn = document.createElement("button")
        this.nextBtn.textContent = "next →"
        this.pageInfo = document.createElement("span")
        this.prevBtn.addEventListener("click", () => this.page(-1))
        this.nextBtn.addEventListener("click", () => this.page(+1))
        this.pagination.append(this.prevBtn, this.pageInfo, this.nextBtn)

        this.append(this.meta, this.table, this.pagination)
    }

    page(direction) {
        this.dispatchEvent(new CustomEvent("page", {
            detail: { start: Math.max(0, this.start + direction * this.rows) },
        }))
    }

    message(text) {
        this.meta.textContent = text
        this.head.replaceChildren()
        this.body.replaceChildren()
        this.pagination.hidden = true
    }

    render(data) {
        const docs = data?.response?.docs ?? []
        const numFound = data?.response?.numFound ?? 0
        this.head.replaceChildren()
        this.body.replaceChildren()
        this.start = data?.response?.start ?? 0
        this.rows = parseInt(data?.responseHeader?.params?.rows, 10) || docs.length || 10

        if (!docs.length) {
            this.meta.textContent = `No documents in response (${numFound} results).`
            this.pagination.hidden = true
            return
        }
        const HIDDEN = new Set(["_version_", "_root_"])
        const keys = []
        for (const d of docs) for (const k of Object.keys(d)) if (!HIDDEN.has(k) && !keys.includes(k)) keys.push(k)
        this.meta.textContent = `${numFound} results · showing ${this.start + 1}–${this.start + docs.length}`
        const headRow = this.head.insertRow()
        for (const k of keys) {
            const th = document.createElement("th")
            th.textContent = k
            headRow.appendChild(th)
        }
        for (const d of docs) {
            const tr = this.body.insertRow()
            for (const k of keys) {
                const td = tr.insertCell()
                const full = formatCell(d[k])
                if (full.length > 200) {
                    td.textContent = full.slice(0, 200) + "…"
                    td.title = full
                } else {
                    td.textContent = full
                }
            }
        }
        this.pagination.hidden = numFound <= this.rows
        this.prevBtn.disabled = this.start === 0
        this.nextBtn.disabled = this.start + docs.length >= numFound
        this.pageInfo.textContent = `${this.start + 1}–${this.start + docs.length} of ${numFound} results`
    }
}

function formatCell(v) {
    if (v == null) return ""
    if (Array.isArray(v)) return v.join(", ")
    if (typeof v === "object") return JSON.stringify(v)
    return String(v)
}

customElements.define("solr-results", SolrResults)
