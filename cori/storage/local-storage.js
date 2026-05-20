// localStorage-backed storage. Whole graph held as a turtle string under one key.
import { parseTurtle, serializeTurtle } from "../utils.js"

const DEBUG = true
const KEY = "bib-pods.local.ttl"

// --- Storage interface ---

export function isReady() {
    return true
}

export async function warmup() {
    const text = localStorage.getItem(KEY)
    if (DEBUG) {
        if (text) console.log(`[bib-pods] local: using existing localStorage entry "${KEY}" (${text.length} chars)`)
        else console.log(`[bib-pods] local: no entry "${KEY}" yet, will be created on first write`)
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

export function getEntryName() {
    return KEY
}
