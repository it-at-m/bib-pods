// localStorage-backed storage: the whole graph as a turtle string under one key,
// persisted across browser sessions. See web-storage.js for the implementation.
import { createWebStorageBackend } from "./web-storage.js"

export const { isReady, warmup, load, save, appendDoc, getInfo, getEntryName } =
    createWebStorageBackend({ storage: localStorage, kind: "local", info: "lokal in deinem Browser" })
