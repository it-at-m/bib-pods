// Solid-pod-backed storage: OIDC auth lifecycle + pod discovery + setup + CRUD
import { getResource, parseToN3, createContainer, putResource, getContainerItems, getLinkHeader, SPACE, SOLID, RDF } from "@uvdsl/solid-requests"
import { parseTurtle, serializeTurtle } from "../utils.js"
import { Session } from "@uvdsl/solid-oidc-client-browser"
import { universalAccess } from "@inrupt/solid-client"
import { setChoice, getStorageConfig } from "./index.js"

const DEBUG = true
const log = (...args) => DEBUG && console.log("[cori]", ...args)

const CORI_CONTAINER_NAME = "cori"
const returnUrlKey = () => `${getStorageConfig().appName}.solid.return-url`
const profileFilename = () => getStorageConfig().profileFilename

export const currentPageUrl = () => window.location.origin + window.location.pathname

let session = null
let readyPromise = null
let setupPromise = null
let modePromise = null
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
        { redirect_uris: [redirectUri], client_name: getStorageConfig().appName },
        { workerUrl },
    )
    const hasAuthCode = new URLSearchParams(window.location.search).has("code")
    readyPromise = hasAuthCode
        ? session.handleRedirectFromLogin()
        : session.restore().catch(() => {})
    return readyPromise
}

export function isLoggedIn() {
    return session?.isActive ?? false
}

export function getWebId() {
    return session?.webId ?? null
}

// The session's authenticated fetch, for callers reading resources outside the
// storage interface (e.g. checking what another pod lets this WebID see).
export const authFetch = (url, init) => session.authFetch(url, init)

export async function login(oidcIssuer, { redirectUri, returnUrl } = {}) {
    if (returnUrl) localStorage.setItem(returnUrlKey(), returnUrl)
    await session.login(oidcIssuer, redirectUri)
}

// Called from a static page used as OIDC redirectUri when the host
// (e.g. TYPO3) would otherwise reject the OIDC query params before our JS runs.
export async function handleSolidCallback() {
    // The redirectUri here only satisfies the Session constructor; the callback page
    // never initiates a login itself, so this value is never read back.
    await initSession({ redirectUri: currentPageUrl() })
    if (session.isActive) setChoice("solid")
    const returnUrl = localStorage.getItem(returnUrlKey()) ?? (window.location.origin + "/")
    localStorage.removeItem(returnUrlKey())
    window.location.replace(returnUrl)
}

export async function logout() {
    await session.logout()
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
    // Surfaces to users via storageErrorMessage when a write is attempted
    // without a restored session — keep the wording user-appropriate.
    if (!session?.webId) throw new Error("Keine Verbindung zum Pod (Sitzung nicht aktiv)")
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

    const filename = profileFilename()
    const fileUri = coriUri + filename
    const coriItems = await getContainerItems(coriUri, session)
    log("cori/ container items:", coriItems)
    if (coriItems.includes(fileUri)) {
        log(`${filename} already exists:`, fileUri)
    } else {
        log(`creating ${filename} at`, fileUri)
        const resp = await putResource(fileUri, "", session)
        log(`${filename} created, server response status =`, resp.status)
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
        modePromise = null
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
    if (!session?.webId) {
        // The storage choice is persisted but the session couldn't be restored —
        // pod offline at page load, or the session expired. A reload re-attempts
        // the restore from the stored refresh token.
        return {
            ...base,
            Status: "nicht verbunden — Pod offline oder Sitzung abgelaufen",
            Hinweis: "Lade die Seite neu, sobald der Pod wieder erreichbar ist.",
        }
    }
    try {
        const fileUri = await ensurePodSetup()
        return {
            ...base,
            WebID: session.webId,
            Datei: fileUri,
        }
    } catch (err) {
        // The session can be active (a client-side token claim) while the pod
        // server itself is down — fetch then rejects with a TypeError.
        log("getInfo: pod access failed:", err)
        return {
            ...base,
            WebID: session.webId,
            Status: err instanceof TypeError ? "Pod nicht erreichbar" : "Pod-Zugriff fehlgeschlagen",
        }
    }
}

export function getEntryName() {
    return profileFilename()
}

// --- Publishing ---

// Published resources live beside the profile file in the same cori/ container.
async function siblingUri(filename) {
    const profileUri = await ensurePodSetup()
    return profileUri.slice(0, profileUri.length - profileFilename().length) + filename
}

// Two access-control mechanisms are in circulation across the Solid ecosystem — WAC
// (acl:Authorization documents) and ACP (acp:AccessControlResource) — and a given pod
// server implements one or the other. getAccessControlMode is the only place they are
// told apart: agent and public grants go through universalAccess, which speaks both,
// and group grants are WAC-only.
const ACP_RESOURCE_TYPE = "http://www.w3.org/ns/solid/acp#AccessControlResource"

const head = (uri) => session.authFetch(uri, { method: "HEAD", cache: "no-store" })

// Every pod links its access-control document with rel="acl", whichever mechanism it
// speaks. Read straight off the response rather than via getLinkHeader: that document is
// routinely absent — servers create it on first write — and even a 404 carries the
// headers describing it.
const aclUrlOf = async (uri) => extractLinkRel((await head(uri)).headers.get("Link"), "acl", uri)

// "wac" | "acp" — the two differ in what that document says about itself: an ACP server
// types it acp:AccessControlResource, a WAC server types it nothing. Memoized like the
// pod setup it rides on: a pod does not switch mechanism underneath us, and the Konto
// block asks on every re-render.
export async function getAccessControlMode() {
    const profile = await ensurePodSetup()   // clears the memo when the WebID changes
    modePromise ??= aclUrlOf(profile)
        .then(async (url) => ((await head(url)).headers.get("Link") ?? "").includes(ACP_RESOURCE_TYPE) ? "acp" : "wac")
        .catch(err => { modePromise = null; throw err })
    return modePromise
}

// An audience is null (everyone), { agent: webId }, or { group: groupUri }.
// universalAccess writes whichever mechanism the pod speaks, so agent and public grants
// state the intent (who may read) rather than the mechanism. It resolves rather than
// rejects when it cannot address a pod's access control at all — seen on CSS in ACP
// mode, whose control documents are created lazily, which defeats the library's own
// detection — so the outcome is verified instead of assumed. Only grants are checked:
// after a withdrawal a broader rule (public read, say) can legitimately leave the agent
// still able to read.
async function setReadAccess(uri, audience, read) {
    const options = { fetch: session.authFetch }
    const applied = audience?.agent
        ? await universalAccess.setAgentAccess(uri, audience.agent, { read }, options)
        : await universalAccess.setPublicAccess(uri, { read }, options)
    if (applied === null || (read && !applied.read)) {
        throw new Error("Der Pod hat die Freigabe nicht übernommen — sein Zugriffsverfahren wird nicht unterstützt")
    }
}

// acl:agentGroup points at a vcard:Group document held elsewhere — typically the
// organisation's own pod — which the pod server dereferences on every request. That
// indirection is the whole point: membership changes take effect at once and without
// touching this pod, so the owner consents once and is never asked again.
// The document is stated whole rather than edited, which keeps the owner's own
// authorization in it by construction and makes withdrawal simply the version without
// the group — at the price that a group grant replaces a public or single-WebID grant
// on the same file instead of joining it.
const groupAcl = (uri, groupUri) => `@prefix acl: <http://www.w3.org/ns/auth/acl#>.

<#owner> a acl:Authorization;
    acl:agent <${session.webId}>;
    acl:accessTo <${uri}>;
    acl:mode acl:Read, acl:Write, acl:Control.
${groupUri ? `
<#group> a acl:Authorization;
    acl:agentGroup <${groupUri}>;
    acl:accessTo <${uri}>;
    acl:mode acl:Read.
` : ""}`

async function setGroupAccess(uri, groupUri, read) {
    if (await getAccessControlMode() !== "wac") throw new Error("Gruppen-Freigaben gibt es nur auf WAC-Pods")
    await putResource(await aclUrlOf(uri), groupAcl(uri, read && groupUri), session)
}

const applyAccess = (uri, audience, read) => audience?.group
    ? setGroupAccess(uri, audience.group, read)
    : setReadAccess(uri, audience, read)

const describe = (audience) => audience?.agent ?? audience?.group ?? "public"

// Grants read on the resource to the given audience (see applyAccess).
export async function publish(filename, turtle, audience = null) {
    const uri = await siblingUri(filename)
    await putResource(uri, turtle, session)
    await applyAccess(uri, audience, true)
    log("granted read on", uri, "to", describe(audience))
    return uri
}

// The pod's own access-control document for a published resource, verbatim — the
// artefact that actually carries the grant, worth showing rather than describing.
// null while the pod has none yet, i.e. before anything was ever granted.
export async function readAccessControl(filename) {
    const url = await aclUrlOf(await siblingUri(filename))
    if (!url) return null
    const response = await session.authFetch(url, { cache: "no-store" })
    return response.ok ? await response.text() : null
}

// Withdraws that same read grant. The resource stays in the pod and readable by its
// owner — so re-granting later is a permission change, not a re-upload.
export async function unpublish(filename, audience = null) {
    const uri = await siblingUri(filename)
    await applyAccess(uri, audience, false)
    log("revoked read on", uri, "from", describe(audience))
    return uri
}
