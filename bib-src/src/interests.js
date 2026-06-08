// "Interesse hinzufügen" picker shown directly below the profile. The category
// vocabulary is the GND-Systematik (GND-Sachgruppen): its 37 Hauptgruppen are a
// small, stable, closed set of subject categories, each a resolvable GND IRI.
//
// The vocabulary ships as a vendored snapshot (resources/gnd-sc.ttl, CC0 1.0):
// d-nb.info serves no CORS header, so it can't be fetched cross-origin at runtime,
// and bundling it keeps both hosts (docs, TYPO3) identical and offline-safe.
// Refresh by re-downloading https://d-nb.info/standards/vocab/gnd/gnd-sc.ttl.
//
// At install time the Turtle is loaded into an in-memory triple store and the top
// concepts are SELECTed — the same in-memory-SPARQL stack (sem-ops-utils → N3 +
// Comunica) the rest of the app already uses.
import { storeFromTurtles, sparqlSelect } from "@foerderfunke/sem-ops-utils"
import { addInquiryFacts } from "cori-sdk/storage/index.js"
import { RDFS_LABEL, storageErrorMessage } from "cori-sdk/utils.js"
import gndScTtl from "../resources/gnd-sc.ttl?raw"

// Placeholder interest predicate for now — not yet in the bp: vocabulary/shapes.
const EX_HAS_INTEREST = "http://example.org/hasInterest"

// The scheme links its main groups via skos:hasTopConcept. The German prefLabel is
// the display text; the concept IRI (…/gnd-sc#12*) is the value we keep.
const TOP_CONCEPTS_QUERY = `
    PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
    SELECT ?concept ?notation ?label WHERE {
        ?scheme skos:hasTopConcept ?concept .
        ?concept skos:notation ?notation ;
                 skos:prefLabel ?label .
        FILTER(lang(?label) = "de")
    }`

async function loadCategories() {
    const store = storeFromTurtles([gndScTtl])
    const rows = await sparqlSelect(TOP_CONCEPTS_QUERY, [store])
    // Order by Hauptgruppe number; the trailing "*" only marks the group level.
    return rows
        .map(r => ({ iri: r.concept, label: r.label, order: parseInt(r.notation, 10) || 0 }))
        .sort((a, b) => a.order - b.order)
}

function placeholderOption(text) {
    const opt = new Option(text, "", true, true)
    opt.disabled = true
    return opt
}

// Inserts the picker once, directly after `profileEl`. Living inside the profile's
// bp-when-activated section, it shows/hides with activation automatically. onAdded
// (cockpit's applyState) refreshes the profile view after a write.
export async function installInterestPicker(profileEl, { onAdded } = {}) {
    if (profileEl.nextElementSibling?.classList.contains("bp-add-interest")) return

    const wrap = document.createElement("div")
    wrap.className = "bp-add-interest"

    const label = document.createElement("label")
    label.htmlFor = "bp-interest-select"
    label.textContent = "Interesse hinzufügen"

    const select = document.createElement("select")
    select.id = "bp-interest-select"
    select.add(placeholderOption("Lädt …"))

    // On pick: store the category as ex:hasInterest <iri> plus an rdfs:label (so the
    // entity has a human-readable name). ex:hasInterest is a placeholder predicate for
    // now. Then snap back to the placeholder so another entry can be chosen.
    select.addEventListener("change", async () => {
        if (!select.value) return
        const iri = select.value
        const text = select.selectedOptions[0].text
        select.disabled = true
        try {
            await addInquiryFacts([
                { predicate: EX_HAS_INTEREST, object: iri },
                { subject: iri, predicate: RDFS_LABEL, object: text },
            ])
            onAdded?.()
        } catch (err) {
            console.error("[bib-pods] add interest failed:", err)
            window.alert("Speichern fehlgeschlagen:\n" + storageErrorMessage(err))
        } finally {
            select.disabled = false
            select.selectedIndex = 0
        }
    })

    wrap.append(label, select)
    profileEl.insertAdjacentElement("afterend", wrap)

    try {
        const categories = await loadCategories()
        select.replaceChildren(placeholderOption("Kategorie auswählen …"))
        for (const c of categories) select.add(new Option(c.label, c.iri))
    } catch (err) {
        console.error("[bib-pods] interest categories failed to load:", err)
        select.replaceChildren(placeholderOption("Kategorien nicht verfügbar"))
    }
}
