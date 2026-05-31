#!/usr/bin/env node
// Converts each given .ttl into a sibling <name>.ttl.js
// Exposed as a `bin`, so any package depending on cori-sdk gets a `ttl-to-js` command:
//
//   ttl-to-js definitions/vocabulary.ttl definitions/config.ttl
//
// Dev note: a running `vite build --watch` tracks the generated .ttl.js, not the
// source .ttl. After editing a .ttl, re-run `npm run ttl-to-js`
// so the watcher sees the change and rebuilds.
import { readFileSync, writeFileSync } from "fs"
import { resolve } from "path"

for (const rel of process.argv.slice(2)) {
    const path = resolve(process.cwd(), rel)
    const ttl = readFileSync(path, "utf8")
    writeFileSync(path + ".js",
        `// GENERATED from ${rel} — do not edit.\nexport default ${JSON.stringify(ttl)}\n`)
    console.log(`ttl-to-js: wrote ${rel}.js`)
}
