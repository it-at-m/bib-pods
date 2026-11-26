// Tests state which of the fields that not every index has exist, whatever the bundled
// snapshot (resources/index-fields.ttl) says. A later registerVocab() rebuilds the vocabulary
// from the bundle, so call this after registering.
import { getVocab, parseTurtle } from "cori-sdk/utils.js"
import { BP } from "../src/vocab.js"

export function indexOffering(...fields) {
    const v = getVocab()
    v.removeQuads(v.getQuads(BP + "CatalogueIndex", BP + "offersField", null, null))
    if (fields.length === 0) return
    v.addQuads(parseTurtle(`<${BP}CatalogueIndex> <${BP}offersField> ${fields.map(f => JSON.stringify(f)).join(", ")} .`)
        .getQuads(null, null, null, null))
}
