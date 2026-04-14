import { getSolidDataset, solidDatasetAsTurtle } from "@inrupt/solid-client"
import { Session } from "@inrupt/solid-client-authn-browser"

const SOLID_SERVER = "http://localhost:3000"
const POD = "citizen-pod"
const PROFILE_URL = `${SOLID_SERVER}/${POD}/profile/card`

// localStorage-backed storage so OIDC state survives the redirect
const storage = {
    async get(key) { return localStorage.getItem(key) || undefined },
    async set(key, value) { localStorage.setItem(key, value) },
    async delete(key) { localStorage.removeItem(key) },
}

function clearSolidStorage() {
    Object.keys(localStorage)
        .filter(k => k.startsWith("solidClientAuthenticationUser:") || k.startsWith("oidc.") || k.startsWith("issuerConfig:"))
        .forEach(k => localStorage.removeItem(k))
}

const session = new Session({
    secureStorage: storage,
    insecureStorage: storage,
}, "bib-pods-session")

async function updateStatus(text) {
    document.getElementById("solid-pod-status").textContent = text
}

async function onLoggedIn() {
    await updateStatus(`Logged in as ${session.info.webId}`)
    try {
        const dataset = await getSolidDataset(PROFILE_URL, { fetch: session.fetch })
        const turtle = await solidDatasetAsTurtle(dataset)
        await updateStatus(`Logged in as ${session.info.webId}\n\nProfile (${PROFILE_URL}):\n${turtle}`)
    } catch (e) {
        await updateStatus(`Logged in as ${session.info.webId}\n\nRead error: ${e.message}`)
    }
}

const redirectPromise = session.handleIncomingRedirect({
    url: window.location.href,
    restorePreviousSession: true,
})

document.addEventListener("DOMContentLoaded", async () => {
    await redirectPromise

    if (session.info.isLoggedIn) {
        await onLoggedIn()
        return
    }

    document.getElementById("solid-pod-connect").addEventListener("click", async () => {
        clearSolidStorage()
        await updateStatus("Logging in...")
        await session.login({
            oidcIssuer: SOLID_SERVER,
            redirectUrl: window.location.origin + window.location.pathname,
            clientName: "bib-pods-ext",
        })
    })
})
