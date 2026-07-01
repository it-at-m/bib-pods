import { emitRefreshWorker } from "cori-sdk/refresh-worker-plugin.js"
import { loadConfig } from "bib-src/src/build-config.js"
import { defineConfig } from "vite"

const config = loadConfig()

export default defineConfig({
    plugins: [emitRefreshWorker],
    define: {
        __SOLR_ENDPOINT__: JSON.stringify(config.solrEndpoint),
        __QDRANT_ENDPOINT__: JSON.stringify(config.qdrantEndpoint),
    },
    build: {
        outDir: "dist",
        emptyOutDir: true,
        rollupOptions: {
            input: {
                plugin: "plugin/src/main.js",
                example: "example/src/main.js",
                recommendations: "recommendations/src/main.js",
                interactions: "interactions/src/main.js",
                search: "search/src/main.js",
                "parking-lot": "parking-lot/src/main.js",
            },
            // Keep re-exports from recommendations/interactions entries —
            // their index.html scripts import named bindings off the bundle.
            preserveEntrySignatures: "strict",
            output: {
                format: "es",
                entryFileNames: "[name].js",
                // Keep shared chunks at the dist root (not a chunks/ subdir): cori-sdk's
                // solid.js resolves the SharedWorker via `new URL("RefreshWorker.js",
                // import.meta.url)`, which only finds the emitted dist/RefreshWorker.js
                // when the calling code sits beside it. A subdir would 404 the worker and
                // hang session.restore() (and thus the whole widget mount).
                // (Letting Vite resolve the worker natively via `?url` isn't an option:
                // the @uvdsl package doesn't export the worker as a subpath, and lib-mode
                // TYPO3 would inline it as an origin-less data: URL — hence the manual
                // emitRefreshWorker plugin + this co-location.)
                chunkFileNames: "[name]-[hash].js",
            },
        },
    },
})
