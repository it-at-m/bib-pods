import { harvest } from "./oai-lib.js"
import path from "path"

/*
DE-M36: Gesamtbestand
DE-M36b: Musikbibliothek
DE-M36c: Juristische Bibliothek
DE-M36d: Philatelistische Bibliothek
DE-M36e: Monacensia Bibliothek
*/

await harvest({
    outDir: path.join(import.meta.dirname, "data"),
})
