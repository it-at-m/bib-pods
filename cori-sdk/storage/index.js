// Storage abstraction. The app reads/writes an RDF graph via the active backend;
// each backend (local, solid, …) implements { isReady, warmup, load, save, getInfo }.
// Adding a new backend means dropping in a new module here and wiring it in BACKENDS.
import { serializeTurtle, mintMessageUri, subjectsOfType, getOne, replaceProperty, getProfileSubject, CORI, RDF_TYPE } from "../utils.js"
import { addTriple as addTripleToStore, newStore } from "@foerderfunke/sem-ops-utils/core"
import * as localBackend from "./local-storage.js"
import * as sessionBackend from "./session-storage.js"
import * as solidBackend from "./solid.js"

const BACKENDS = { local: localBackend, session: sessionBackend, solid: solidBackend }

const MESSAGE_TYPE = CORI + "Message"
const CONTENT_PRED = CORI + "content"
const READ_PRED = CORI + "read"
const REFERS_TO_ENTITY_PRED = CORI + "refersToEntity"

// --- App-level configuration ---
// Generic defaults; apps call setStorageConfig() to overwrite
const storageConfig = {
    appName: "cori",                  // localStorage key prefix + Solid OIDC consent screen identity
    profileFilename: "profile.ttl",   // filename used inside the user's pod
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

// --- Reading ---

export async function loadAsTurtle() {
    const store = await getStorage().load()
    return await serializeTurtle(store)
}

export async function loadStore() {
    return await getStorage().load()
}

// --- Mutation ---

async function mutate(fn) {
    const store = await getStorage().load()
    await fn(store)
    await getStorage().save(store)
}

export const addTriple = (subject, predicate, object) =>
    mutate(store => addTripleToStore(store, subject, predicate, object))

export const clearStorage = () => getStorage().save(newStore())

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

export async function markMessageRead(uri) {
    const store = await getStorage().load()
    if (getOne(store, uri, READ_PRED) === "true") return
    replaceProperty(store, uri, READ_PRED, true)
    await getStorage().save(store)
}

export const addInquiryFacts = (facts) => mutate(store => {
    const defaultSubject = getProfileSubject()
    for (const { subject, predicate, object } of facts) {
        addTripleToStore(store, subject ?? defaultSubject, predicate, object)
    }
})
