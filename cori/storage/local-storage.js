// localStorage-backed storage. Whole graph held as a turtle string under one key.
import { parseTurtle, serializeTurtle, seedStore } from "../utils.js"

const DEBUG = true
const KEY = "bib-pods.local.ttl"

export function isReady() {
    return true
}

export async function warmup() {
    const text = localStorage.getItem(KEY)
    if (text) {
        if (DEBUG) console.log(`[bib-pods] local: using existing localStorage entry "${KEY}" (${text.length} chars)`)
    } else {
        const store = parseTurtle("")
        seedStore(store)
        localStorage.setItem(KEY, await serializeTurtle(store))
        if (DEBUG) console.log(`[bib-pods] local: created entry "${KEY}" with dev seed data`)
    }
}

export async function load() {
    return parseTurtle(localStorage.getItem(KEY) ?? "")
}

export async function save(store) {
    localStorage.setItem(KEY, await serializeTurtle(store))
}

export function getInfo() {
    return { Speicherung: "lokal in deinem Browser" }
}
