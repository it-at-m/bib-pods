import { loadConfig } from "bib-src/src/build-config.js"
import { emitRefreshWorker } from "cori-sdk/refresh-worker-plugin.js"
import { defineConfig } from "vite"

const config = loadConfig()

export default defineConfig({
    plugins: [emitRefreshWorker],
    define: {
        __SOLR_ENDPOINT__: JSON.stringify(config.solrEndpoint),
    },
    build: {
        outDir: "plugin/dist",
        lib: {
            entry: "plugin/src/main.js",
            formats: ["es"],
            fileName: () => "bundle.js",
        },
        rollupOptions: {
            output: {
                inlineDynamicImports: true,
            },
        },
    },
})
