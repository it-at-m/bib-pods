// Solid-pod-backed storage: OIDC auth lifecycle + pod discovery + setup + CRUD
// Exported surface:
//   Auth: initSession, getSession, isLoggedIn, getWebId, login, logout,
//         handleSolidCallback, currentPageUrl
//   Storage interface: isReady, warmup, load, save
import { getResource, parseToN3, createContainer, putResource, getContainerItems, getLinkHeader, SPACE, SOLID, RDF } from "@uvdsl/solid-requests"
import { parseTurtle, serializeTurtle } from "../utils.js"
import { Session } from "@uvdsl/solid-oidc-client-browser"
import { setChoice } from "./index.js"

const DEBUG = true
const log = (...args) => DEBUG && console.log("[bib-pods]", ...args)

const CLIENT_NAME = "bib-pods"
const RETURN_URL_KEY = "bib-pods.solid.return-url"
const WEBID_KEY = "bib-pods.solid.webid"
const CORI_CONTAINER_NAME = "cori"
const BIB_PODS_FILENAME = "bib-pods.ttl"

export const currentPageUrl = () => window.location.origin + window.location.pathname

let session = null
let readyPromise = null
let setupPromise = null
let cachedWebId = null

// URL of the worker emitted by emitRefreshWorker — see refresh-worker-plugin.js
// for why we serve it separately. Filename held in a const (not a string literal)
// so Vite's URL pattern matcher doesn't grab it and re-inline the worker.
const WORKER_FILENAME = "RefreshWorker.js"
const workerUrl = new URL(WORKER_FILENAME, import.meta.url).href

// --- Auth ---

// Lazy init so callers can supply the right redirect URI (which must be registered
// with the IdP via Dynamic Client Registration — for TYPO3 that's the static callback
// page, for docs it's the current page).
export function initSession({ redirectUri }) {
    if (readyPromise) return readyPromise
    session = new Session(
        { redirect_uris: [redirectUri], client_name: CLIENT_NAME },
        { workerUrl },
    )
    const hasAuthCode = new URLSearchParams(window.location.search).has("code")
    readyPromise = (hasAuthCode
        ? session.handleRedirectFromLogin()
        : session.restore().catch(() => {})
    ).then(() => {
        // webId is a public identifier; cache it so the UI can show it across navigations
        // and reloads even when the live session can't be restored (e.g. refresh token
        // gone or rejected). Live tokens for CRUD are a separate concern.
        if (session.webId) localStorage.setItem(WEBID_KEY, session.webId)
    })
    return readyPromise
}

export function getSession() {
    return session
}

export function isLoggedIn() {
    return session?.isActive ?? false
}

export function getWebId() {
    return session?.webId ?? localStorage.getItem(WEBID_KEY) ?? undefined
}

export async function login(oidcIssuer, { redirectUri, returnUrl } = {}) {
    if (returnUrl) localStorage.setItem(RETURN_URL_KEY, returnUrl)
    await session.login(oidcIssuer, redirectUri)
}

// Called from a static page used as OIDC redirectUri when the host
// (e.g. TYPO3) would otherwise reject the OIDC query params before our JS runs.
export async function handleSolidCallback() {
    // The redirectUri here only satisfies the Session constructor; the callback page
    // never initiates a login itself, so this value is never read back.
    await initSession({ redirectUri: currentPageUrl() })
    if (session.isActive) setChoice("solid")
    const returnUrl = localStorage.getItem(RETURN_URL_KEY) ?? (window.location.origin + "/")
    localStorage.removeItem(RETURN_URL_KEY)
    window.location.replace(returnUrl)
}

export async function logout() {
    await session.logout()
    localStorage.removeItem(WEBID_KEY)
}

// --- Discovery ---

// Walk one path segment up from a URL; returns null if already at origin root.
function parentContainerOf(url) {
    const parsed = new URL(url)
    if (parsed.pathname === "/" || parsed.pathname === "") return null
    const segments = parsed.pathname.replace(/\/$/, "").split("/")
    segments.pop()
    return parsed.origin + segments.join("/") + "/"
}

// Extract a target URL from a HTTP Link header for a specific rel value.
// Resolves relative refs against `baseUri`. Returns an absolute URL or null.
function extractLinkRel(linkHeader, rel, baseUri) {
    if (!linkHeader) return null
    for (const entry of linkHeader.split(",")) {
        const parts = entry.split(";").map(p => p.trim())
        const uri = parts[0]?.match(/^<(.+)>$/)?.[1]
        if (!uri) continue
        const matchesRel = parts.slice(1).some(p => {
            const m = p.match(/^rel\s*=\s*"?([^"]+)"?$/)
            return m?.[1] === rel
        })
        if (matchesRel) return new URL(uri, baseUri).href
    }
    return null
}

// Storage-root discovery per the Solid Protocol. Three mechanisms, tried in order:
//   (1) pim:storage relation in the WebID profile turtle
//       https://solidproject.org/TR/protocol#client-rdf-storage
//       Optional per spec; covers solidcommunity.net, Inrupt PodSpaces.
//   (2) solid:storageDescription Link on profile → GET → resource typed pim:Storage
//       https://solidproject.org/TR/protocol#server-storage-description
//       Server-MUST, so covers any conformant modern server (incl. CSS).
//   (3) Walk URI path up, HEAD for Link rel="type" pim:Storage on the storage root
//       https://solidproject.org/TR/protocol#client-storage-discovery
//       Backstop for servers without the storageDescription requirement.
async function discoverStorageRoot(webId) {
    const profileResp = await getResource(webId, session)
    const profileText = await profileResp.text()

    // (1)
    const { store } = await parseToN3(profileText, webId)
    const fromProfile = store.getObjects(webId, SPACE("storage"), null)[0]
    if (fromProfile) {
        return fromProfile.value.endsWith("/") ? fromProfile.value : fromProfile.value + "/"
    }

    // (2)
    const docUrl = webId.split("#")[0]
    const descUrl = extractLinkRel(profileResp.headers.get("Link"), SOLID("storageDescription"), docUrl)
    if (descUrl) {
        log("following solid:storageDescription to", descUrl)
        const descResp = await getResource(descUrl, session)
        const { store: descStore } = await parseToN3(await descResp.text(), descUrl)
        const storageNode = descStore.getSubjects(RDF("type"), SPACE("Storage"), null)[0]
        if (storageNode) {
            const u = storageNode.value
            return u.endsWith("/") ? u : u + "/"
        }
    }

    // (3) — WebID doc itself is a resource, not a storage; start walk at its parent.
    log("falling back to Link-header path walk")
    let url = parentContainerOf(docUrl)
    while (url) {
        try {
            const link = await getLinkHeader(url, session)
            const types = [].concat(link.type ?? []).map(t => t.replace(/^</, "").replace(/>$/, ""))
            if (types.includes(SPACE("Storage"))) return url
        } catch (_) { /* missing Link header or 4xx — try next level */ }
        url = parentContainerOf(url)
    }
    return null
}

// --- Pod setup ---

async function doEnsurePodSetup() {
    if (!session?.webId) throw new Error("Solid session has no webId")
    const webId = session.webId
    log("ensurePodSetup: webId =", webId)

    const storageRoot = await discoverStorageRoot(webId)
    if (!storageRoot) throw new Error(`Could not discover storage root for ${webId}`)
    log("storage root =", storageRoot)

    const coriUri = storageRoot + CORI_CONTAINER_NAME + "/"
    const storageItems = await getContainerItems(storageRoot, session)
    log("storage container items:", storageItems)
    if (storageItems.includes(coriUri)) {
        log("cori/ container already exists:", coriUri)
    } else {
        log("creating cori/ container at", storageRoot)
        const resp = await createContainer(storageRoot, CORI_CONTAINER_NAME, session)
        log("cori/ created, server response status =", resp.status)
    }

    const fileUri = coriUri + BIB_PODS_FILENAME
    const coriItems = await getContainerItems(coriUri, session)
    log("cori/ container items:", coriItems)
    if (coriItems.includes(fileUri)) {
        log("bib-pods.ttl already exists:", fileUri)
    } else {
        log("creating bib-pods.ttl at", fileUri)
        const resp = await putResource(fileUri, "", session)
        log("bib-pods.ttl created, server response status =", resp.status)
    }
    log("ensurePodSetup done, file URI =", fileUri)
    return fileUri
}

// Memoized for the page session; invalidated when the active WebID changes
// (logout, or login as a different user).
function ensurePodSetup() {
    const webId = session?.webId
    if (webId !== cachedWebId) {
        cachedWebId = webId
        setupPromise = null
    }
    if (!setupPromise) {
        setupPromise = doEnsurePodSetup().catch(err => {
            setupPromise = null
            throw err
        })
    }
    return setupPromise
}

// --- Storage interface ---

export function isReady() {
    return isLoggedIn()
}

export function warmup() {
    return ensurePodSetup()
}

export async function load() {
    const uri = await ensurePodSetup()
    const resp = await getResource(uri, session)
    return parseTurtle(await resp.text())
}

export async function save(store) {
    const uri = await ensurePodSetup()
    await putResource(uri, await serializeTurtle(store), session)
}

export async function getInfo() {
    const base = { Speicherung: "in deinem Solid Pod" }
    if (!session?.webId) return base
    const fileUri = await ensurePodSetup()
    return {
        ...base,
        WebID: session.webId,
        Datei: fileUri,
    }
}
