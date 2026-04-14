import { defineConfig } from "vite"

export default defineConfig({
    build: {
        outDir: "Resources/Public/JavaScript",
        emptyOutDir: false,
        lib: {
            entry: "src/main.js",
            formats: ["es"],
            fileName: () => "bundle.js"
        }
    }
})
