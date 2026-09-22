// Bundle the shared scan vocabulary and every source rule file for browser and
// Node consumers. Keep documents separate so prefixes and blank nodes stay local.
import { readdir, readFile, writeFile } from "node:fs/promises"

const definitions = new URL("../definitions/", import.meta.url)
const entries = await readdir(new URL("scan-rules/", definitions), { withFileTypes: true })
const ruleFiles = entries
    .filter(entry => entry.isFile() && entry.name.endsWith(".ttl"))
    .map(entry => "scan-rules/" + entry.name)
    .sort()
const files = ["scan-vocabulary.ttl", ...ruleFiles]
const documents = await Promise.all(files.map(file => readFile(new URL(file, definitions), "utf8")))
await writeFile(new URL("scan-rules.ttl.js", definitions),
    `// GENERATED from ${files.join(", ")} — do not edit.\nexport default ${JSON.stringify(documents)}\n`)
console.log(`build-scan-rules: bundled scan vocabulary and ${ruleFiles.length} source rule file(s)`)
