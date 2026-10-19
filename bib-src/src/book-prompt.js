import { BP, getFollowUpsFor } from "./vocab.js"
import { addInquiryFacts, changeProfileFacts, loadStore } from "cori-sdk/storage/index.js"
import { getVocab, getProfileSubject, storageErrorMessage } from "cori-sdk/utils.js"
import { collectOptions, valueFacts, profileValuesFor, dismissalChanges } from "./book-options.js"
import bookPromptHtml from "./ui/book-prompt.html?raw"

// „Buch merken“: what the user likes about a book goes into their profile.
export function installBookPrompt(root, { onSaved } = {}) {
    return installPrompt(root, {
        action: BP + "BookSelection",
        heading: "Was gefällt dir an diesem Buch?",
        titleText: "Zu meiner Merkliste hinzufügen",
        fallbackText: "Buchdaten konnten gerade nicht geladen werden — du kannst das Buch trotzdem speichern.",
        save: ({ sopacId, title, titleProperty, options }) => addInquiryFacts([
            ...(title ? [{ predicate: titleProperty, object: sopacId }] : []),
            ...options.flatMap(({ spec, option }) => valueFacts(spec.property, option)),
        ]),
        onSaved,
    })
}

// „Nicht mehr vorschlagen“: what the user doesn't want suggested is blocked, and
// removed from the profile where it is a taste (see dismissalChanges).
export function installDismissPrompt(root, { onSaved } = {}) {
    return installPrompt(root, {
        action: BP + "BookDismissal",
        heading: "Was gefällt dir an diesem Buch nicht?",
        titleText: "Diesen Titel nicht mehr vorschlagen",
        fallbackText: "Buchdaten konnten gerade nicht geladen werden — du kannst den Titel trotzdem ausblenden.",
        note: (spec, option, store) => profileValuesFor(spec, option, store, getProfileSubject()).length > 0
            ? "wird auch aus deinem Profil entfernt" : null,
        save: async chosen => changeProfileFacts(dismissalChanges(chosen, await loadStore(), getProfileSubject())),
        onSaved,
    })
}

// Both dialogs follow their cori:UserAction in the vocabulary: a pre-ticked checkbox for
// the title itself (bp:addsTitleTo), then one per value the book carries for each
// follow-up question (bp:followUpQuestion). `note` annotates an option and needs the
// profile, which is then loaded on open; onSaved receives what was chosen.
function installPrompt(root, { action, heading, titleText, fallbackText, note, save, onSaved }) {
    const host = document.createElement("div")
    host.innerHTML = bookPromptHtml
    const dialog = host.firstElementChild
    root.appendChild(dialog)
    dialog.setAttribute("aria-label", heading)
    dialog.querySelector(".bp-book-heading").textContent = heading
    dialog.querySelector(".bp-book-title-text").textContent = titleText
    const titleEl = dialog.querySelector(".bp-book-title")
    const fallbackEl = dialog.querySelector(".bp-book-fallback")
    const sectionsEl = dialog.querySelector(".bp-book-sections")
    const titleBox = dialog.querySelector(".bp-book-title-box")
    const titleProperty = getVocab().getObjects(action, BP + "addsTitleTo", null)[0].value
    let current = null      // { sopacId, options: [{ spec, option, checkbox }] }

    dialog.querySelector(".bp-book-cancel").addEventListener("click", () => dialog.close())
    dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close() })
    dialog.querySelector(".bp-book-save").addEventListener("click", async () => {
        if (!current) return
        const chosen = {
            sopacId: current.sopacId,
            title: titleBox.checked,
            titleProperty,
            options: current.options.filter(o => o.checkbox.checked).map(({ spec, option }) => ({ spec, option })),
        }
        if (!chosen.title && chosen.options.length === 0) return dialog.close()
        try {
            await save(chosen)
            dialog.close()
            onSaved?.(chosen)
        } catch (err) {
            console.error("[bib-pods] saving the book dialog failed:", err)
            window.alert("Speichern fehlgeschlagen:\n" + storageErrorMessage(err))
        }
    })

    return async function open(sopacId, book) {
        current = { sopacId, options: [] }
        titleEl.textContent = book?.title?.[0] ?? sopacId
        fallbackEl.hidden = book !== null
        fallbackEl.textContent = fallbackText
        titleBox.checked = true
        sectionsEl.replaceChildren()
        if (book) {
            const store = note ? await loadStore() : null
            for (const spec of await getFollowUpsFor(action)) {
                const options = collectOptions(spec, book)
                if (options.length === 0) continue
                const section = document.createElement("div")
                const sectionHeading = document.createElement("p")
                sectionHeading.className = "bp-book-section-heading"
                sectionHeading.textContent = spec.label
                section.appendChild(sectionHeading)
                for (const option of options) {
                    const label = document.createElement("label")
                    label.className = "bp-book-option"
                    const checkbox = document.createElement("input")
                    checkbox.type = "checkbox"
                    label.append(checkbox, " " + option.cleanedLabel)
                    const text = note?.(spec, option, store)
                    if (text) {
                        const noteEl = document.createElement("span")
                        noteEl.className = "bp-book-note"
                        noteEl.textContent = `(${text})`
                        label.append(" ", noteEl)
                    }
                    section.appendChild(label)
                    current.options.push({ spec, option, checkbox })
                }
                sectionsEl.appendChild(section)
            }
        }
        dialog.showModal()
    }
}
