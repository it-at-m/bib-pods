// localStorage-backed storage. Whole graph held as a turtle string under one key.
import { parseTurtle, serializeTurtle } from "../utils.js"
import { getStorageConfig } from "./index.js"

const DEBUG = true
const key = () => `${getStorageConfig().appName}.local.ttl`

// --- Storage interface ---

export function isReady() {
    return true
}

export async function warmup() {
    const k = key()
    const text = localStorage.getItem(k)
    if (DEBUG) {
        if (text) console.log(`[cori] local: using existing localStorage entry "${k}" (${text.length} chars)`)
        else console.log(`[cori] local: no entry "${k}" yet, will be created on first write`)
    }
}

export async function load() {
    return parseTurtle(localStorage.getItem(key()) ?? "")
}

export async function save(store) {
    localStorage.setItem(key(), await serializeTurtle(store))
}

export function getInfo() {
    return { Speicherung: "lokal in deinem Browser" }
}

export function getEntryName() {
    return key()
}
