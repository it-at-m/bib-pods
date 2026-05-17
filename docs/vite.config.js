import { loadConfig } from "cori/build-config.js"
import { defineConfig } from "vite"

const config = loadConfig()

export default defineConfig({
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
