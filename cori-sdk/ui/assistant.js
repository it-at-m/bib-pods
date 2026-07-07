import { loadStore, addInquiryFacts, isStorageReady } from "../storage/index.js"
import { getProfileSubject, getVocab, getLabel, getPluralLabel, getOne, contractTerm, sectionPlan, storageErrorMessage, RDFS_LABEL, RDF_TYPE, CORI } from "../utils.js"
import { getProfileShapesStore } from "../shacl.js"

const SH = "http://www.w3.org/ns/shacl#"
const SKOS = "http://www.w3.org/2004/02/skos/core#"
const PROFILE_TYPE = CORI + "Profile"

// The generic profile dialog assistant: a wizard that asks, per section, about each
// field. Nothing about it is curated — the agenda is derived from the vocabulary
// (sections, fields, order, labels), the SHACL shapes (sh:maxCount = single- vs
// multi-valued, when to stop offering more), and the profile data (empty fields are
// asked first; populated ones become "noch welche hinzufügen?"). Fields with a
// declared closed value set (cori:allowedValues) get a picker; free-text answers
// are stored as plain literals.

// The field's closed value set, or null for free-text fields: the concepts of the
// cori:allowedValues skos:ConceptScheme (German prefLabel preferred), plus how a
// picked concept is stored (cori:storeAs; unset = label literal) and the scheme's
// skos:definition — provenance help shown behind the picker's ?-icon.
function allowedValuesOf(field) {
    const v = getVocab()
    const scheme = getOne(v, field, CORI + "allowedValues")
    if (!scheme) return null
    const concepts = v.getObjects(scheme, SKOS + "hasTopConcept", null).map(c => {
        const labels = v.getObjects(c.value, SKOS + "prefLabel", null)
        const label = labels.find(t => t.language === "de")?.value ?? labels[0]?.value
        return { iri: c.value, label }
    }).filter(c => c.label)
    if (concepts.length === 0) return null
    const definitions = v.getObjects(scheme, SKOS + "definition", null)
    return {
        concepts,
        storeAsIri: getOne(v, field, CORI + "storeAs") === CORI + "ConceptIri",
        source: definitions.find(t => t.language === "de")?.value ?? definitions[0]?.value ?? null,
    }
}

// sh:maxCount of the field's property shape, or null when unbounded. Reads the same
// fused shapes graph validateProfile() checks against.
function maxCountOf(field) {
    const shapes = getProfileShapesStore()
    for (const q of shapes.getQuads(null, SH + "path", field, null)) {
        const mc = shapes.getObjects(q.subject, SH + "maxCount", null)[0]?.value
        if (mc !== undefined) return Number(mc)
    }
    return null
}

// The fields the assistant may ask about, given current value counts: fields not
// opted out via cori:assistantQuestion false, whose sh:maxCount isn't reached yet.
export function askableFields(fields, countOf) {
    return fields.filter(f => {
        if (getOne(getVocab(), f, CORI + "assistantQuestion") === "false") return false
        const max = maxCountOf(f)
        return max === null || countOf(f) < max
    })
}

// Article-free sentence frames: generated German with grammatical gender is a trap,
// so every frame embeds the field label in a case-neutral position.
function questionText(item, addedHere) {
    if (addedHere) return "Noch etwas?"
    if (item.count > 0) {
        const entries = item.count === 1 ? "schon einen Eintrag" : `schon ${item.count} Einträge`
        return `Unter „${item.label}" hast du ${entries}. Noch welche hinzufügen?`
    }
    return item.single
        ? `Möchtest du „${item.label}" ausfüllen?`
        : `Möchtest du unter „${item.label}" etwas eintragen?`
}

// Opens the wizard on `host` (a <cori-profile>; the dialog joins its light DOM so the
// app's scoped styles apply). sectionIri limits the agenda to one section; onChange
// fires after every stored answer, so the profile behind the dialog re-renders live.
export async function openAssistant({ host, onChange, sectionIri = null }) {
    if (!isStorageReady()) return window.alert("Keine Verbindung zum Speicherort.")
    let store
    try {
        store = await loadStore()
    } catch (err) {
        console.error("[cori-assistant] profile load failed:", err)
        return window.alert("Daten konnten gerade nicht geladen werden:\n" + storageErrorMessage(err))
    }

    const values = new Map()
    for (const q of store.getQuads(getProfileSubject(), null, null, null)) {
        if (q.predicate.value === RDF_TYPE && q.object.value === PROFILE_TYPE) continue
        if (!values.has(q.predicate.value)) values.set(q.predicate.value, [])
        values.get(q.predicate.value).push(q.object)
    }
    const countOf = f => values.get(f)?.length ?? 0
    const labelOfValue = o => o.termType === "NamedNode"
        ? (getOne(store, o.value, RDFS_LABEL) ?? contractTerm(o.value))
        : o.value

    // The agenda: per section (vocab order), its askable fields — empty ones first,
    // then the populated ones.
    const agenda = []
    for (const s of sectionPlan()) {
        if (sectionIri && s.iri !== sectionIri) continue
        const askable = askableFields(s.fields, countOf)
        const ordered = [...askable.filter(f => countOf(f) === 0), ...askable.filter(f => countOf(f) > 0)]
        ordered.forEach((field, idx) => {
            const max = maxCountOf(field)
            agenda.push({
                field,
                max,
                single: max === 1,
                count: countOf(field),
                sectionLabel: s.label,
                pos: idx + 1,
                total: ordered.length,
                label: (max === 1 ? null : getPluralLabel(field)) ?? getLabel(field) ?? contractTerm(field),
                existing: (values.get(field) ?? []).map(labelOfValue),
                choices: allowedValuesOf(field),
            })
        })
    }
    if (agenda.length === 0) return window.alert("Hier gibt es gerade nichts zu ergänzen.")

    const dialog = document.createElement("dialog")
    dialog.className = "cori-assistant"
    dialog.innerHTML = `
        <p class="cori-assistant-topline"><span class="cori-assistant-section"></span><span class="cori-assistant-progress"></span></p>
        <p class="cori-assistant-question"></p>
        <ul class="cori-profile-chips cori-assistant-existing"></ul>
        <form class="cori-assistant-form">
            <input type="text">
            <select hidden></select>
            <button type="button" class="cori-assistant-info" hidden
                title="Woher kommen diese Auswahlwerte?" aria-label="Woher kommen diese Auswahlwerte?">?</button>
            <button type="submit" class="button">Hinzufügen</button>
        </form>
        <p class="cori-assistant-source" hidden></p>
        <div class="cori-assistant-actions">
            <button type="button" class="cori-assistant-skip">Überspringen</button>
            <button type="button" class="cori-assistant-done">Fertig</button>
        </div>`
    host.appendChild(dialog)

    const sectionEl = dialog.querySelector(".cori-assistant-section")
    const progressEl = dialog.querySelector(".cori-assistant-progress")
    const questionEl = dialog.querySelector(".cori-assistant-question")
    const existingEl = dialog.querySelector(".cori-assistant-existing")
    const form = dialog.querySelector("form")
    const input = form.querySelector("input")
    const select = form.querySelector("select")
    const infoBtn = form.querySelector(".cori-assistant-info")
    const sourceEl = dialog.querySelector(".cori-assistant-source")
    const skipBtn = dialog.querySelector(".cori-assistant-skip")
    const doneBtn = dialog.querySelector(".cori-assistant-done")
    infoBtn.addEventListener("click", () => { sourceEl.hidden = !sourceEl.hidden })

    let i = 0
    let addedHere = false // an answer was stored for the current field --> "Noch etwas?" mode

    function renderStep() {
        if (i >= agenda.length) return renderEnd()
        const item = agenda[i]
        // Closed-set fields swap the text input for a picker of the not-yet-chosen
        // concepts; once every concept is in the profile there's nothing to ask.
        const remaining = item.choices?.concepts.filter(c => !item.existing.includes(c.label))
        if (remaining && remaining.length === 0) return advance()
        sectionEl.textContent = item.sectionLabel
        progressEl.textContent = `${item.pos} von ${item.total}`
        questionEl.textContent = questionText(item, addedHere)
        existingEl.hidden = item.existing.length === 0
        existingEl.replaceChildren(...item.existing.map(l => {
            const li = document.createElement("li")
            li.textContent = l
            return li
        }))
        input.hidden = !!remaining
        select.hidden = !remaining
        if (remaining) select.replaceChildren(...remaining.map(c => new Option(c.label, c.iri)))
        // provenance help for picker values, folded away until the ?-icon is clicked
        infoBtn.hidden = !(remaining && item.choices.source)
        sourceEl.textContent = item.choices?.source ?? ""
        sourceEl.hidden = true
        input.value = ""
        skipBtn.textContent = addedHere ? "Weiter" : "Überspringen"
        ;(remaining ? select : input).focus()
    }

    function renderEnd() {
        sectionEl.textContent = ""
        progressEl.textContent = ""
        questionEl.textContent = "Das war's, alle Fragen durch."
        existingEl.hidden = true
        form.hidden = true
        sourceEl.hidden = true
        skipBtn.hidden = true
        doneBtn.textContent = "Schließen"
    }

    function advance() {
        i++
        addedHere = false
        renderStep()
    }

    form.addEventListener("submit", async (e) => {
        e.preventDefault()
        const item = agenda[i]
        let facts
        let display
        if (item.choices) {
            const iri = select.value
            if (!iri) return
            display = select.selectedOptions[0].textContent
            // ConceptIri keeps the concept as a graph node (plus a label for display);
            // LabelLiteral stores just the label — for fields whose index matching is
            // label-based anyway, a plain string keeps the profile simple.
            facts = item.choices.storeAsIri
                ? [{ predicate: item.field, object: iri }, { subject: iri, predicate: RDFS_LABEL, object: display }]
                : [{ predicate: item.field, object: display }]
        } else {
            display = input.value.trim()
            if (!display) return
            facts = [{ predicate: item.field, object: display }]
        }
        try {
            await addInquiryFacts(facts)
        } catch (err) {
            console.error("[cori-assistant] addInquiryFacts failed:", err)
            return window.alert("Eintrag konnte nicht gespeichert werden:\n" + storageErrorMessage(err))
        }
        item.existing.push(display)
        item.count++
        addedHere = true
        onChange?.()
        if (item.max !== null && item.count >= item.max) advance()
        else renderStep()
    })
    skipBtn.addEventListener("click", advance)
    doneBtn.addEventListener("click", () => dialog.close())
    dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close() })
    dialog.addEventListener("close", () => dialog.remove())

    renderStep()
    dialog.showModal()
}
