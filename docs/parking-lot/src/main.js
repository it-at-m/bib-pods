import { loadGndCategories } from "bib-src/src/gnd-categories.js"

const select = document.getElementById("pl-gnd-select")
const output = document.getElementById("pl-gnd-output")

function placeholderOption(text) {
    const opt = new Option(text, "", true, true)
    opt.disabled = true
    return opt
}

// No storage, no profile — picking an entry links its IRI straight to the block that
// defines it in our vendored copy of gnd-sc.ttl.
select.addEventListener("change", () => {
    if (!select.value) return
    const link = document.createElement("a")
    link.href = select.selectedOptions[0].dataset.sourceUrl
    link.target = "_blank"
    link.rel = "noopener"
    link.textContent = select.value
    output.replaceChildren(link)
})

async function loadOptions() {
    try {
        const categories = await loadGndCategories()
        select.replaceChildren(placeholderOption("Kategorie wählen"))
        for (const c of categories) {
            const opt = new Option(c.label, c.iri)
            opt.dataset.sourceUrl = c.sourceUrl
            select.add(opt)
        }
    } catch (err) {
        console.error("[bib-pods] GND categories failed to load:", err)
        select.replaceChildren(placeholderOption("Kategorien nicht verfügbar"))
    }
}

loadOptions()
