// Sharing the Merkliste from the pod profile: a readable copy beside the profile, with
// read access granted to everyone, to one specific WebID, or to a group whose membership
// is maintained elsewhere (a team's own roster). A view of what is currently granted
// comes later.
import { loadStore, publishTurtle, unpublishTurtle, readAccessControl } from "cori-sdk/storage/index.js"
import { getProfileSubject, serializeTurtle } from "cori-sdk/utils.js"
import { newStore, addTriple } from "@foerderfunke/sem-ops-utils/core"
import { BP } from "./vocab.js"

const MERKLISTE_FILENAME = "merkliste.ttl"
const SAVED_BOOK = BP + "savedBook"

// Copies only bp:savedBook across; every other profile fact stays private in the
// profile file. The subject is kept as-is so a reader can tell whose list it is.
// `audience` scopes the read grant (null = everyone, { agent } or { group }).
export async function grantMerklisteAccess(audience = null) {
    const profile = await loadStore()
    const subject = getProfileSubject()
    const merkliste = newStore()
    for (const { object } of profile.getQuads(subject, SAVED_BOOK, null, null)) {
        addTriple(merkliste, subject, SAVED_BOOK, object.value)
    }
    return await publishTurtle(MERKLISTE_FILENAME, await serializeTurtle(merkliste), audience)
}

export const revokeMerklisteAccess = (audience = null) => unpublishTurtle(MERKLISTE_FILENAME, audience)

// The rules the pod currently applies to the Merkliste copy, verbatim.
export const readMerklisteAccessControl = () => readAccessControl(MERKLISTE_FILENAME)
