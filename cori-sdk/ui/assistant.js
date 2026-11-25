import { loadStore, addInquiryFacts, removeProfileFact, isStorageReady } from "../storage/index.js"
import { getProfileSubject, getVocab, getLabel, getPluralLabel, getText, getOne, contractTerm, sectionPlan, storageErrorMessage, RDFS_LABEL, CORI } from "../utils.js"
import { getProfileShapesStore } from "../shacl.js"

const SH = "http://www.w3.org/ns/shacl#"
const SKOS = "http://www.w3.org/2004/02/skos/core#"

// The generic profile dialog assistant: a deck of cards, one question each, that takes
// the user through the profile a small step at a time. The deck is derived, not
// curated: the vocabulary gives sections, fields, order and wording, the SHACL shapes
// say when a field is full (sh:maxCount), and the profile says what is already there.
//
// A card asks one field. How it is answered follows from the field's declaration:
//   - cori:allowedValues (a closed value set): chips to switch on and off, in the
//     concepts' cori:order, the first few in view and the rest behind a fold, with the
//     scheme's skos:definition beside them (where do these values come from)
//   - anything else: a search field, the chosen values as removable chips, and
//     suggestions to tap
// The answers are stored at once, so the profile behind the dialog follows along.
//
// What a search finds and what is suggested is the app's knowledge. The host element
// passes it in as `assistantSource`, every member optional:
//   search(field, text)            --> items matching what was typed
//   suggest(field, store)          --> { caption, items } to tap, caption saying where they come from
//   related(field, anchor, store)  --> { caption, items } that go with a chosen value
//                                      (anchor = { object, label }); items may belong
//                                      to other fields
//   facts(item)                    --> the facts that store an item
//   preview(field, store)          --> an element showing what the card's answers do
//   hint(field, store)             --> a line under the question (what the field is for)
//   cards                          --> [{ id, title, hint, render(body) }]: cards of the
//                                      app's own, shown before the field cards. title and
//                                      hint may be functions of (store, { alone }), alone
//                                      saying the card was opened on its own; render may
//                                      return a cleanup
//   finish                         --> { text, label, action }: closing words and a way on,
//                                      shown with what the profile gained, after a walk
//                                      through several cards
// All but hint may be asynchronous. An item is { label, field?, note?, hint?, kind? }
// plus whatever the app needs to store it: note is shown beside the label, hint at the
// end of a search result, kind as a badge on a related chip. Without `facts` an item
// is stored as its label; without `search` a typed text is stored as it is.

// Chips in view before the fold: of a closed set, and of a list of suggestions.
const CLOSED_IN_VIEW = 12
const SUGGESTIONS_IN_VIEW = 9
const SEARCH_DELAY_MS = 200

// The field's closed value set, or null for open fields: the concepts of the
// cori:allowedValues skos:ConceptScheme in their cori:order (German prefLabel
// preferred), how a chosen concept is stored (cori:storeAs; unset = label literal) and
// the scheme's skos:definition.
function allowedValuesOf(field) {
    const v = getVocab()
    const scheme = getOne(v, field, CORI + "allowedValues")
    if (!scheme) return null
    const concepts = v.getObjects(scheme, SKOS + "hasTopConcept", null).map(c => {
        const labels = v.getObjects(c.value, SKOS + "prefLabel", null)
        const label = labels.find(t => t.language === "de")?.value ?? labels[0]?.value
        return { iri: c.value, label, order: Number(getOne(v, c.value, CORI + "order") ?? Number.MAX_SAFE_INTEGER) }
    }).filter(c => c.label).sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, "de"))
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

const el = (tag, className, text) => {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
}

// Opens the deck on `host` (a <cori-profile>; the dialog joins its light DOM so the
// app's scoped styles apply). `only` narrows the deck to the cards it names, one or a
// list: a field's IRI for the card asking it, or the id of one of the app's cards.
// onChange fires after every stored answer, so the profile behind the dialog re-renders
// live.
export async function openAssistant({ host, onChange, only = null }) {
    if (!isStorageReady()) return window.alert("Keine Verbindung zum Speicherort.")
    const source = host.assistantSource ?? {}
    const subject = getProfileSubject()
    let store
    try {
        store = await loadStore()
    } catch (err) {
        console.error("[cori-assistant] profile load failed:", err)
        return window.alert("Daten konnten gerade nicht geladen werden:\n" + storageErrorMessage(err))
    }

    const termsOf = field => store.getObjects(subject, field, null)
    const labelOf = term => term.termType === "NamedNode"
        ? (getOne(store, term.value, RDFS_LABEL) ?? getLabel(term.value) ?? contractTerm(term.value))
        : term.value
    const nameOf = (field, count = 2) => (count === 1 ? null : getPluralLabel(field)) ?? getLabel(field) ?? contractTerm(field)
    // the profile entry an item stands for, if it is there already
    const termFor = item => termsOf(item.field).find(term => labelOf(term) === item.label)
    const isFull = field => {
        const max = maxCountOf(field)
        return max !== null && termsOf(field).length >= max
    }

    // One card per askable field, in section and field order.
    const fieldCards = sectionPlan()
        .flatMap(s => askableFields(s.fields, f => termsOf(f).length))
        .map(field => ({
            field,
            title: getText(field, CORI + "assistantPrompt") ?? nameOf(field),
            hint: getText(field, CORI + "assistantHint"),
        }))
    const cards = [...(source.cards ?? []).map(custom => ({ custom })), ...fieldCards]
    const wanted = only === null ? null : [].concat(only)
    const deck = wanted ? cards.filter(card => wanted.includes(card.custom ? card.custom.id : card.field)) : cards
    if (deck.length === 0) return window.alert("Hier gibt es gerade nichts zu ergänzen.")

    // what the profile held when the deck opened: the closing card shows the gain
    const countsAtOpen = new Map()
    for (const q of store.getQuads(subject, null, null, null)) {
        countsAtOpen.set(q.predicate.value, (countsAtOpen.get(q.predicate.value) ?? 0) + 1)
    }

    const dialog = el("dialog", "cori-assistant")
    dialog.innerHTML = `
        <h3 class="cori-assistant-question" id="cori-assistant-question"></h3>
        <p class="cori-assistant-hint"></p>
        <div class="cori-assistant-body"></div>
        <div class="cori-assistant-foot">
            <p class="cori-assistant-progress"><span class="cori-assistant-dots" aria-hidden="true"></span><span class="cori-assistant-count"></span></p>
            <p class="cori-assistant-nav">
                <button type="button" class="cori-assistant-back">Zurück</button>
                <button type="button" class="cori-assistant-done">Fertig</button>
                <button type="button" class="cori-assistant-next button">Weiter</button>
            </p>
        </div>`
    dialog.setAttribute("aria-labelledby", "cori-assistant-question")
    host.appendChild(dialog)

    const questionEl = dialog.querySelector(".cori-assistant-question")
    const hintEl = dialog.querySelector(".cori-assistant-hint")
    const bodyEl = dialog.querySelector(".cori-assistant-body")
    const progressEl = dialog.querySelector(".cori-assistant-progress")
    const dotsEl = dialog.querySelector(".cori-assistant-dots")
    const countEl = dialog.querySelector(".cori-assistant-count")
    const backBtn = dialog.querySelector(".cori-assistant-back")
    const doneBtn = dialog.querySelector(".cori-assistant-done")
    const nextBtn = dialog.querySelector(".cori-assistant-next")

    let index = 0
    let shown = 0           // counts card renders: answers arriving for an earlier one are dropped
    let leaveCard = null    // cleanup of the card on display
    let refreshers = []     // what on the card on display follows the profile
    let saving = Promise.resolve()

    // Every change to the profile made from a card goes through here: stored, then
    // the card and the profile behind the dialog follow. Changes queue up, so quick
    // taps on a slow storage all arrive, in order; `write` therefore reads the profile
    // when its turn comes, not when the tap happened.
    function change(write) {
        const done = saving.then(async () => {
            try {
                await write()
                store = await loadStore()
            } catch (err) {
                console.error("[cori-assistant] saving an answer failed:", err)
                window.alert("Eintrag konnte nicht gespeichert werden:\n" + storageErrorMessage(err))
                return false
            }
            onChange?.()
            for (const refresh of refreshers) refresh()
            return true
        })
        saving = done
        return done
    }
    const add = async (item) => {
        if (termFor(item)) return
        const facts = source.facts ? await source.facts(item) : [{ predicate: item.field, object: item.label }]
        await addInquiryFacts(facts)
    }
    const addItem = item => change(() => add(item))
    const removeTerm = (field, term) => change(() => removeProfileFact(field, term))
    const toggleItem = item => change(() => {
        const term = termFor(item)
        return term ? removeProfileFact(item.field, term) : add(item)
    })

    // A chip that is on or off. `key` finds it again after its list was rebuilt, so
    // keyboard focus stays where it was.
    function chip(text, { pressed = null, kind = null, key, onClick }) {
        const btn = el("button", "cori-assistant-chip")
        btn.type = "button"
        btn.dataset.key = key
        if (kind) btn.append(el("span", "cori-assistant-kind", kind), " ")
        btn.append(text)
        if (pressed !== null) btn.setAttribute("aria-pressed", String(pressed))
        btn.addEventListener("click", onClick)
        const li = el("li")
        li.appendChild(btn)
        return li
    }
    function fill(list, items) {
        const focused = list.contains(document.activeElement) ? document.activeElement.dataset.key : null
        list.replaceChildren(...items)
        if (focused) [...list.querySelectorAll("[data-key]")].find(b => b.dataset.key === focused)?.focus()
    }
    // "n weitere" at the end of a folded chip list; gone once opened or nothing is hidden
    function foldToggle(hidden, text, onOpen) {
        if (hidden <= 0) return []
        const btn = el("button", "cori-assistant-more", text)
        btn.type = "button"
        btn.addEventListener("click", onOpen)
        const li = el("li")
        li.appendChild(btn)
        return [li]
    }

    // A closed value set: every concept a chip that is on or off.
    function closedField(field, choices) {
        const wrap = el("div", "cori-assistant-field")
        const list = el("ul", "cori-assistant-chips")
        wrap.appendChild(list)
        if (choices.source) wrap.appendChild(el("p", "cori-assistant-caption cori-assistant-source", choices.source))
        let open = false
        const termOf = c => termsOf(field).find(t => choices.storeAsIri ? t.value === c.iri : t.value === c.label)
        const toggle = c => change(() => {
            const term = termOf(c)
            if (term) return removeProfileFact(field, term)
            if (isFull(field)) return
            return addInquiryFacts(choices.storeAsIri
                // ConceptIri keeps the concept as a graph node (plus a label for display);
                // LabelLiteral stores just the label: for fields whose index matching is
                // label-based anyway, a plain string keeps the profile simple.
                ? [{ predicate: field, object: c.iri }, { subject: c.iri, predicate: RDFS_LABEL, object: c.label }]
                : [{ predicate: field, object: c.label }])
        })
        const render = () => {
            const full = isFull(field)
            // what is switched on stays in view, wherever it sorts
            const visible = choices.concepts.filter((c, i) => open || i < CLOSED_IN_VIEW || termOf(c))
            const chips = visible.map(c => {
                const on = Boolean(termOf(c))
                const li = chip(c.label, { pressed: on, key: c.iri, onClick: () => toggle(c) })
                if (full && !on) li.firstChild.disabled = true
                return li
            })
            const hidden = choices.concepts.length - visible.length
            fill(list, [...chips, ...foldToggle(hidden, `${hidden} weitere`, () => { open = true; render() })])
        }
        render()
        refreshers.push(render)
        return wrap
    }

    // An open field: search, the chosen values, suggestions, and what goes with the
    // value chosen last.
    function openField(field) {
        const wrap = el("div", "cori-assistant-field")
        const input = el("input", "cori-assistant-input")
        input.type = "text"
        input.autocomplete = "off"
        input.spellcheck = false
        input.placeholder = getText(field, CORI + "assistantExample") ?? ""
        input.setAttribute("aria-label", nameOf(field))
        const results = el("ul", "cori-assistant-results")
        results.hidden = true
        const status = el("p", "cori-assistant-status")
        status.setAttribute("role", "status")
        status.hidden = true
        const chosenLabel = el("p", "cori-assistant-label", "Deine Auswahl")
        const chosen = el("ul", "cori-profile-chips cori-assistant-chosen")
        const suggestCaption = el("p", "cori-assistant-caption")
        const suggestList = el("ul", "cori-assistant-chips")
        const relatedCaption = el("p", "cori-assistant-caption")
        const relatedList = el("ul", "cori-assistant-chips")
        wrap.append(input, results, status, chosenLabel, chosen, suggestCaption, suggestList, relatedCaption, relatedList)

        const say = text => { status.hidden = !text; status.textContent = text ?? "" }
        let hits = []
        let active = -1
        let searches = 0
        let timer = 0
        const showHits = (items) => {
            hits = items
            active = -1
            results.hidden = items.length === 0
            results.replaceChildren(...items.map((item, i) => {
                const btn = el("button", "cori-assistant-result")
                btn.type = "button"
                btn.tabIndex = -1    // reached with the arrow keys from the input
                const name = el("span", "cori-assistant-result-label", item.label)
                if (item.note) name.append(" ", el("span", "cori-assistant-note", item.note))
                btn.appendChild(name)
                if (item.hint) btn.appendChild(el("span", "cori-assistant-result-hint", item.hint))
                if (termFor(item)) btn.appendChild(el("span", "cori-assistant-result-hint", "schon gewählt"))
                btn.addEventListener("click", () => pick(i))
                const li = el("li")
                li.appendChild(btn)
                return li
            }))
        }
        const mark = (i) => {
            active = i
            ;[...results.querySelectorAll("button")].forEach((b, n) => b.classList.toggle("is-active", n === i))
        }
        // the value added last on this card: what the neighbours below go with
        let lastAdded = null
        const addHere = item => {
            if (item.field === field) lastAdded = item.label
            return addItem(item)
        }
        async function pick(i) {
            const item = hits[i]
            if (!item) return
            if (!await addHere(item)) return
            input.value = ""
            showHits([])
            say(null)
            input.focus()
        }
        async function runSearch() {
            const text = input.value.trim()
            const run = ++searches
            if (!text || !source.search) { showHits([]); say(null); return }
            try {
                const items = await source.search(field, text)
                if (run !== searches) return
                showHits(items.map(item => ({ field, ...item })))
                say(items.length === 0 && text.length > 1 ? "Dazu wurde nichts gefunden." : null)
            } catch (err) {
                if (run !== searches) return
                console.error("[cori-assistant] search failed:", err)
                showHits([])
                say("Die Suche ist gerade nicht erreichbar.")
            }
        }
        input.addEventListener("input", () => {
            clearTimeout(timer)
            timer = setTimeout(runSearch, SEARCH_DELAY_MS)
        })
        input.addEventListener("keydown", (e) => {
            if (e.key === "ArrowDown" && hits.length) { e.preventDefault(); mark((active + 1) % hits.length) }
            else if (e.key === "ArrowUp" && hits.length) { e.preventDefault(); mark((active - 1 + hits.length) % hits.length) }
            else if (e.key === "Escape" && (hits.length || input.value)) {
                // first Escape gives up the search, the next one closes the dialog
                e.preventDefault()
                input.value = ""
                searches++
                showHits([])
                say(null)
            } else if (e.key === "Enter") {
                e.preventDefault()
                if (hits.length) pick(active === -1 ? 0 : active)
                else if (!source.search && input.value.trim()) {
                    addHere({ field, label: input.value.trim() }).then(ok => { if (ok) input.value = "" })
                }
            }
        })

        let suggestions = null      // { caption, items } once they arrived
        let moreOpen = false
        let related = null
        let relatedFor = null       // the value `related` belongs to
        const renderChosen = () => {
            const terms = termsOf(field)
            chosenLabel.hidden = chosen.hidden = terms.length === 0
            chosen.replaceChildren(...terms.map(term => {
                const li = el("li")
                const remove = el("button", "cori-profile-chip-remove", "×")
                remove.type = "button"
                remove.title = "Entfernen"
                remove.setAttribute("aria-label", `„${labelOf(term)}" entfernen`)
                remove.addEventListener("click", () => removeTerm(field, term))
                li.append(el("span", null, labelOf(term)), remove)
                return li
            }))
        }
        const renderSuggestions = () => {
            const full = isFull(field)
            input.hidden = full
            // what is chosen sits above, under "Deine Auswahl"
            const open = full ? [] : (suggestions?.items ?? []).filter(item => !termFor(item))
            suggestCaption.hidden = suggestList.hidden = open.length === 0
            suggestCaption.textContent = suggestions?.caption ?? ""
            const visible = moreOpen ? open : open.slice(0, SUGGESTIONS_IN_VIEW)
            fill(suggestList, [
                ...visible.map(item => chip(item.label, { key: item.label, onClick: () => addHere(item) })),
                ...foldToggle(open.length - visible.length, "mehr", () => { moreOpen = true; renderSuggestions() }),
            ])
        }
        const renderRelated = () => {
            // this field's own neighbours move up once chosen; those of other fields
            // stay, switched on
            const items = (related?.items ?? []).filter(item => item.field !== field || !termFor(item))
            relatedCaption.hidden = relatedList.hidden = items.length === 0
            relatedCaption.textContent = related?.caption ?? ""
            fill(relatedList, items.map(item => chip(item.label, {
                // the badge names the field where it isn't this card's own
                kind: item.field !== field ? item.kind : null,
                pressed: Boolean(termFor(item)),
                key: `${item.field} ${item.label}`,
                onClick: () => toggleItem(item),
            })))
        }
        // Neighbours follow the value added last (on a fresh card: any chosen one); a
        // value removed takes its neighbours along.
        const followRelated = async () => {
            if (!source.related) return
            const terms = termsOf(field)
            const anchor = terms.find(term => labelOf(term) === lastAdded) ?? terms.at(-1)
            const key = anchor ? `${anchor.termType} ${anchor.value}` : null
            if (key === relatedFor) return renderRelated()
            relatedFor = key
            related = null
            renderRelated()
            if (!anchor) return
            const card = shown
            try {
                const found = await source.related(field, { object: anchor, label: labelOf(anchor) }, store)
                if (card !== shown || relatedFor !== key) return
                related = found ? { ...found, items: found.items.map(item => ({ field, ...item })) } : null
                renderRelated()
            } catch (err) {
                console.error("[cori-assistant] related values failed:", err)
            }
        }
        const refresh = () => { renderChosen(); renderSuggestions(); followRelated() }
        refresh()
        refreshers.push(refresh)

        const card = shown
        Promise.resolve(source.suggest?.(field, store)).then(found => {
            if (card !== shown || !found) return
            suggestions = { ...found, items: found.items.map(item => ({ field, ...item })) }
            renderSuggestions()
        }).catch(err => console.error("[cori-assistant] suggestions failed:", err))
        return { wrap, input, stop: () => clearTimeout(timer) }
    }

    function fieldCard(card) {
        const { field } = card
        hintEl.textContent = [source.hint?.(field, store), card.hint].filter(Boolean).join(" ")
        let focusFirst = null
        const choices = allowedValuesOf(field)
        if (choices) {
            bodyEl.appendChild(closedField(field, choices))
        } else {
            const view = openField(field)
            bodyEl.appendChild(view.wrap)
            leaveCard = view.stop
            focusFirst = view.input
        }
        // what the answers on this card do, kept up to date
        const previewEl = el("div", "cori-assistant-preview")
        bodyEl.appendChild(previewEl)
        let previews = 0
        const preview = async () => {
            if (!source.preview) return
            const run = ++previews
            const onCard = shown
            try {
                const node = await source.preview(field, store)
                if (run !== previews || onCard !== shown) return
                previewEl.replaceChildren(...(node ? [node] : []))
            } catch (err) {
                console.error("[cori-assistant] preview failed:", err)
            }
        }
        preview()
        refreshers.push(preview)
        return focusFirst
    }

    function show(i) {
        leaveCard?.()
        leaveCard = null
        refreshers = []
        shown++
        index = i
        const card = deck[i]
        bodyEl.replaceChildren()
        let focusFirst = null
        if (card.custom) {
            const text = value => (typeof value === "function" ? value(store, { alone: deck.length === 1 }) : value) ?? ""
            questionEl.textContent = text(card.custom.title)
            hintEl.textContent = text(card.custom.hint)
            leaveCard = card.custom.render(bodyEl) ?? null
            focusFirst = bodyEl.querySelector("input, button")
        } else {
            questionEl.textContent = card.title
            focusFirst = fieldCard(card)
        }
        hintEl.hidden = !hintEl.textContent
        const last = i === deck.length - 1
        progressEl.hidden = deck.length === 1
        dotsEl.replaceChildren(...deck.map((_, n) => el("span", n < i ? "is-done" : n === i ? "is-now" : "")))
        countEl.textContent = `${i + 1} von ${deck.length}`
        backBtn.hidden = i === 0
        nextBtn.hidden = last
        // one filled button per card: the way on, or out on the last one
        doneBtn.classList.toggle("button", last)
        ;(focusFirst ?? (last ? doneBtn : nextBtn)).focus()
    }

    // "Fertig" after a walk through several cards: what the profile gained since the
    // deck opened, and the app's way on. A single card, or a visit that added nothing,
    // just closes.
    async function finish() {
        if (deck.length === 1) return dialog.close()
        leaveCard?.()
        leaveCard = null
        refreshers = []
        shown++
        try {
            store = await loadStore()
        } catch {
            return dialog.close()
        }
        const now = new Map()
        for (const q of store.getQuads(subject, null, null, null)) {
            now.set(q.predicate.value, (now.get(q.predicate.value) ?? 0) + 1)
        }
        const gains = [...now]
            .map(([field, count]) => ({ field, gain: count - (countsAtOpen.get(field) ?? 0) }))
            .filter(g => g.gain > 0 && getLabel(g.field))
        if (gains.length === 0) return dialog.close()
        questionEl.textContent = "Dein Profil ist gewachsen"
        hintEl.hidden = true
        const list = el("ul", "cori-assistant-gains")
        list.append(...gains.map(({ field, gain }) => {
            const li = el("li")
            li.append(el("strong", null, String(gain)), ` ${nameOf(field, gain)}`)
            return li
        }))
        bodyEl.replaceChildren(el("p", "cori-assistant-label", "Neu dazugekommen"), list)
        if (source.finish?.text) bodyEl.appendChild(el("p", "cori-assistant-closing", source.finish.text))
        progressEl.hidden = true
        backBtn.hidden = true
        nextBtn.hidden = true
        const wayOn = source.finish?.label
        doneBtn.hidden = !wayOn
        doneBtn.classList.remove("button")
        doneBtn.textContent = "Schließen"
        const go = el("button", "cori-assistant-go button", wayOn ?? "Schließen")
        go.type = "button"
        go.addEventListener("click", () => {
            dialog.close()
            if (wayOn) source.finish.action?.()
        })
        doneBtn.after(go)
        doneBtn.onclick = () => dialog.close()
        go.focus()
    }

    backBtn.addEventListener("click", () => show(index - 1))
    nextBtn.addEventListener("click", () => show(index + 1))
    doneBtn.onclick = finish
    dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close() })
    dialog.addEventListener("close", () => {
        leaveCard?.()
        dialog.remove()
    })

    dialog.showModal()
    show(0)
}
