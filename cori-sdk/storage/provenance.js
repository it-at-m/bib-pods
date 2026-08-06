// Per-triple provenance. Every triple entering or leaving the profile is appended here
// as one record: an RDF 1.2 reifier naming the triple, carrying what happened to it,
// when, and which system did it.
//
//   [] rdf:reifies <<( cori:defaultProfile cori:username "Anna" )>> ;
//       cori:operation as:Add ;
//       prov:atTime "2026-08-06T09:12:44.310Z"^^xsd:dateTime ;
//       as:generator bp:MSBwebapp .
//
// A triple term is only legal as an object, hence rdf:reifies rather than the triple
// standing as a subject.
//
// A write serializes its own records and nothing else, and the document grows by that
// much text — the log is never read back into a graph, so writing costs the same at ten
// records as at ten thousand. Records appear in the order they happened, which is the
// timeline; nothing carries a sequence number.
import { serializeTurtleStarParts, factory, CORI, PROV, AS, RDF } from "../utils.js"
import { Store } from "n3"
import { getStorageConfig, getStorage } from "./index.js"

const REIFIES = RDF + "reifies"
const AT_TIME = PROV + "atTime"
const GENERATOR = AS + "generator"
const OPERATION = CORI + "operation"

const ADD = AS + "Add"
const REMOVE = AS + "Remove"

const iri = factory.namedNode
const DATE_TIME = iri("http://www.w3.org/2001/XMLSchema#dateTime")

const filename = () => getStorageConfig().provenanceFilename
const generator = () => getStorageConfig().provenanceGenerator

function addRecord(store, quad, operation, now, label) {
    const reifier = factory.blankNode(label)
    const say = (predicate, object) => store.addQuad(factory.quad(reifier, iri(predicate), object))
    say(REIFIES, factory.quad(quad.subject, quad.predicate, quad.object))
    say(OPERATION, iri(operation))
    say(AT_TIME, factory.literal(now, DATE_TIME))
    say(GENERATOR, iri(generator()))
}

// Reifiers are anonymous: nothing refers back to one, and a label would have to stay
// unique across every append the document ever receives. The writer has no anonymous
// subject in this layout, so records are serialized under throwaway labels and the
// labels struck out. A reifier is only ever a subject, so it sits alone at the start of
// its line, continuation lines are indented, and newlines inside literals are escaped.
const LABELLED_SUBJECT = /^_:r\d+ /gm

// One write's records as text to concatenate onto the document. Prefix declarations are
// emitted only where that document lacks them: all of them on the first write, none
// afterwards until a record uses a vocabulary no earlier one did.
async function chunkFor(added, removed, now, existing) {
    const store = new Store()
    const records = [...added.map(q => [q, ADD]), ...removed.map(q => [q, REMOVE])]
    records.forEach(([quad, operation], i) => addRecord(store, quad, operation, now, `r${i}`))

    const { declarations, body } = await serializeTurtleStarParts(store)
    const missing = declarations.filter(line => !existing.includes(line.slice(0, line.indexOf(":") + 1)))
    return (missing.length ? missing.join("\n") + "\n\n" : "") + body.replace(LABELLED_SUBJECT, "[] ") + "\n"
}

// Never throws: the profile is already saved by the time this runs, so a log that
// cannot be written must not fail the user's edit.
export async function recordChange({ added, removed }) {
    if (!filename() || (!added.length && !removed.length)) return
    try {
        const now = new Date().toISOString()
        await getStorage().appendDoc(filename(), (existing) => chunkFor(added, removed, now, existing))
    } catch (err) {
        console.error("[cori] provenance: recording failed, the profile was saved anyway:", err)
    }
}
