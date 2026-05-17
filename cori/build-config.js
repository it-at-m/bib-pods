import { parser } from "@foerderfunke/sem-ops-utils"
import { readFileSync } from "fs"

const BP = "https://www.muenchner-stadtbibliothek.de/bib-pods#"

export function loadConfig() {
    const ttl = readFileSync(new URL("../definitions/config.ttl", import.meta.url), "utf8")
    const quads = parser.parse(ttl)

    const lookup = (predicate) => quads.find(q => q.predicate.value === BP + predicate).object.value

    return {
        solrEndpoint: lookup("solrEndpoint"),
        mainPath: lookup("mainPath"),
    }
}
