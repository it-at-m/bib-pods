#!/usr/bin/env node
// Snapshot the branch accordions under "Unsere Standorte", including collapsed ones.
// Run: npm run extract-msb-standorte [-- saved-page.html]

import { readFile, writeFile } from "node:fs/promises"
import { load } from "cheerio"

const SOURCE = "https://www.muenchner-stadtbibliothek.de/orte-zeiten"
const MSB = new URL("/", SOURCE).href
const OUTPUT = new URL("../definitions/msb-standorte.ttl", import.meta.url)
const NOMINATIM = process.env.NOMINATIM_ENDPOINT || "https://nominatim.openstreetmap.org/search"
const clean = text => text.replace(/\s+/g, " ").trim()

let html
if (process.argv[2]) {
    html = await readFile(process.argv[2], "utf8")
} else {
    const response = await fetch(SOURCE, { signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error(`MSB: HTTP ${response.status}`)
    html = await response.text()
}
const $ = load(html)
const section = $("h2").filter((_, el) => clean($(el).text()) === "Unsere Standorte").closest("section")
if (section.length !== 1) throw new Error('Could not identify the "Unsere Standorte" section.')

const branches = section.find(".accordeon-container > .frame").toArray().map(el => {
    const card = $(el)
    // The trailing asterisk refers to the page's Open Library footnote.
    const name = clean(card.find("h3").text()).replace(/\*$/, "").trim()
    const more = card.find("a.button").filter((_, a) => clean($(a).text()) === "Mehr")
    const contact = card.find(".msb-content-teaser__text p").first().clone()
    contact.find("br").replaceWith("\n")
    const lines = contact.text().split("\n").map(clean).filter(Boolean)
    if (!name || more.length !== 1 || !more.attr("href") || !lines.length) {
        throw new Error(`Incomplete branch card: ${name || "unnamed"}`)
    }
    // The first contact line is a street with house number, or a closure notice.
    const street = /\d/.test(lines[0]) && !/^Tel\./i.test(lines[0]) ? lines.shift() : null
    const note = lines.filter(line => !/^Tel\./i.test(line)).join(" ")
    const url = new URL(more.attr("href"), SOURCE).href
    return { name, street, note, url }
})
if (!branches.length || new Set(branches.map(b => b.url)).size !== branches.length) {
    throw new Error("No branches found, or duplicate branch links; snapshot not written.")
}

// Look up every address afresh, sequentially at less than one request per second.
async function lookup(params) {
    const query = new URL(NOMINATIM)
    query.search = new URLSearchParams({ ...params, countrycodes: "de", format: "jsonv2", addressdetails: "1", limit: "1" })
    await new Promise(resolve => setTimeout(resolve, 1100))
    const response = await fetch(query, {
        headers: { "User-Agent": "bib-pods-branch-extractor/1.0 (+https://github.com/it-at-m/bib-pods)" },
        signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) throw new Error(`Nominatim: HTTP ${response.status}`)
    const [result] = await response.json()
    return result
}
for (const branch of branches.filter(b => b.street)) {
    // Keep the source address unchanged in Turtle; tidy abbreviations for the lookup.
    const street = branch.street.split(" / ")[0].replace(/str\.\s*/gi, "straße ").replace(/(\d)\s+([a-z])$/i, "$1$2")
    let result = await lookup({ street, city: "München" })
    // OSM sometimes lists the library under a different street name.
    if (!result?.address?.house_number) {
        const library = await lookup({ q: `Stadtbibliothek ${branch.name}, München` })
        if (library?.type === "library" && library.address?.city === "München"
            && library.name.toLowerCase().includes(branch.name.toLowerCase())) {
            result = library
            console.log(`${branch.name}: matched library by name (${library.display_name})`)
        }
    }
    const lat = parseFloat(result?.lat), lon = parseFloat(result?.lon)
    // A street/city centre is not precise enough to locate a branch.
    if (!result?.address?.house_number || !Number.isFinite(lat) || !Number.isFinite(lon)) {
        console.error(`No building-level coordinates: ${branch.name} (${branch.street})`)
        process.exitCode = 1
        continue
    }
    branch.lat = lat
    branch.lon = lon
    console.log(`${branch.name}: ${lat}, ${lon}`)
}

const entries = branches.map(({ name, street, note, url, lat, lon }) => {
    const local = url.startsWith(MSB) ? url.slice(MSB.length) : ""
    const iri = /^[a-z][a-z0-9-]*$/i.test(local) ? `msb:${local}` : `<${url}>`
    const properties = [
        "a schema:Library",
        `schema:name ${JSON.stringify(name)}@de`,
        `schema:url ${iri}`,
    ]
    if (street) properties.push(
        `schema:streetAddress ${JSON.stringify(street)}`,
        'schema:addressLocality "München"',
    )
    if (note) properties.push(`schema:description ${JSON.stringify(note)}@de`)
    if (lat !== undefined) properties.push(`schema:latitude ${lat}`, `schema:longitude ${lon}`)
    return `${iri}\n    ${properties.join(" ;\n    ")} .`
})
const turtle = `# GENERATED by scripts/extract-msb-standorte.js — edit the script, not this file.
# Source: ${SOURCE} (Unsere Standorte accordions only)
# Snapshot: ${new Date().toISOString().slice(0, 10)}
# Streets and contact notes are copied from the page; the city follows its Munich scope.
# Postcodes are not supplied. Contact notes are not a complete record of current closures.
# Coordinates: Nominatim / OpenStreetMap contributors (ODbL), https://www.openstreetmap.org/copyright

@prefix schema: <https://schema.org/> .
@prefix msb: <${MSB}> .

${entries.join("\n\n")}
`
await writeFile(OUTPUT, turtle)
console.log(`Wrote ${branches.length} branches to ${OUTPUT.pathname}`)
for (const branch of branches.filter(b => !b.street)) console.warn(`No street address on source page: ${branch.name}`)
