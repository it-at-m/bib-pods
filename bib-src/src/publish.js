// Publishing the Merkliste from the pod profile to a world-readable resource beside it.
// A deliberately narrow first slice: one fixed file, one fixed subset of the profile,
// public or not. Sharing with named agents, and a view of what is currently public,
// come later.
import { loadStore, publishTurtle, unpublishTurtle } from "cori-sdk/storage/index.js"
import { getProfileSubject, serializeTurtle } from "cori-sdk/utils.js"
import { newStore, addTriple } from "@foerderfunke/sem-ops-utils/core"
import { BP } from "./vocab.js"

const MERKLISTE_FILENAME = "merkliste.ttl"
const SAVED_BOOK = BP + "savedBook"

// Copies only bp:savedBook across; every other profile fact stays private in the
// profile file. The subject is kept as-is so a reader can tell whose list it is.
export async function publishMerkliste() {
    const profile = await loadStore()
    const subject = getProfileSubject()
    const merkliste = newStore()
    for (const { object } of profile.getQuads(subject, SAVED_BOOK, null, null)) {
        addTriple(merkliste, subject, SAVED_BOOK, object.value)
    }
    return await publishTurtle(MERKLISTE_FILENAME, await serializeTurtle(merkliste))
}

export const unpublishMerkliste = () => unpublishTurtle(MERKLISTE_FILENAME)
