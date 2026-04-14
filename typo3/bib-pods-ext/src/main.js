import { getSolidDataset, saveSolidDatasetAt, solidDatasetAsTurtle, createThing, setThing, buildThing, getThingAll, getStringNoLocale } from "@inrupt/solid-client"
import { Session } from "@inrupt/solid-client-authn-browser"

const SOLID_SERVER = "http://localhost:3000"
const POD = "citizen-pod"
const PROFILE_URL = `${SOLID_SERVER}/${POD}/profile/card`
const SOLR_URL = "http://localhost:8983/solr/interim-index"

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

async function updateOutput(text) {
    document.getElementById("pod-actions-output").textContent = text
}

async function onLoggedIn() {
    await updateStatus(`Logged in as ${session.info.webId}`)
    document.getElementById("pod-actions").style.display = "block"
    try {
        const dataset = await getSolidDataset(PROFILE_URL, { fetch: session.fetch })
        const turtle = await solidDatasetAsTurtle(dataset)
        await updateStatus(`Logged in as ${session.info.webId}\n\nProfile (${PROFILE_URL}):\n${turtle}`)
    } catch (e) {
        await updateStatus(`Logged in as ${session.info.webId}\n\nRead error: ${e.message}`)
    }
}

async function writeToPod() {
    await updateOutput("Writing to pod...")
    try {
        let dataset = await getSolidDataset(PROFILE_URL, { fetch: session.fetch })

        const pref = buildThing(createThing({ name: "author-preference" }))
            .addStringNoLocale("http://schema.org/author", "Sapkowski")
            .build()

        dataset = setThing(dataset, pref)
        await saveSolidDatasetAt(PROFILE_URL, dataset, { fetch: session.fetch })

        const turtle = await solidDatasetAsTurtle(dataset)
        await updateOutput(`Wrote to ${PROFILE_URL}:\n${turtle}`)
    } catch (e) {
        await updateOutput(`Write error: ${e.message}`)
    }
}

async function getRecommendations() {
    await updateOutput("Reading preferences from pod...")
    try {
        const dataset = await getSolidDataset(PROFILE_URL, { fetch: session.fetch })
        const things = getThingAll(dataset)
        const authors = things
            .map(t => getStringNoLocale(t, "http://schema.org/author"))
            .filter(Boolean)

        if (authors.length === 0) {
            await updateOutput("No author preferences found in pod. Click 'Write to Pod' first.")
            return
        }

        await updateOutput(`Found authors: ${authors.join(", ")}\nQuerying Solr...`)

        const authorQuery = authors.map(a => `authors:${a}`).join(" OR ")
        const params = new URLSearchParams({
            q: authorQuery,
            fl: "id,title,authors,year"
        })
        const res = await fetch(`${SOLR_URL}/select?${params}`)
        const json = await res.json()

        if (json.error) {
            await updateOutput(`Solr error: ${json.error.msg}`)
            return
        }

        const { numFound, docs } = json.response
        let output = `Recommendations based on: ${authors.join(", ")}\n`
        output += `Found ${numFound} result(s):\n\n`
        for (const doc of docs) {
            output += `  ${doc.title} (${doc.year ?? "n/a"}) — ${(doc.authors ?? []).join(", ")}\n`
        }
        await updateOutput(output)
    } catch (e) {
        await updateOutput(`Error: ${e.message}`)
    }
}

const redirectPromise = session.handleIncomingRedirect({
    url: window.location.href,
    restorePreviousSession: true,
})

async function init() {
    await redirectPromise

    document.getElementById("write-to-pod").addEventListener("click", writeToPod)
    document.getElementById("get-recommendations").addEventListener("click", getRecommendations)

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
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init)
} else {
    init()
}
