// Storage abstraction. The app reads/writes an RDF graph via the active backend;
// each backend (local, solid, …) implements { isReady, warmup, load, save, getInfo }.
// Adding a new backend means dropping in a new module here and wiring it in BACKENDS.
import { serializeTurtle, seedProfile, seedMessages, mintMessageUri, subjectsOfType, getOne, replaceProperty, EX, BP, RDF_TYPE } from "../utils.js"
import { addTriple as addTripleToStore, newStore } from "@foerderfunke/sem-ops-utils"
import * as localBackend from "./local-storage.js"
import * as solidBackend from "./solid.js"

const CHOICE_KEY = "bib-pods.storage"
const BACKENDS = { local: localBackend, solid: solidBackend }

const MESSAGE_TYPE = BP + "Message"
const CONTENT_PRED = BP + "content"
const READ_PRED = BP + "read"
export const PROFILE_SUBJECT = EX + "me"

// --- Backend selection ---

export function getChoice() {
    return localStorage.getItem(CHOICE_KEY)
}

export function setChoice(choice) {
    localStorage.setItem(CHOICE_KEY, choice)
}

export function clearChoice() {
    localStorage.removeItem(CHOICE_KEY)
}

export function isActivated() {
    const choice = getChoice()
    return choice === "local" || choice === "solid"
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

export const addMessage = (content) => mutate(store => {
    const uri = mintMessageUri()
    addTripleToStore(store, uri, RDF_TYPE, MESSAGE_TYPE)
    addTripleToStore(store, uri, CONTENT_PRED, content)
    addTripleToStore(store, uri, READ_PRED, "false")
})

export async function listMessages() {
    const store = await getStorage().load()
    return subjectsOfType(store, MESSAGE_TYPE).map(uri => ({
        uri,
        content: getOne(store, uri, CONTENT_PRED),
        read:    getOne(store, uri, READ_PRED) === "true",
    }))
}

export async function markMessageRead(uri) {
    const store = await getStorage().load()
    if (getOne(store, uri, READ_PRED) === "true") return
    replaceProperty(store, uri, READ_PRED, "true")
    await getStorage().save(store)
}

export const addInquiryFacts = (facts) => mutate(store => {
    for (const { subject, predicate, object } of facts) {
        addTripleToStore(store, subject ?? PROFILE_SUBJECT, predicate, object)
    }
})

// --- Dev helpers, exposed via window.bibPods.* in browser console ---

export const addTestProfile = () => mutate(seedProfile)
export const addTestMessages = () => mutate(seedMessages)
