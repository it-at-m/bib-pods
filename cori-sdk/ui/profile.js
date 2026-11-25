import { loadStore, loadAsTurtle, addTriple, removeProfileFact, changeProfileFacts, clearStorage, isStorageReady, getStorageEntryName } from "../storage/index.js"
import { getProfileSubject, getVocab, getLabel, getPluralLabel, getOne, contractTerm, expandTerm, sectionPlan, storageErrorMessage, RDFS_LABEL, RDF_TYPE, CORI } from "../utils.js"
import { validateProfile } from "../shacl.js"
import { openAssistant, askableFields } from "./assistant.js"
import { datasetToTurtle } from "@foerderfunke/sem-ops-utils/core"

const PROFILE_TYPE = CORI + "Profile"

// <cori-profile> — a light-DOM UI primitive. Renders the user's profile triples
// grouped into the profile sections the merged vocabulary declares
// (cori:ProfileSection / cori:inSection / cori:order), wired straight to cori-sdk
// storage. A section the dialog assistant (./assistant.js) can ask about is always in
// view: its entries, and each field still empty as a "+ <label>" chip that opens the
// card for that field, so the profile doubles as the map of what it can hold. Sections
// with neither entries nor anything to ask collapse under a trailing "noch leere
// Bereiche" disclosure, except those the vocabulary marks cori:listWhenEmpty false
// (nothing fills them); profile facts whose predicate belongs to no section land in a
// catch-all group, so nothing that is there is silently hidden.
// The header's "Fragen beantworten" launcher opens the assistant's whole deck. The app
// can add its own launchers to .cori-profile-launchers.
// The header's "⋯" menu manages the profile as a whole (download; clear once there is
// something to clear) and leads to the raw Turtle view, where the expert tools live:
// adding a single triple, validating, and whatever the app adds (expertTools).
// While the profile holds no facts the element carries the attribute data-empty.
// No shadow root, no bundled styles.
// Call refresh() to re-render after the profile changes elsewhere, assist(only) to open
// the assistant: the whole deck, or just the cards named (one or a list: a field's IRI,
// or the id of one of the app's own cards).
// Assignable properties:
//   assistantSource: what the app knows about a field's values (search, suggestions,
//     preview, cards of its own); see ./assistant.js.
//   expertTools: [{ label, run, available? }]
//     tools of the app's own in the raw Turtle view's header, beside the SDK's. Each
//     opening of the view asks available() (if given) whether to show one; running one
//     closes the view first.
//   renderFieldValues: async (predicateIri, objectTerms) => Element | null
//     lets the app take over rendering of one field's values (e.g. saved books
//     as cover tiles); null/undefined or a throw falls back to the default chips.
//   annotateField: async (predicateIri, store) => { title, onActivate? } | null
//     lets the app flag a populated field with a small ⓘ beside its label (e.g.
//     "these facts feed no enabled recommendation strategy"); title becomes the
//     aria-label (visual tooltip presentation is the app's business), onActivate
//     the click action. null/undefined or a throw = no marker.
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

function buildTurtleDialog({ onAdd, onValidate }) {
    const d = document.createElement("dialog")
    d.className = "cori-turtle-view"
    d.innerHTML = `
        <div class="cori-turtle-view-header">
            <h3 class="cori-turtle-view-title"></h3>
            <a href="#" class="cori-turtle-view-tool cori-turtle-view-add">Triple hinzufügen</a>
            <a href="#" class="cori-turtle-view-tool cori-turtle-view-validate">Profil validieren</a>
            <button type="button" class="cori-turtle-view-close">Schließen</button>
        </div>
        <pre class="cori-turtle-view-body" style="margin: 0; max-height: 60vh; overflow: auto;"><code class="language-turtle"></code></pre>`
    d.querySelector(".cori-turtle-view-add").addEventListener("click", (e) => { e.preventDefault(); onAdd() })
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
                <div class="cori-profile-launchers">
                    <button type="button" class="cori-profile-fill">Fragen beantworten</button>
                </div>
                <details class="cori-profile-menu">
                    <summary aria-label="Profil verwalten" title="Profil verwalten">⋯</summary>
                    <div class="cori-profile-actions">
                        <button type="button" data-action="download">Herunterladen</button>
                        <button type="button" data-action="clear" hidden>Leeren</button>
                        <button type="button" data-action="inspect">Rohdaten anzeigen</button>
                    </div>
                </details>
            </div>
            <div class="cori-profile-sections"></div>`
        this._sectionsEl = this.querySelector(".cori-profile-sections")
        this._menuEl = this.querySelector(".cori-profile-menu")
        this._refreshSeq = 0
        this._openSections = new Set()    // cori:collapsed sections the user opened

        this.querySelector(".cori-profile-fill").addEventListener("click", () => this.assist())
        this.querySelector('[data-action="download"]').addEventListener("click", () => this._download())
        this.querySelector('[data-action="inspect"]').addEventListener("click", () => this._inspect())
        this.querySelector('[data-action="clear"]').addEventListener("click", () => this._clear())
        this._wireMenu()

        this.refresh()
    }

    // <details> opens and closes on its own summary only; a menu also closes once an
    // item is chosen, on Escape, and when the user clicks or tabs elsewhere.
    _wireMenu() {
        const menu = this._menuEl
        menu.querySelector(".cori-profile-actions").addEventListener("click", () => { menu.open = false })
        menu.addEventListener("keydown", (e) => {
            if (e.key !== "Escape" || !menu.open) return
            menu.open = false
            menu.querySelector("summary").focus()
        })
        const closeOutside = (e) => { if (!menu.contains(e.target)) menu.open = false }
        menu.addEventListener("toggle", () => {
            for (const type of ["pointerdown", "focusin"]) {
                if (menu.open) document.addEventListener(type, closeOutside)
                else document.removeEventListener(type, closeOutside)
            }
        })
    }

    // facts: the profile subject has facts. entries: the storage holds anything beyond
    // the structural base triple (e.g. settings under another subject), which is what
    // clearing acts on.
    _setContentState({ facts, entries }) {
        this.toggleAttribute("data-empty", !facts)
        this.querySelector('[data-action="clear"]').hidden = !entries
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
            const isBase = q => q.subject.value === getProfileSubject()
                && q.predicate.value === RDF_TYPE && q.object.value === PROFILE_TYPE
            const quads = store.getQuads(null, null, null, null).filter(q => !isBase(q))
            this._setContentState({
                facts: quads.some(q => q.subject.value === getProfileSubject()),
                entries: quads.length > 0,
            })
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
        // counts snapshot for what can still be asked — `values` is consumed below
        const counts = new Map([...values].map(([predicate, objects]) => [predicate, objects.length]))
        const askable = f => askableFields([f], field => counts.get(field) ?? 0).length > 0
        // The "noch leere Bereiche" disclosure sorts among the sections at the
        // cori:EmptySectionsBlock anchor's order; filled sections beyond it (e.g. a
        // machine-fed saved list) render below the disclosure.
        const gapsOrder = Number(getOne(getVocab(), CORI + "EmptySectionsBlock", CORI + "order") ?? Number.MAX_SAFE_INTEGER)
        const sections = []
        const trailingSections = []
        const emptySections = []
        for (const s of sectionPlan()) {
            const el = document.createElement("section")
            el.className = "cori-profile-section"
            const head = document.createElement("div")
            head.className = "cori-profile-section-head"
            const heading = document.createElement("h4")
            heading.textContent = s.label
            head.appendChild(heading)
            el.appendChild(head)
            const toAsk = []        // empty fields the assistant has a card for
            const unasked = []      // empty fields that fill by other means
            const facts = []
            for (const field of s.fields) {
                const objects = values.get(field)
                values.delete(field)
                if (objects?.length) {
                    facts.push(...objects.map(object => ({ predicate: field, object })))
                    el.appendChild(await this._buildFieldGroup(store, field, objects,
                        askable(field) ? () => this.assist(field) : null))
                } else {
                    (askable(field) ? toAsk : unasked).push(field)
                }
            }
            if (facts.length === 0 && toAsk.length === 0) {
                // nothing in it and nothing to ask: under the disclosure, naming what it
                // holds, unless nothing in the app fills it (cori:listWhenEmpty false)
                if (getOne(getVocab(), s.iri, CORI + "listWhenEmpty") === "false") continue
                if (unasked.length > 0) el.appendChild(this._buildGapFields(unasked, { ask: false }))
                emptySections.push(el)
                continue
            }
            if (toAsk.length > 0) el.appendChild(this._buildGapFields(toAsk, { ask: true }))
            if (s.clearable && facts.length > 0) el.appendChild(this._buildClearSection(s.label, facts))
            const placed = s.collapsed ? this._foldSection(s.iri, el, facts.length) : el
            ;(s.order > gapsOrder ? trailingSections : sections).push(placed)
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
        return [...sections, ...trailingSections]
    }

    // A cori:collapsed section: the same content behind its heading (with the number of
    // entries), open again after a refresh if the user opened it.
    _foldSection(sectionIri, el, entries) {
        const details = document.createElement("details")
        details.className = `${el.className} cori-profile-collapsible`
        details.open = this._openSections.has(sectionIri)
        details.addEventListener("toggle", () => {
            if (details.open) this._openSections.add(sectionIri)
            else this._openSections.delete(sectionIri)
        })
        const summary = document.createElement("summary")
        const head = el.firstElementChild
        head.querySelector("h4").append(` (${entries})`)
        summary.appendChild(head)
        details.append(summary, ...el.childNodes)
        return details
    }

    // A cori:clearable section's "Bereich leeren": removes every fact shown in it in one
    // write, after a confirmation.
    _buildClearSection(label, facts) {
        const btn = document.createElement("button")
        btn.type = "button"
        btn.className = "cori-profile-clear-section"
        btn.textContent = "Bereich leeren"
        btn.addEventListener("click", async () => {
            const count = facts.length === 1 ? "Der Eintrag darin wird" : `Alle ${facts.length} Einträge darin werden`
            if (!window.confirm(`„${label}" leeren? ${count} aus dem Profil entfernt.`)) return
            try {
                await changeProfileFacts({ remove: facts })
                await this.refresh()
                this._emitChange()
            } catch (err) {
                console.error("[cori-profile] clearing a section failed:", err)
                window.alert("Bereich konnte nicht geleert werden:\n" + storageErrorMessage(err))
            }
        })
        return btn
    }

    // A section's empty fields. With `ask`: "+ <label>" chips, each opening the
    // assistant's card for its field. Without: their names as plain muted text, for
    // fields that fill by other means.
    _buildGapFields(fields, { ask }) {
        const list = document.createElement("ul")
        list.className = "cori-profile-gap-fields"
        for (const field of fields) {
            const li = document.createElement("li")
            if (ask) {
                const btn = document.createElement("button")
                btn.type = "button"
                btn.className = "cori-profile-add-field"
                btn.textContent = `+ ${getPluralLabel(field) ?? getLabel(field) ?? contractTerm(field)}`
                btn.addEventListener("click", () => this.assist(field))
                li.appendChild(btn)
            } else {
                li.className = "cori-profile-gap-field-static"
                li.textContent = getLabel(field) ?? contractTerm(field)
            }
            list.appendChild(li)
        }
        return list
    }

    // onAsk (optional): opens the assistant's card for this field — rendered as a
    // small "+" beside the label when the field can still take entries.
    async _buildFieldGroup(store, predicate, objects, onAsk = null) {
        const group = document.createElement("div")
        group.className = "cori-profile-field"
        const label = document.createElement("p")
        label.className = "cori-profile-field-label"
        // several values get the plural form; the title surfaces the prefixed IRI on hover
        const labelText = (objects.length > 1 ? getPluralLabel(predicate) : null)
            ?? getLabel(predicate) ?? contractTerm(predicate)
        label.textContent = labelText
        label.title = contractTerm(predicate)
        if (onAsk) {
            const addOne = document.createElement("button")
            addOne.type = "button"
            addOne.className = "cori-profile-add-one"
            addOne.textContent = "+"
            addOne.title = `„${labelText}" ergänzen`
            addOne.setAttribute("aria-label", `„${labelText}" ergänzen`)
            addOne.addEventListener("click", onAsk)
            label.appendChild(addOne)
        }
        let notice = null
        try { notice = await this.annotateField?.(predicate, store) } catch (err) {
            console.error("[cori-profile] annotateField failed:", err)
        }
        if (notice) {
            const info = document.createElement("button")
            info.type = "button"
            info.className = "cori-profile-field-notice"
            info.textContent = "ⓘ"
            info.setAttribute("aria-label", notice.title)
            if (notice.onActivate) info.addEventListener("click", notice.onActivate)
            label.appendChild(info)
        }
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

    // Opens the derived dialog assistant: its whole deck, or the cards `only` names (one
    // or a list: a field's IRI, or the id of one of the app's cards). Every stored
    // answer refreshes the sections behind the dialog and notifies the app (same event
    // as the other mutations).
    assist(only = null) {
        return openAssistant({
            host: this,
            only,
            onChange: () => { this.refresh(); this._emitChange() },
        })
    }

    async _inspect() {
        if (!isStorageReady()) return window.alert("Keine Verbindung zum Speicherort.")
        try {
            await ensurePrism()
            if (!this._turtleDialog) {
                this._turtleDialog = buildTurtleDialog({ onAdd: () => this._add(), onValidate: () => this._validate() })
                this.appendChild(this._turtleDialog)
            }
            this._turtleDialog.querySelector(".cori-turtle-view-title").textContent = getStorageEntryName()
            this._renderExpertTools()
            await this._renderTurtle()
            this._turtleDialog.showModal()
        } catch (err) {
            console.error("[cori-profile] turtle view failed:", err)
        }
    }

    // The app's tools (expertTools) as links before "Schließen", rebuilt per opening:
    // what is available can change with the storage in use.
    _renderExpertTools() {
        const header = this._turtleDialog.querySelector(".cori-turtle-view-header")
        for (const link of header.querySelectorAll(".cori-turtle-view-app-tool")) link.remove()
        const close = header.querySelector(".cori-turtle-view-close")
        for (const tool of this.expertTools ?? []) {
            if (tool.available && !tool.available()) continue
            const link = document.createElement("a")
            link.href = "#"
            link.className = "cori-turtle-view-tool cori-turtle-view-app-tool"
            link.textContent = tool.label
            link.addEventListener("click", (e) => {
                e.preventDefault()
                this._turtleDialog.close()
                tool.run()
            })
            close.before(link)
        }
    }

    async _renderTurtle() {
        const code = this._turtleDialog.querySelector("code")
        code.textContent = await loadAsTurtle()
        window.Prism.highlightElement(code)
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
            await this._renderTurtle()
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
