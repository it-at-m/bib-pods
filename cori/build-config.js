import { parser } from "@foerderfunke/sem-ops-utils"
import { readFileSync } from "fs"

const BP = "https://www.muenchner-stadtbibliothek.de/bib-pods#"
const RDFS_LABEL = "http://www.w3.org/2000/01/rdf-schema#label"

export function loadConfig() {
    const ttl = readFileSync(new URL("../definitions/config.ttl", import.meta.url), "utf8")
    const quads = parser.parse(ttl)

    const lookup = (predicate) => quads.find(q => q.predicate.value === BP + predicate).object.value

    const lookupAll = (predicate) => quads
        .filter(q => q.predicate.value === BP + predicate)
        .map(q => {
            const url = q.object.value
            const label = quads.find(qq =>
                qq.subject.value === url &&
                qq.predicate.value === RDFS_LABEL,
            )?.object.value || url
            return { url, label }
        })

    return {
        solrEndpoint: lookup("solrEndpoint"),
        mainPath: lookup("mainPath"),
        solidPodSuggestions: lookupAll("solidPodSuggestion"),
    }
}
