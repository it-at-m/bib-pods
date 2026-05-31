import { loadStore, loadAsTurtle, addTriple, clearStorage, isStorageReady, getStorageEntryName } from "../storage/index.js"
import { getProfileSubject, getLabel, getOne, contractTerm, expandTerm, RDFS_LABEL, RDF_TYPE, CORI } from "../utils.js"
import { validateProfile } from "../shacl.js"
import { datasetToTurtle } from "@foerderfunke/sem-ops-utils/core"

const PROFILE_TYPE = CORI + "Profile"

// <cori-profile> — a light-DOM UI primitive. Renders the user's profile triples as
// a table plus profile-actions, wired straight to cori-sdk storage.
// No shadow root, no bundled styles.
// Call refresh() to re-render after the profile changes elsewhere.
// Bubbling event:
//   cori-profile:change --> the profile was mutated (entry added or cleared)

// Prism is loaded from a CDN the first time the Turtle inspector opens; the promise
// is cached module-wide so concurrent <cori-profile> instances share one load.
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

function buildTurtleDialog(onValidate) {
    const d = document.createElement("dialog")
    d.className = "cori-turtle-view"
    d.innerHTML = `
        <div class="cori-turtle-view-header">
            <h3 class="cori-turtle-view-title"></h3>
            <a href="#" class="cori-turtle-view-validate">Profil validieren</a>
            <button type="button" class="cori-turtle-view-close">Schließen</button>
        </div>
        <pre class="cori-turtle-view-body" style="margin: 0; max-height: 60vh; overflow: auto;"><code class="language-turtle"></code></pre>`
    d.querySelector(".cori-turtle-view-validate").addEventListener("click", (e) => { e.preventDefault(); onValidate() })
    d.querySelector(".cori-turtle-view-close").addEventListener("click", () => d.close())
    d.addEventListener("click", (e) => { if (e.target === d) d.close() })
    return d
}

export class CoriProfile extends HTMLElement {
    connectedCallback() {
        if (this._table) return // render once; connect may fire again if moved in the DOM
        this.innerHTML = `
            <h3 class="cori-profile-heading">Profil</h3>
            <table class="cori-profile-table"></table>
            <div class="cori-profile-actions">
                <button type="button" data-action="inspect">Als Turtle anzeigen</button>
                <button type="button" data-action="add">Eintrag hinzufügen</button>
                <button type="button" data-action="download">Profil herunterladen</button>
                <button type="button" data-action="clear">Profil leeren</button>
            </div>`
        this._table = this.querySelector(".cori-profile-table")

        this.querySelector('[data-action="add"]').addEventListener("click", () => this._add())
        this.querySelector('[data-action="download"]').addEventListener("click", () => this._download())
        this.querySelector('[data-action="inspect"]').addEventListener("click", () => this._inspect())
        this.querySelector('[data-action="clear"]').addEventListener("click", () => this._clear())

        this.refresh()
    }

    async refresh() {
        if (!this._table) return
        this._table.replaceChildren()
        if (!isStorageReady()) return
        try {
            const store = await loadStore()
            for (const q of store.getQuads(getProfileSubject(), null, null, null)) {
                // the structural `a cori:Profile` base triple isn't a profile fact — skip it
                if (q.predicate.value === RDF_TYPE && q.object.value === PROFILE_TYPE) continue
                const tr = this._table.insertRow()
                // Predicate column shows a human label; its title surfaces the
                // prefixed IRI (e.g. ex:knows) on hover.
                const prefixed = contractTerm(q.predicate.value)
                const predCell = tr.insertCell()
                predCell.textContent = getLabel(q.predicate.value) ?? prefixed
                predCell.title = prefixed
                // IRI objects: prefer a locally stored rdfs:label; literals pass through.
                tr.insertCell().textContent = q.object.termType === "NamedNode"
                    ? (getOne(store, q.object.value, RDFS_LABEL) ?? contractTerm(q.object.value))
                    : q.object.value
            }
        } catch (err) {
            console.error("[cori-profile] render failed:", err)
        }
    }

    async _inspect() {
        if (!isStorageReady()) return
        try {
            await ensurePrism()
            const ttl = await loadAsTurtle()
            if (!this._turtleDialog) {
                this._turtleDialog = buildTurtleDialog(() => this._validate())
                this.appendChild(this._turtleDialog)
            }
            this._turtleDialog.querySelector(".cori-turtle-view-title").textContent = getStorageEntryName()
            const code = this._turtleDialog.querySelector("code")
            code.textContent = ttl
            window.Prism.highlightElement(code)
            this._turtleDialog.showModal()
        } catch (err) {
            console.error("[cori-profile] turtle view failed:", err)
        }
    }

    async _validate() {
        if (!isStorageReady()) return
        try {
            const report = await validateProfile(await loadStore())
            console.log("[cori-profile] SHACL validation report:\n" + await datasetToTurtle(report.dataset))
        } catch (err) {
            console.error("[cori-profile] validation failed:", err)
        }
    }

    async _add() {
        const input = window.prompt("Triple eingeben (Subjekt Prädikat Objekt, durch Leerzeichen getrennt).\nPräfixe sind möglich, z.B.: ex:alice ex:knows ex:bob")
        if (!input) return
        const terms = input.trim().split(/\s+/)
        if (terms.length !== 3) {
            console.error(`[cori-profile] expected 3 tokens (subject predicate object), got ${terms.length}:`, terms)
            return
        }
        const [s, p, o] = terms.map(expandTerm)
        try {
            await addTriple(s, p, o)
            await this.refresh()
            this._emitChange()
        } catch (err) {
            console.error("[cori-profile] addTriple failed:", err)
        }
    }

    async _download() {
        try {
            const url = URL.createObjectURL(new Blob([await loadAsTurtle()], { type: "text/turtle" }))
            const a = document.createElement("a")
            a.href = url
            a.download = this.getAttribute("download-name") ?? "profile.ttl"
            a.click()
            URL.revokeObjectURL(url)
        } catch (err) {
            console.error("[cori-profile] download failed:", err)
        }
    }

    async _clear() {
        if (!window.confirm("Wirklich alle Einträge im Profil löschen? Dies kann nicht rückgängig gemacht werden.")) return
        try {
            await clearStorage()
            await this.refresh()
            this._emitChange()
        } catch (err) {
            console.error("[cori-profile] clearStorage failed:", err)
        }
    }

    _emitChange() {
        this.dispatchEvent(new CustomEvent("cori-profile:change", { bubbles: true }))
    }
}

if (!customElements.get("cori-profile")) customElements.define("cori-profile", CoriProfile)
