import { readFileSync } from "fs"
import { fileURLToPath } from "url"

// Emit @uvdsl's RefreshWorker.js next to the bundle so the SharedWorker loads
// from a same-origin URL and shares storage with the page. Without this, Vite's
// library mode inlines workers as data: URLs — SharedWorker accepts those, but
// a data-URL worker has opaque origin and can't read the page's IndexedDB
// (where uvdsl stores the refresh token), so session.restore() silently fails
// on reload.
const WORKER_PATH = fileURLToPath(new URL(
    "./node_modules/@uvdsl/solid-oidc-client-browser/dist/esm/web/RefreshWorker.js",
    import.meta.url,
))

export const emitRefreshWorker = {
    name: "emit-uvdsl-refresh-worker",
    generateBundle() {
        this.emitFile({
            type: "asset",
            fileName: "RefreshWorker.js",
            source: readFileSync(WORKER_PATH, "utf8"),
        })
    },
}
