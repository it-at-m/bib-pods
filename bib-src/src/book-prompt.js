import { BP, getFollowUpsFor, LOCAL, NO_IRI } from "./vocab.js"
import { addInquiryFacts } from "cori-sdk/storage/index.js"
import bookPromptHtml from "./ui/book-prompt.html?raw"
import { RDFS_LABEL } from "cori-sdk/utils.js"

export function installBookPrompt(root, { onSaved } = {}) {
    const bookHost = document.createElement("div")
    bookHost.innerHTML = bookPromptHtml
    const bookDialog = bookHost.firstElementChild
    root.appendChild(bookDialog)

    const bookTitleEl = bookDialog.querySelector("#bp-book-title")
    const bookFallbackEl = bookDialog.querySelector("#bp-book-fallback")
    const bookSectionsEl = bookDialog.querySelector("#bp-book-sections")
    const bookMerklisteBox = bookDialog.querySelector("#bp-book-merkliste")
    const bookCancelBtn = bookDialog.querySelector("#bp-book-cancel")
    const bookSaveBtn = bookDialog.querySelector("#bp-book-save")
    let currentSopacId = null
    let currentEntries = []

    bookCancelBtn.addEventListener("click", () => bookDialog.close())
    bookDialog.addEventListener("click", (e) => {
        if (e.target === bookDialog) bookDialog.close()
    })
    bookSaveBtn.addEventListener("click", async () => {
        if (!currentSopacId) return
        const facts = []
        if (bookMerklisteBox.checked) {
            facts.push({ predicate: BP + "savedBook", object: currentSopacId })
        }
        for (const { predicate, cleanedLabel, rawLabel, iri, checkbox } of currentEntries) {
            if (!checkbox.checked) continue
            const wasCleaned = rawLabel !== cleanedLabel
            if (iri) {
                // authority IRI is the source of truth, we store however the cleaned label locally
                facts.push({ predicate, object: iri })
                facts.push({ subject: iri, predicate: RDFS_LABEL, object: cleanedLabel })
            } else if (wasCleaned) {
                // no authority IRI, mint a local URN so the entity has a graph node to attach facts to
                const localUri = LOCAL + "author:" + encodeURIComponent(rawLabel)
                facts.push({ predicate, object: localUri })
                facts.push({ subject: localUri, predicate: RDFS_LABEL, object: cleanedLabel })
                facts.push({ subject: localUri, predicate: BP + "sourceLabel", object: rawLabel })
            } else {
                // no IRI, rawLabel === cleanedLabel, nothing to preserve, store as plain literal
                facts.push({ predicate, object: cleanedLabel })
            }
        }
        if (facts.length === 0) {
            bookDialog.close()
            return
        }
        try {
            await addInquiryFacts(facts)
            bookDialog.close()
            onSaved?.()
        } catch (err) {
            console.error("[bib-pods] addInquiryFacts failed:", err)
        }
    })

    return async function openBookPrompt(sopacId, book) {
        currentSopacId = sopacId
        currentEntries = []
        bookTitleEl.textContent = book?.title?.[0] ?? sopacId
        bookFallbackEl.hidden = book !== null
        bookFallbackEl.textContent = "Buchdaten konnten gerade nicht geladen werden — du kannst das Buch trotzdem speichern."
        bookMerklisteBox.checked = true
        bookSectionsEl.innerHTML = ""
        if (book) {
            for (const spec of await getFollowUpsFor(BP + "BookSelection")) {
                const items = collectBookItems(spec, book)
                if (items.length === 0) continue
                const { section, entries } = buildBookSection(spec, items)
                bookSectionsEl.appendChild(section)
                currentEntries.push(...entries)
            }
        }
        bookDialog.showModal()
    }
}

// MARC 100 author strings arrive as "Lastname, Firstname YYYY-YYYY?"
// strip the trailing date range and swap the comma'd name to its natural order
function cleanAuthorName(s) {
    const withoutDates = s.replace(/\s+\d{4}-\d{0,4}\s*$/, "").trim()
    const comma = withoutDates.indexOf(",")
    if (comma === -1) return withoutDates
    const last = withoutDates.slice(0, comma).trim()
    const first = withoutDates.slice(comma + 1).trim()
    return first ? `${first} ${last}` : last
}

// walk a follow-up spec against a book and return one { rawLabel, iri } item per value found.
function collectBookItems(spec, book) {
    const items = []
    for (const f of spec.fields) {
        const labels = book[f.labelField]
        if (!labels || labels.length === 0) continue
        const iris = f.iriField ? book[f.iriField] : null
        for (let i = 0; i < labels.length; i++) {
            const iri = iris?.[i]
            items.push({ rawLabel: labels[i], iri: iri === NO_IRI ? undefined : iri })
        }
    }
    return items
}

function buildBookSection(spec, items) {
    const section = document.createElement("div")
    const heading = document.createElement("p")
    heading.className = "bp-book-section-heading"
    heading.textContent = spec.label
    section.appendChild(heading)
    const clean = spec.property === BP + "favoriteAuthor" ? cleanAuthorName : (s) => s
    const entries = []
    for (const it of items) {
        const cleanedLabel = clean(it.rawLabel)
        const labelEl = document.createElement("label")
        labelEl.className = "bp-book-option"
        const checkbox = document.createElement("input")
        checkbox.type = "checkbox"
        labelEl.appendChild(checkbox)
        labelEl.appendChild(document.createTextNode(" " + cleanedLabel))
        section.appendChild(labelEl)
        entries.push({ predicate: spec.property, cleanedLabel, rawLabel: it.rawLabel, iri: it.iri, checkbox })
    }
    return { section, entries }
}
