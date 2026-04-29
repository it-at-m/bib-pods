import { getResourceInfo, createContainerAt, getSolidDataset, saveSolidDatasetAt, createSolidDataset, createThing, setThing, buildThing, getThingAll, getStringNoLocale, toRdfJsDataset } from "@inrupt/solid-client"
import { Session } from "@inrupt/solid-client-authn-browser"
import { datasetToTurtle } from "@foerderfunke/sem-ops-utils"

const SOLID_SERVER = "http://localhost:3000"
const POD = "citizen-pod"
const APP_CONTAINER = `${SOLID_SERVER}/${POD}/bib-pods-project/`
const APP_PROFILE_URL = `${APP_CONTAINER}profile.ttl`
const INDEX_BACKEND = "solr" // solr / elasticsearch
const SOLR_URL = "http://localhost:8983/solr/interim-index"
const ES_URL = "http://localhost:9200/interim-index"

async function queryIndexByAuthors(authors) {
    if (INDEX_BACKEND === "elasticsearch") {
        const res = await fetch(`${ES_URL}/_search`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                query: { bool: { should: authors.map(a => ({ match: { author: a } })) } },
                _source: ["title", "author", "publishDate"]
            })
        })
        const json = await res.json()
        if (json.error) throw new Error(json.error.reason ?? JSON.stringify(json.error))
        return {
            numFound: json.hits.total.value,
            docs: json.hits.hits.map(h => ({ id: h._id, ...h._source }))
        }
    }
    const params = new URLSearchParams({
        q: authors.map(a => `author:${a}`).join(" OR "),
        fl: "id,title,author,publishDate"
    })
    const res = await fetch(`${SOLR_URL}/select?${params}`)
    const json = await res.json()
    if (json.error) throw new Error(json.error.msg)
    return json.response
}

// localStorage-backed storage so OIDC state survives the redirect
const storage = {
    async get(key) { return localStorage.getItem(key) || undefined },
    async set(key, value) { localStorage.setItem(key, value) },
    async delete(key) { localStorage.removeItem(key) },
}

async function ensureContainer(url) {
    try {
        await getResourceInfo(url, { fetch: session.fetch })
    } catch (e) {
        if (e?.statusCode === 404) {
            await createContainerAt(url, { fetch: session.fetch })
            return
        }
        if (e?.statusCode === 409) return
        throw e
    }
}

async function ensureDataset(url) {
    try {
        return await getSolidDataset(url, { fetch: session.fetch })
    } catch (e) {
        if (e?.statusCode === 404) {
            const empty = createSolidDataset()
            await saveSolidDatasetAt(url, empty, { fetch: session.fetch })
            return empty
        }
        throw e
    }
}

async function ensureAppProfileSpace() {
    await ensureContainer(APP_CONTAINER)
    await ensureDataset(APP_PROFILE_URL)
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
    document.getElementById("pod-actions").style.display = "block"
    document.getElementById("solid-pod-connect").style.display = "none"
    document.getElementById("solid-pod-logout").style.display = ""
    try {
        await ensureAppProfileSpace()
        await updateStatus(`Logged in as ${session.info.webId}`)
    } catch (e) {
        await updateStatus(`Logged in as ${session.info.webId}\n\nRead error: ${e.message}`)
    }
}

async function logout() {
    try {
        await session.logout()
    } finally {
        clearSolidStorage()
        window.location.replace(window.location.origin + window.location.pathname)
    }
}

async function writeToPod() {
    await updateOutput("Writing to pod...")
    try {
        await ensureAppProfileSpace()
        let dataset = await getSolidDataset(APP_PROFILE_URL, { fetch: session.fetch })

        const pref = buildThing(createThing({ url: "http://example.org/user" }))
            .addStringNoLocale("https://www.muenchner-stadtbibliothek.de/bib-pods#favoriteAuthor", "Sapkowski")
            .build()

        dataset = setThing(dataset, pref)
        await saveSolidDatasetAt(APP_PROFILE_URL, dataset, { fetch: session.fetch })

        const ds = toRdfJsDataset(dataset)
        let turtle = await datasetToTurtle(ds, {
            bp:  "https://www.muenchner-stadtbibliothek.de/bib-pods#",
            ex: "http://example.org/"
        })
        // const turtle = await solidDatasetAsTurtle(dataset)
        await updateOutput(`Wrote to ${APP_PROFILE_URL}:\n\n${turtle}`)
    } catch (e) {
        await updateOutput(`Write error: ${e.message}`)
    }
}

async function getRecommendations() {
    await updateOutput("Reading preferences from pod...")
    try {
        const dataset = await getSolidDataset(APP_PROFILE_URL, { fetch: session.fetch })
        const things = getThingAll(dataset)
        const authors = things
            .map(t => getStringNoLocale(t, "https://www.muenchner-stadtbibliothek.de/bib-pods#favoriteAuthor"))
            .filter(Boolean)

        if (authors.length === 0) {
            await updateOutput("No author preferences found in pod. Click 'Write to Pod' first.")
            return
        }

        await updateOutput(`Found authors: ${authors.join(", ")}\nQuerying ${INDEX_BACKEND}...`)

        const { numFound, docs } = await queryIndexByAuthors(authors)
        let output = `Recommendations based on: ${authors.join(", ")}\n`
        output += `Found ${numFound} result(s):\n\n`
        for (const doc of docs) {
            const year = Array.isArray(doc.publishDate) ? doc.publishDate[0] : doc.publishDate
            output += `  ${doc.title} (${year ?? "n/a"}) — ${[].concat(doc.author ?? []).join(", ")}\n` // doc.title: string in ES, single-element array in Solr (coerces via .toString())
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
    document.getElementById("solid-pod-logout").addEventListener("click", logout)

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
