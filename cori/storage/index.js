// Storage abstraction. The app reads/writes an RDF graph via the active backend;
// each backend (local, solid, …) implements { isReady, warmup, load, save, getInfo }.
// Adding a new backend means dropping in a new module here and wiring it in BACKENDS.
import { addTriple as addTripleToStore, newStore } from "@foerderfunke/sem-ops-utils"
import { serializeTurtle, seedStore } from "../utils.js"
import * as localBackend from "./local-storage.js"
import * as solidBackend from "./solid.js"

const CHOICE_KEY = "bib-pods.storage"
const BACKENDS = { local: localBackend, solid: solidBackend }

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

export async function addTriple(subject, predicate, object) {
    const store = await getStorage().load()
    addTripleToStore(store, subject, predicate, object)
    await getStorage().save(store)
}

export async function loadAsTurtle() {
    const store = await getStorage().load()
    return await serializeTurtle(store)
}

export async function loadQuads() {
    const store = await getStorage().load()
    return store.getQuads(null, null, null, null)
}

export async function clearStorage() {
    const store = newStore()
    seedStore(store) // dev: re-seed on clear; drop this line once the dev seed goes away
    await getStorage().save(store)
}
