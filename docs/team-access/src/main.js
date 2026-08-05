// The team's side of the sharing: log in as the team account or as one of its people and
// read off what a citizen's pod actually answers. Counterpart to the "grant access"
// dialog on the plugin page. The team's own roster lives here too — the citizen grants
// to the group once, and who that currently means is decided on this page.
import { initSession, isLoggedIn, login, logout, getWebId, authFetch, currentPageUrl } from "cori-sdk/storage/solid.js"
import { parseTurtle } from "cori-sdk/utils.js"

const POD = "http://localhost:3000"
const GROUP_DOC = `${POD}/team/members.ttl`
const GROUP_URI = `${GROUP_DOC}#team`
const TEAM_WEBID = `${POD}/team/profile/card#me`
// The default roster: the individual people plus the shared team account. Named entries
// make a read attributable to a person; the shared account does not, which is the
// trade-off for having it here at all. Listed last so the people come first.
const ROSTER = [
    { webId: `${POD}/team-anna/profile/card#me`, label: "Anna" },
    { webId: `${POD}/team-peter/profile/card#me`, label: "Peter" },
    { webId: TEAM_WEBID, label: "Team-Konto" },
]

const VCARD = "http://www.w3.org/2006/vcard/ns#"

const $ = (id) => document.getElementById(id)
// Members are minted as team-<name> on this pod, so the name reads straight back out of
// the WebID for anyone the default roster doesn't already label.
const webIdFor = (name) => `${POD}/team-${name}/profile/card#me`
const nameOf = (webId) => ROSTER.find((s) => s.webId === webId)?.label
    ?? webId.match(/\/team-([^/]+)\//)?.[1]?.replace(/^./, (c) => c.toUpperCase())
    ?? webId

// --- The citizen's resource ---

// A 404 is not a denial: the pod is answering this WebID, the resource just isn't there
// yet (the Merkliste file is created by the first „grant access“). Only 401/403 mean the
// pod is withholding it.
const VERDICT = { 200: "✅ Zugriff erlaubt", 404: "📄 Noch nichts freigegeben" }

// No polling: the state is read once per reload (or via „Prüfen“).
async function check() {
    // no-store: this reads a permission state that changes underneath us, and a cached
    // 200 would show access that has since been withdrawn.
    const response = await authFetch($("resource").value.trim(), { cache: "no-store" })
    const allowed = response.status === 200
    $("http-status").textContent = `${VERDICT[response.status] ?? "⛔ Kein Zugriff"}: HTTP ${response.status}`
    $("http-status").className = allowed ? "ok" : response.status === 404 ? "" : "no"
    $("content").hidden = !allowed
    if (allowed) $("content").textContent = await response.text()
}

// --- The team's roster ---

// The pod server dereferences this document unauthenticated while checking access, so it
// has to be world-readable. Write stays with the team account and with the people listed
// on it, which is what "the team maintains itself" means in practice.
const GROUP_ACL = `@prefix acl: <http://www.w3.org/ns/auth/acl#>.
@prefix foaf: <http://xmlns.com/foaf/0.1/>.

# Der Pod-Server der Bürgerin liest diese Liste unangemeldet — sie muss öffentlich sein.
<#public> a acl:Authorization;
    acl:agentClass foaf:Agent; acl:accessTo <./members.ttl>; acl:mode acl:Read.

<#owner> a acl:Authorization;
    acl:agent <${TEAM_WEBID}>; acl:accessTo <./members.ttl>;
    acl:mode acl:Read, acl:Write, acl:Control.

# Das Team pflegt sich selbst: wer auf der Liste steht, darf sie auch ändern.
<#members> a acl:Authorization;
    acl:agentGroup <${GROUP_URI}>; acl:accessTo <./members.ttl>;
    acl:mode acl:Read, acl:Write.
`

// Absolute subject on purpose: a relative <#team> resolves fine on the server
// (it knows the document's URL) but not when this page parses the document back, which
// has no base URI to resolve against.
const groupDoc = (members) => `@prefix vcard: <${VCARD}>.

<${GROUP_URI}> a vcard:Group${members.map((m) => `;\n    vcard:hasMember <${m}>`).join("")}.
`

const putTurtle = (uri, body) =>
    authFetch(uri, { method: "PUT", headers: { "content-type": "text/turtle" }, body })

const writeMembers = async (members) => {
    await putTurtle(GROUP_DOC, groupDoc(members))
    await putTurtle(`${GROUP_DOC}.acl`, GROUP_ACL)
}

async function saveMembers(members) {
    await writeMembers(members)
    await renderGroup()
    await check()   // one's own access changes with the list one just edited
}

// The roster plus, from the server's own WAC-Allow header, whether this session may
// change it — so the page offers only the edits the pod would actually accept.
async function readRoster() {
    const response = await authFetch(GROUP_DOC, { cache: "no-store" })
    if (!response.ok) return { members: null, writable: false, raw: null }
    const mine = /user="([^"]*)"/.exec(response.headers.get("wac-allow") ?? "")?.[1] ?? ""
    const raw = await response.text()
    return {
        members: parseTurtle(raw).getQuads(GROUP_URI, VCARD + "hasMember", null, null).map((q) => q.object.value),
        writable: mine.includes("write"),
        raw,
    }
}

// Every control on this page does the same thing — write a different member list — so
// each one is just a label plus the list it would write.
function button(label, members) {
    const element = document.createElement("button")
    element.textContent = label
    element.onclick = () => saveMembers(members)
    return element
}

async function renderGroup() {
    // The roster is part of the setup, not something to click into being. Only accounts
    // the team's pod lets write may create it; for anyone else this quietly does nothing
    // and the page just shows who is currently listed.
    let roster = await readRoster()
    if (roster.members === null) {
        await writeMembers(ROSTER.map((s) => s.webId))
        roster = await readRoster()   // members still null if this account may not write it
    }
    const { members, writable, raw } = roster

    const me = getWebId()
    // Edit controls only where the pod grants write: the list belongs to the team account
    // and to the people currently on it, so someone just removed from it cannot put
    // themselves back — and shouldn't be offered a button that would only fail.
    $("members").replaceChildren(...(members ?? []).map((member) => {
        const entry = document.createElement("li")
        entry.append(nameOf(member) + (member === me ? " (angemeldet)" : ""))
        if (writable) entry.append(button("entfernen", members.filter((m) => m !== member)))
        return entry
    }))
    // Taking someone on is the one control that isn't derived from a row.
    $("group-actions").hidden = !writable
    $("add-member").onclick = () => {
        const name = $("new-member").value.trim().toLowerCase()
        if (!name) return
        $("new-member").value = ""
        saveMembers([...(members ?? []), webIdFor(name)])
    }
    $("group-raw").textContent = raw ?? ""
    $("group-raw").hidden = !raw

    // Only worth a line when it explains a 403 above; being listed needs no announcement.
    $("membership").textContent = (members ?? []).includes(me)
        ? ""
        : "✖ steht nicht auf der Team-Liste: über die Gruppe gibt es deshalb keinen Zugriff"
}

// --- Start ---

async function start() {
    await initSession({ redirectUri: currentPageUrl() })

    $("login-section").hidden = isLoggedIn()
    $("access-section").hidden = !isLoggedIn()
    $("group-section").hidden = !isLoggedIn()
    $("login-btn").onclick = () => login($("issuer").value.trim(), { redirectUri: currentPageUrl() })
    $("logout-btn").onclick = async () => { await logout(); location.reload() }
    $("check-btn").onclick = check

    if (isLoggedIn()) {
        $("webid").textContent = getWebId()
        // Roster first: the grant points at the group document, so reading the access
        // status before that document exists would report no access and then go stale.
        await renderGroup()
        await check()
    }
}

start()
