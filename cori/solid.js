import { Session } from "@uvdsl/solid-oidc-client-browser"
import { setChoice } from "./storage.js"

const CLIENT_NAME = "bib-pods"
const RETURN_URL_KEY = "bib-pods.solid.return-url"
const WEBID_KEY = "bib-pods.solid.webid"

export const currentPageUrl = () => window.location.origin + window.location.pathname

let session = null
let readyPromise = null

// Lazy init so callers can supply the right redirect URI (which must be registered
// with the IdP via Dynamic Client Registration — for TYPO3 that's the static callback
// page, for docs it's the current page).
export function initSession({ redirectUri }) {
    if (readyPromise) return readyPromise
    session = new Session({
        redirect_uris: [redirectUri],
        client_name: CLIENT_NAME,
    })
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
