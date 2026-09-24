// "scan pod": an optional step after connecting a pod. The pod may already hold data
// other apps put there, so instead of starting from an empty profile we look for facts
// bib-pods can use and report what we found.
// A scan is a set of independent routines, each responsible for one kind of finding
import { loadStore, getStorageEntryName, getChoice, isStorageReady } from "cori-sdk/storage/index.js"
import { readPodTurtle } from "cori-sdk/storage/solid.js"
import { getProfileSubject, serializeTurtle } from "cori-sdk/utils.js"
import { newStore } from "@foerderfunke/sem-ops-utils/core"
import { getScanSources, matchesScanSource, applyScanRules, scanLabel } from "./scan-rules.js"


async function scanProfile() {
    const filename = getStorageEntryName()
    const store = await loadStore()
    if (store.size > 0) {
        console.log(`[bib-pods] scan: ${filename} ist schon im Pod: ${store.size} Aussagen`)
    } else {
        console.log(`[bib-pods] scan: noch keine Daten in ${filename}`)
    }
}

async function scanSource(source) {
    if (getChoice() !== "solid" || !isStorageReady()) {
        console.log(`[bib-pods] scan: ${source.label} benötigt einen verbundenen Pod`)
        return null
    }
    const document = await readPodTurtle(source.path)
    if (!document) {
        console.log(`[bib-pods] scan: ${source.label} nicht im Pod gefunden`)
        return null
    }
    if (!await matchesScanSource(source, document.store)) {
        console.log(`[bib-pods] scan: ${document.url} enthält keine erkennbaren Ergebnisse im Format „${source.label}“; Regelsatz „${source.ruleSet.label}“ wird übersprungen.`)
        return null
    }

    const findings = await applyScanRules(source, document.store)
    const additions = newStore()
    for (const finding of findings) additions.addQuads(finding.quads)
    const additionsTtl = await serializeTurtle(additions)
    // Keep each source's explanation and findings together, even when scans run concurrently.
    console.log(`[bib-pods] scan: Daten im Format „${source.label}“ gefunden: ${document.url}`)
    console.log(`[bib-pods] scan: Erkannt an: ${source.formatDescription}.`)
    console.log(`[bib-pods] scan: Daher verwenden wir den vordefinierten Regelsatz „${source.ruleSet.label}“ für diese Vorschau.`)
    console.log("[bib-pods] scan: Mit deiner Zustimmung würden wir die folgenden Vorschläge in dein Bibliotheksprofil übernehmen:")
    console.table(findings.flatMap(finding => finding.quads
        .filter(q => q.subject.value === getProfileSubject())
        .map(({ predicate, object }) => ({
            Aktion: scanLabel(finding.action),
            Regel: finding.label,
            Profilpunkt: scanLabel(predicate.value),
            Wert: object.termType === "NamedNode" ? scanLabel(object.value, finding.quads) : object.value,
        }))))
    console.log("[bib-pods] scan: Das würden wir jetzt zu deinem Profil hinzufügen, wenn du zustimmst:")
    console.log(additionsTtl)
    console.log("[bib-pods] scan: Vorschau erstellt; noch nichts übernommen. Eine Übernahme benötigt deine Zustimmung.")
    return {
        source: document.url,
        scanSource: source.iri,
        sourceLabel: source.label,
        ruleSet: source.ruleSet.iri,
        ruleSetLabel: source.ruleSet.label,
        findings,
    }
}

export async function scanPod() {
    const routines = [
        { label: "Profil", run: scanProfile },
        ...getScanSources().map(source => ({ label: source.label, run: () => scanSource(source) })),
    ]
    console.log(`[bib-pods] scan: ${routines.length} Routine(n) starten`)
    const results = await Promise.all(routines.map(async ({ label, run }) => {
        try {
            return { label, result: await run() }
        } catch (err) {
            console.error(`[bib-pods] scan: Routine „${label}" fehlgeschlagen:`, err)
            return { label, error: err }
        }
    }))
    console.log("[bib-pods] scan: fertig")
    return results
}
