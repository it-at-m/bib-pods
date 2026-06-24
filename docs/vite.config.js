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
                recommendations: "recommendations/src/main.js",
                interactions: "interactions/src/main.js",
                search: "search/src/main.js",
            },
            // Keep re-exports from recommendations/interactions entries —
            // their index.html scripts import named bindings off the bundle.
            preserveEntrySignatures: "strict",
            output: {
                format: "es",
                entryFileNames: "[name].js",
                chunkFileNames: "chunks/[name]-[hash].js",
            },
        },
    },
})
