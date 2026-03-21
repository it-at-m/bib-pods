import { defineConfig } from "vite"

export default defineConfig({
  build: {
    outDir: "dist",
    lib: {
      entry: "main.js",
      formats: ["es"],
      fileName: "bundle"
    },
    rollupOptions: {
      external: [],
      output: {
        manualChunks: undefined,
        inlineDynamicImports: true,
      }
    }
  }
})
