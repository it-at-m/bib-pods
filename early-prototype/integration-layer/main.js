import { getResourceInfo, createContainerAt, getSolidDataset, saveSolidDatasetAt, createSolidDataset, createThing, setThing, getThing, solidDatasetAsTurtle, deleteFile, buildThing, toRdfJsDataset } from "@inrupt/solid-client"
import { login, logout, getDefaultSession, handleIncomingRedirect } from "@inrupt/solid-client-authn-browser"
import { sparqlSelect, storeFromDataset } from "@foerderfunke/sem-ops-utils"

const SERVER = "http://localhost:3000"
const POD = "citizen-pod"
const WEBID_CARD_URL = `${SERVER}/${POD}/profile/card`
const APP_CONTAINER = `${SERVER}/${POD}/private/apps/library/`
const APP_PROFILE_URL = `${APP_CONTAINER}profile.ttl`
const ns = "https://example.com/"

const session = getDefaultSession()

export async function init() {
    await handleIncomingRedirect({ restorePreviousSession: true })
    if (session.info.isLoggedIn) {
        await ensureAppProfileSpace()
        return {
            loggedIn: true,
            msg: `Logged in\nWebID: ${session.info.webId}\nWebID card: ${WEBID_CARD_URL}\nApp profile: ${APP_PROFILE_URL}`
        }
    }
    return {
        loggedIn: false,
        msg: `Not logged in\nWebID card: ${WEBID_CARD_URL}\nApp profile: ${APP_PROFILE_URL}`
    }
}

export async function doLogin(redirectUrl) {
    if (session.info.isLoggedIn) return
    try {
        await login({
            oidcIssuer: SERVER,
            redirectUrl: redirectUrl || window.location.href,
            clientName: "solid-integration-layer",
        })
        return true
    } catch (err) {
        console.error("Solid login failed:", err)
        return false
    }
}

export async function doLogout() {
    await logout() // window.location.reload()
}

async function ensureContainer(url) {
    try {
        await getResourceInfo(url, { fetch: session.fetch })
    } catch (e) {
        if (e?.statusCode === 404) {
            await createContainerAt(url, { fetch: session.fetch })
            return
        }
        if (e?.statusCode === 409) return // container already exists
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
    if (!session.info.isLoggedIn) throw new Error("Not logged in")
    await ensureContainer(`${SERVER}/${POD}/private/`)
    await ensureContainer(`${SERVER}/${POD}/private/apps/`)
    await ensureContainer(APP_CONTAINER)
    await ensureDataset(APP_PROFILE_URL)
}

function userThingUrl() {
    return `${ns}user`
}

async function appProfileRead() {
    await ensureAppProfileSpace()
    const solidDs = await getSolidDataset(APP_PROFILE_URL, { fetch: session.fetch })
    return solidDatasetAsTurtle(solidDs)
}

async function appProfileWriteDemo() {
    await ensureAppProfileSpace()
    let ds = await getSolidDataset(APP_PROFILE_URL, { fetch: session.fetch })
    const existing = getThing(ds, userThingUrl())
    const userThing = buildThing(existing ?? createThing({ url: userThingUrl() }))
        .addStringNoLocale(`${ns}pred`, "hello world")
        .addStringNoLocale(`${ns}name`, "Benjamin")
        .addUrl(`${ns}rel`, `${ns}obj`)
        .build()
    ds = setThing(ds, userThing)
    await saveSolidDatasetAt(APP_PROFILE_URL, ds, { fetch: session.fetch })
    return APP_PROFILE_URL
}

export async function addProfileDatapoint(predStr, objStr) {
    let ds = await getSolidDataset(APP_PROFILE_URL, { fetch: session.fetch })
    const existing = getThing(ds, userThingUrl())
    const userThing = buildThing(existing ?? createThing({ url: userThingUrl() }))
        .addStringNoLocale(`${ns}${predStr}`, objStr)
        .build()
    ds = setThing(ds, userThing)
    await saveSolidDatasetAt(APP_PROFILE_URL, ds, { fetch: session.fetch })
}

export async function read() {
    try {
        return "Profile contents:\n\n" + await appProfileRead()
    } catch (e) {
        return "Read error:\n" + (e?.message ?? String(e))
    }
}

export async function write() {
    try {
        const url = await appProfileWriteDemo()
        return `RDF written to profile:\n${url}`
    } catch (e) {
        return "Write error:\n" + (e?.message ?? String(e))
    }
}

export async function clear() {
    try {
        await deleteFile(APP_PROFILE_URL, { fetch: session.fetch })
        await ensureAppProfileSpace()
        return "Profile contents:\n\n" + await appProfileRead()
    } catch (e) {
        return "Clear error:\n" + (e?.message ?? String(e))
    }
}

export async function getProfileAsStore() {
    const solidDs = await getSolidDataset(APP_PROFILE_URL, { fetch: session.fetch })
    const ds = toRdfJsDataset(solidDs)
    return storeFromDataset(ds)
}

export async function runQueryOnProfile(query) {
    const store = await getProfileAsStore()
    return await sparqlSelect(query, [store])
}
