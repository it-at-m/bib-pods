// Storage abstraction. The app reads/writes an RDF graph via the active backend; each
// backend (local, solid, …) implements
// { isReady, warmup, load, save, appendDoc, getInfo, getEntryName }.
// Adding a new backend means dropping in a new module here and wiring it in BACKENDS.
import { serializeTurtle, mintMessageUri, subjectsOfType, getOne, replaceProperty, getProfileSubject, quadKey, CORI, RDF_TYPE } from "../utils.js"
import { addTriple as addTripleToStore } from "@foerderfunke/sem-ops-utils/core"
import { recordChange } from "./provenance.js"
import * as localBackend from "./local-storage.js"
import * as sessionBackend from "./session-storage.js"
import * as solidBackend from "./solid.js"

const BACKENDS = { local: localBackend, session: sessionBackend, solid: solidBackend }

const PROFILE_TYPE = CORI + "Profile"
const MESSAGE_TYPE = CORI + "Message"
const CONTENT_PRED = CORI + "content"
const READ_PRED = CORI + "read"
const REFERS_TO_ENTITY_PRED = CORI + "refersToEntity"

// --- App-level configuration ---
// Generic defaults; apps call setStorageConfig() to overwrite
const storageConfig = {
    appName: "cori",                                 // localStorage key prefix + Solid OIDC consent screen identity
    profileFilename: "profile.ttl",                  // filename used inside the user's pod
    provenanceFilename: "provenance.ttl",            // sibling of the profile; "" switches provenance recording off
    provenanceGenerator: CORI + "unknownGenerator",  // the system every change made through this app is recorded as coming from
}

export function setStorageConfig(partial) {
    Object.assign(storageConfig, partial)
}

export function getStorageConfig() {
    return Object.freeze({ ...storageConfig })
}

const choiceKey = () => `${storageConfig.appName}.storage`

// --- Backend selection ---

export function getChoice() {
    return sessionStorage.getItem(choiceKey()) ?? localStorage.getItem(choiceKey())
}

export function setChoice(choice) {
    // "session" is itself session-scoped: closing the tab drops both the choice
    // and the data, so the user returns to the chooser next visit. The other
    // backends persist the choice across sessions via localStorage.
    const [target, other] = choice === "session" ? [sessionStorage, localStorage] : [localStorage, sessionStorage]
    other.removeItem(choiceKey())
    target.setItem(choiceKey(), choice)
}

export function clearChoice() {
    localStorage.removeItem(choiceKey())
    sessionStorage.removeItem(choiceKey())
}

export function isActivated() {
    return Boolean(BACKENDS[getChoice()])
}

export function getStorage() {
    const backend = BACKENDS[getChoice()]
    if (!backend) throw new Error(`No storage backend selected (choice=${getChoice()})`)
    return backend
}

// True only when the active backend is usable now (e.g. Solid requires a live session).
export function isStorageReady() {
    const backend = BACKENDS[getChoice()]
    return backend ? backend.isReady() : false
}

// Pre-flight the active backend (e.g. discover & create pod containers ahead
// of first use). No-op for backends that have nothing to set up.
export function warmupStorage() {
    return getStorage().warmup()
}

export async function getStorageInfo() {
    return await getStorage().getInfo()
}

export function getStorageEntryName() {
    return getStorage().getEntryName()
}

// --- Publishing ---
// Deliberately not part of the backend interface: publishing means handing someone a URL
// they can read, and only a pod has an addressable URL space — local and session storage
// have nothing to expose. Callers gate on canPublish() and address the pod directly.
// An audience narrows the grant: null means everyone, { agent: webId } one person,
// { group: groupUri } everyone the group document currently lists.

export function canPublish() {
    return getChoice() === "solid" && isStorageReady()
}

export const publishTurtle = (filename, turtle, audience) => solidBackend.publish(filename, turtle, audience)

export const unpublishTurtle = (filename, audience) => solidBackend.unpublish(filename, audience)

// "wac" | "acp" — group grants exist only in WAC, so callers offer that option
// conditionally. See solid.js for how the pod is asked.
export const getAccessControlMode = () => solidBackend.getAccessControlMode()

// The pod's access-control document for a published file, as text (null if none yet).
export const readAccessControl = (filename) => solidBackend.readAccessControl(filename)

// --- Reading ---

export async function loadAsTurtle() {
    const store = await getStorage().load()
    return await serializeTurtle(store)
}

export async function loadStore() {
    return await getStorage().load()
}

// --- Mutation ---
// The single place the profile graph changes. Provenance is derived from the diff, so
// it covers what a mutation actually did — including removals no call site declares,
// like a replaced property dropping its old value.

async function mutate(fn) {
    const storage = getStorage()
    const store = await storage.load()
    const before = store.getQuads()
    await fn(store)
    ensureProfileTyped(store)
    const { added, removed } = diff(before, store.getQuads())
    if (!added.length && !removed.length) return
    await storage.save(store)
    // After the save: provenance may only claim what is stored.
    await recordChange({ added, removed })
}

function diff(before, after) {
    const index = (quads) => new Map(quads.map(q => [quadKey(q), q]))
    const [b, a] = [index(before), index(after)]
    return {
        added: [...a].filter(([key]) => !b.has(key)).map(([, quad]) => quad),
        removed: [...b].filter(([key]) => !a.has(key)).map(([, quad]) => quad),
    }
}

// Otherwise the SHACL-shapes won't work
function ensureProfileTyped(store) {
    const subject = getProfileSubject()
    if (store.getQuads(subject, null, null, null).length > 0) {
        addTripleToStore(store, subject, RDF_TYPE, PROFILE_TYPE)
    }
}

export const addTriple = (subject, predicate, object) =>
    mutate(store => addTripleToStore(store, subject, predicate, object))

// Removes one profile fact (subject = profile root); `object` is the RDF term, so
// IRI and literal values delete precisely. An IRI object that is no longer referenced
// anywhere afterwards takes its own description triples (labels etc.) with it.
export const removeProfileFact = (predicate, object) => mutate(store => {
    for (const q of store.getQuads(getProfileSubject(), predicate, object, null)) store.removeQuad(q)
    if (object.termType === "NamedNode" && store.getQuads(null, null, object, null).length === 0) {
        for (const q of store.getQuads(object, null, null, null)) store.removeQuad(q)
    }
})

// Empties the profile down to its bare typing triple. A mutation of the loaded graph,
// not a save of a fresh one, so the facts being dropped show up in the diff.
export const clearStorage = () => mutate(store => {
    for (const q of store.getQuads()) store.removeQuad(q)
    addTripleToStore(store, getProfileSubject(), RDF_TYPE, PROFILE_TYPE)
})

// --- Messages / recommendations ---

export const addMessage = (content, refersTo = null) => mutate(store => {
    const uri = mintMessageUri()
    addTripleToStore(store, uri, RDF_TYPE, MESSAGE_TYPE)
    addTripleToStore(store, uri, CONTENT_PRED, content)
    addTripleToStore(store, uri, READ_PRED, false)
    if (refersTo) addTripleToStore(store, uri, REFERS_TO_ENTITY_PRED, refersTo)
})

export async function listMessages() {
    const store = await getStorage().load()
    return subjectsOfType(store, MESSAGE_TYPE).map(uri => ({
        uri,
        content: getOne(store, uri, CONTENT_PRED),
        read:    getOne(store, uri, READ_PRED) === "true",
        refersTo: getOne(store, uri, REFERS_TO_ENTITY_PRED),
    }))
}

// Add a message unless an identical one already exists (same content AND refersTo,
// regardless of read state) — so re-running recommendations never duplicates a card.
export const addMessageIfNew = (content, refersTo = null) => mutate(store => {
    const exists = subjectsOfType(store, MESSAGE_TYPE).some(uri =>
        getOne(store, uri, CONTENT_PRED) === content &&
        (getOne(store, uri, REFERS_TO_ENTITY_PRED) ?? null) === refersTo)
    if (exists) return
    const uri = mintMessageUri()
    addTripleToStore(store, uri, RDF_TYPE, MESSAGE_TYPE)
    addTripleToStore(store, uri, CONTENT_PRED, content)
    addTripleToStore(store, uri, READ_PRED, false)
    if (refersTo) addTripleToStore(store, uri, REFERS_TO_ENTITY_PRED, refersTo)
})

// A replacement, not an addition — cori:read goes false → true, and the log records
// that as a removal plus an addition.
export const markMessageRead = (uri) => mutate(store => {
    replaceProperty(store, uri, READ_PRED, true)
})

export const addInquiryFacts = (facts) => mutate(store => {
    const defaultSubject = getProfileSubject()
    for (const { subject, predicate, object } of facts) {
        addTripleToStore(store, subject ?? defaultSubject, predicate, object)
    }
})

// Replace the full set of objects for (subject, predicate) in one write — for
// multi-valued settings (e.g. which recommendation strategies a user switched off).
export const replaceSubjectObjects = (subject, predicate, objects) => mutate(store => {
    for (const q of store.getQuads(subject, predicate, null, null)) store.removeQuad(q)
    for (const object of objects) addTripleToStore(store, subject, predicate, object)
})
