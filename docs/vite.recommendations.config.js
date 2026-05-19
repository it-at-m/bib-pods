import { defineConfig } from "vite"

export default defineConfig({
    build: {
        outDir: "recommendations/dist",
        emptyOutDir: true,
        lib: {
            entry: "recommendations/src/main.js",
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
