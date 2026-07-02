import { loadStore, loadAsTurtle, addTriple, removeProfileFact, clearStorage, isStorageReady, getStorageEntryName } from "../storage/index.js"
import { getProfileSubject, getLabel, getPluralLabel, getOne, contractTerm, expandTerm, sectionPlan, storageErrorMessage, RDFS_LABEL, RDF_TYPE, CORI } from "../utils.js"
import { validateProfile } from "../shacl.js"
import { openAssistant, askableFields } from "./assistant.js"
import { datasetToTurtle } from "@foerderfunke/sem-ops-utils/core"

const PROFILE_TYPE = CORI + "Profile"

// <cori-profile> — a light-DOM UI primitive. Renders the user's profile triples
// grouped into the profile sections the merged vocabulary declares
// (cori:ProfileSection / cori:inSection / cori:order), plus profile-actions,
// wired straight to cori-sdk storage. Sections without entries collapse under a
// trailing "noch leere Bereiche" disclosure; profile facts whose predicate
// belongs to no section land in a catch-all group, so nothing is silently hidden.
// The heading carries a "Profil ausfüllen" launcher and every section with
// currently askable fields an "Ergänzen" launcher — both open the derived dialog
// assistant (./assistant.js), scoped to the whole profile or to that section.
// No shadow root, no bundled styles.
// Call refresh() to re-render after the profile changes elsewhere.
// Assignable property:
//   renderFieldValues: async (predicateIri, objectTerms) => Element | null
//     lets the app take over rendering of one field's values (e.g. saved books
//     as cover tiles); null/undefined or a throw falls back to the default chips.
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
        if (this._sectionsEl) return // render once; connect may fire again if moved in the DOM
        this.innerHTML = `
            <div class="cori-profile-header">
                <h3 class="cori-profile-heading">Profil</h3>
                <button type="button" class="cori-profile-fill">Profil ausfüllen</button>
            </div>
            <div class="cori-profile-sections"></div>
            <div class="cori-profile-actions">
                <button type="button" data-action="inspect">Als Turtle anzeigen</button>
                <button type="button" data-action="add">Eintrag hinzufügen</button>
                <button type="button" data-action="download">Profil herunterladen</button>
                <button type="button" data-action="clear">Profil leeren</button>
            </div>`
        this._sectionsEl = this.querySelector(".cori-profile-sections")
        this._refreshSeq = 0

        this.querySelector(".cori-profile-fill").addEventListener("click", () => this._assist())
        this.querySelector('[data-action="add"]').addEventListener("click", () => this._add())
        this.querySelector('[data-action="download"]').addEventListener("click", () => this._download())
        this.querySelector('[data-action="inspect"]').addEventListener("click", () => this._inspect())
        this.querySelector('[data-action="clear"]').addEventListener("click", () => this._clear())

        this.refresh()
    }

    // Empty sections alone would read as "no profile entries" — when the storage
    // is not connected or fails to load, say so instead.
    _renderNotice(text) {
        const p = document.createElement("p")
        p.className = "cori-profile-notice"
        p.textContent = text
        this._sectionsEl.replaceChildren(p)
    }

    async refresh() {
        if (!this._sectionsEl) return
        // Refreshes overlap (e.g. mount + session restore); the sequence number lets
        // stale ones discard their result, and the single replaceChildren at the end
        // keeps the previous rendering visible until the new one is complete.
        const seq = ++this._refreshSeq
        if (!isStorageReady()) return this._renderNotice("Keine Verbindung zum Speicherort.")
        try {
            const store = await loadStore()
            const sections = await this._renderSections(store)
            if (seq !== this._refreshSeq) return
            this._sectionsEl.replaceChildren(...sections)
        } catch (err) {
            console.error("[cori-profile] render failed:", err)
            this._renderNotice("Daten konnten gerade nicht geladen werden.")
        }
    }

    async _renderSections(store) {
        // profile facts grouped by predicate; the structural `a cori:Profile` base
        // triple isn't a profile fact
        const values = new Map()
        for (const q of store.getQuads(getProfileSubject(), null, null, null)) {
            if (q.predicate.value === RDF_TYPE && q.object.value === PROFILE_TYPE) continue
            if (!values.has(q.predicate.value)) values.set(q.predicate.value, [])
            values.get(q.predicate.value).push(q.object)
        }
        // counts snapshot for the launcher visibility — `values` is consumed below
        const counts = new Map([...values].map(([predicate, objects]) => [predicate, objects.length]))
        const countOf = f => counts.get(f) ?? 0
        const sections = []
        const emptySections = []
        for (const s of sectionPlan()) {
            const el = document.createElement("section")
            el.className = "cori-profile-section"
            const head = document.createElement("div")
            head.className = "cori-profile-section-head"
            const heading = document.createElement("h4")
            heading.textContent = s.label
            head.appendChild(heading)
            // sections with something to ask right now get their own assistant launcher
            if (askableFields(s.fields, countOf).length > 0) {
                const addBtn = document.createElement("button")
                addBtn.type = "button"
                addBtn.className = "cori-profile-add"
                addBtn.textContent = "Ergänzen"
                addBtn.addEventListener("click", () => this._assist(s.iri))
                head.appendChild(addBtn)
            }
            el.appendChild(head)
            for (const field of s.fields) {
                const objects = values.get(field)
                values.delete(field)
                if (objects?.length) el.appendChild(await this._buildFieldGroup(store, field, objects))
            }
            // sections without entries are collapsed away below
            ;(el.children.length > 1 ? sections : emptySections).push(el)
        }
        // facts whose predicate no section claims (e.g. manually added triples)
        if (values.size > 0) {
            const el = document.createElement("section")
            el.className = "cori-profile-section"
            const heading = document.createElement("h4")
            heading.textContent = "Weiteres"
            el.appendChild(heading)
            for (const [predicate, objects] of values) {
                el.appendChild(await this._buildFieldGroup(store, predicate, objects))
            }
            sections.push(el)
        }
        if (emptySections.length > 0) {
            const details = document.createElement("details")
            details.className = "cori-profile-more"
            const summary = document.createElement("summary")
            summary.textContent = `Noch leere Bereiche (${emptySections.length})`
            details.append(summary, ...emptySections)
            sections.push(details)
        }
        return sections
    }

    async _buildFieldGroup(store, predicate, objects) {
        const group = document.createElement("div")
        group.className = "cori-profile-field"
        const label = document.createElement("p")
        label.className = "cori-profile-field-label"
        // several values get the plural form; the title surfaces the prefixed IRI on hover
        label.textContent = (objects.length > 1 ? getPluralLabel(predicate) : null)
            ?? getLabel(predicate) ?? contractTerm(predicate)
        label.title = contractTerm(predicate)
        group.appendChild(label)
        let custom = null
        try { custom = await this.renderFieldValues?.(predicate, objects) } catch (err) {
            console.error("[cori-profile] renderFieldValues failed, falling back to chips:", err)
        }
        if (custom) {
            group.appendChild(custom)
            return group
        }
        const chips = document.createElement("ul")
        chips.className = "cori-profile-chips"
        chips.append(...objects.map(o => this._buildChip(store, predicate, o)))
        group.appendChild(chips)
        return group
    }

    // IRI values prefer their locally stored rdfs:label; literals pass through.
    // Each chip carries a remove control that deletes the fact from the profile.
    _buildChip(store, predicate, object) {
        const li = document.createElement("li")
        const text = document.createElement("span")
        if (object.termType === "NamedNode") {
            text.textContent = getOne(store, object.value, RDFS_LABEL) ?? contractTerm(object.value)
            li.title = contractTerm(object.value)
        } else {
            text.textContent = object.value
        }
        const remove = document.createElement("button")
        remove.type = "button"
        remove.className = "cori-profile-chip-remove"
        remove.textContent = "×"
        remove.title = "Entfernen"
        remove.setAttribute("aria-label", `„${text.textContent}" entfernen`)
        remove.addEventListener("click", async () => {
            try {
                await removeProfileFact(predicate, object)
                await this.refresh()
                this._emitChange()
            } catch (err) {
                console.error("[cori-profile] removeProfileFact failed:", err)
                window.alert("Eintrag konnte nicht entfernt werden:\n" + storageErrorMessage(err))
            }
        })
        li.append(text, remove)
        return li
    }

    // Opens the derived dialog assistant, whole-profile or scoped to one section.
    // Every stored answer refreshes the sections behind the dialog and notifies the
    // app (same event as the other mutations).
    _assist(sectionIri = null) {
        openAssistant({
            host: this,
            sectionIri,
            onChange: () => { this.refresh(); this._emitChange() },
        })
    }

    async _inspect() {
        if (!isStorageReady()) return window.alert("Keine Verbindung zum Speicherort.")
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
        if (!isStorageReady()) return window.alert("Keine Verbindung zum Speicherort.")
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
            window.alert("Eintrag konnte nicht gespeichert werden:\n" + storageErrorMessage(err))
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
            window.alert("Profil konnte nicht heruntergeladen werden:\n" + storageErrorMessage(err))
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
            window.alert("Profil konnte nicht geleert werden:\n" + storageErrorMessage(err))
        }
    }

    _emitChange() {
        this.dispatchEvent(new CustomEvent("cori-profile:change", { bubbles: true }))
    }
}

if (!customElements.get("cori-profile")) customElements.define("cori-profile", CoriProfile)
