import { parser } from "@foerderfunke/sem-ops-utils/core"
import { readFileSync } from "fs"

const BP = "https://www.muenchner-stadtbibliothek.de/bib-pods#"
const DEV = true

export function loadConfig() {
    const ttl = readFileSync(new URL("../definitions/config.ttl", import.meta.url), "utf8")
    const quads = parser.parse(ttl)

    const lookup = (iri) => quads.find(q => q.predicate.value === iri).object.value

    return {
        solrEndpoint: lookup(BP + (DEV ? "solrEndpointDev" : "solrEndpoint")),
        mainPath: lookup(BP + "mainPath"),
    }
}
