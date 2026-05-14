import { loadConfig } from "cori/build-config.js"
import { defineConfig } from "vite"

const config = loadConfig()

export default defineConfig({
    define: {
        __SOLR_ENDPOINT__: JSON.stringify(config.solrEndpoint),
        __MAIN_PATH__: JSON.stringify(config.mainPath),
    },
    build: {
        outDir: "Resources/Public/JavaScript",
        emptyOutDir: false,
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
