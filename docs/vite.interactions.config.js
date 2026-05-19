import { defineConfig } from "vite"

export default defineConfig({
    build: {
        outDir: "interactions/dist",
        emptyOutDir: true,
        lib: {
            entry: "interactions/src/main.js",
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
