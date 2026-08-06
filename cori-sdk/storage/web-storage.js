// Shared implementation for Web Storage backends. localStorage and sessionStorage
// expose the identical Storage API and differ only in lifetime (persistent vs.
// per-tab), so each backend is this builder bound to one Storage object plus a
// key namespace and a human-readable label.
import { parseTurtle, serializeTurtle } from "../utils.js"
import { getStorageConfig } from "./index.js"

const DEBUG = true

export function createWebStorageBackend({ storage, kind, info }) {
    const key = () => `${getStorageConfig().appName}.${kind}.ttl`
    // Append-only documents (the provenance log) get their own key alongside the
    // profile's, named after the filename a pod would give them.
    const docKey = (filename) => `${getStorageConfig().appName}.${kind}.${filename}`

    return {
        isReady: () => true,

        async warmup() {
            const k = key()
            const text = storage.getItem(k)
            if (DEBUG) {
                if (text) console.log(`[cori] ${kind}: using existing entry "${k}" (${text.length} chars)`)
                else console.log(`[cori] ${kind}: no entry "${k}" yet, will be created on first write`)
            }
        },

        load: async () => parseTurtle(storage.getItem(key()) ?? ""),

        save: async (store) => storage.setItem(key(), await serializeTurtle(store)),

        // Text rather than a store: the caller owns the serialization. It is handed
        // what is stored and returns only its own new text.
        async appendDoc(filename, chunkFor) {
            const existing = storage.getItem(docKey(filename)) ?? ""
            storage.setItem(docKey(filename), existing + await chunkFor(existing))
        },

        getInfo: () => ({ Speicherung: info }),

        getEntryName: () => key(),
    }
}
