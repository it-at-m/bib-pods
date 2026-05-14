import { loadConfig } from "cori/build-config.js"
import { defineConfig } from "vite"

const config = loadConfig()

export default defineConfig({
    define: {
        __SOLR_ENDPOINT__: JSON.stringify(config.solrEndpoint),
        __SOLID_POD_SUGGESTIONS__: JSON.stringify(config.solidPodSuggestions),
    },
    build: {
        outDir: "dist",
        lib: {
            entry: "src/main.js",
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
