// "scan pod": an optional step after connecting a pod. The pod may already hold data
// other apps put there, so instead of starting from an empty profile we look for facts
// bib-pods can use and report what we found.
// A scan is a set of independent routines, each responsible for one kind of finding
import { loadStore, getStorageEntryName } from "cori-sdk/storage/index.js"


async function scanProfile() {
    const filename = getStorageEntryName()
    const store = await loadStore()
    if (store.size > 0) {
        console.log(`[bib-pods] scan: ${filename} ist schon im Pod: ${store.size} Aussagen`)
    } else {
        console.log(`[bib-pods] scan: noch keine Daten in ${filename}`)
    }
}

// TODO
async function scanWuppertal() {
    console.log("[bib-pods] scan: Wuppertal-Demo (TODO)")
}

const ROUTINES = [
    { label: "Profil", run: scanProfile },
    { label: "Wuppertal", run: scanWuppertal },
]

export async function scanPod() {
    console.log(`[bib-pods] scan: ${ROUTINES.length} Routine(n) starten`)
    await Promise.all(ROUTINES.map(async ({ label, run }) => {
        try {
            await run()
        } catch (err) {
            console.error(`[bib-pods] scan: Routine „${label}" fehlgeschlagen:`, err)
        }
    }))
    console.log("[bib-pods] scan: fertig")
}
