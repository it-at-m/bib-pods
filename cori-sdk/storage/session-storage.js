// sessionStorage-backed storage: the whole graph as a turtle string under one
// key, scoped to the browser tab. It survives reloads and in-tab navigation but
// is wiped when the tab closes — "keep nothing beyond this visit". See
// web-storage.js for the implementation.
import { createWebStorageBackend } from "./web-storage.js"

export const { isReady, warmup, load, save, getInfo, getEntryName } =
    createWebStorageBackend({ storage: sessionStorage, kind: "session", info: "nur für diese Sitzung" })
