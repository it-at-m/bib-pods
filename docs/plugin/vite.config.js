import { parser } from "@foerderfunke/sem-ops-utils"
import { defineConfig } from "vite"
import { readFileSync } from "fs"

const BP = "https://www.muenchner-stadtbibliothek.de/bib-pods#"
const quads = parser.parse(readFileSync("../../definitions/config.ttl", "utf8"))
const lookup = (predicate) => quads.find(q => q.predicate.value === BP + predicate).object.value

export default defineConfig({
    define: {
        __SOLR_ENDPOINT__: JSON.stringify(lookup("solrEndpoint")),
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
