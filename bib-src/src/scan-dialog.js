import { getChoice, isStorageReady, mergeProfileQuads } from "cori-sdk/storage/index.js"
import { getWebId } from "cori-sdk/storage/solid.js"
import { factory, getProfileSubject, RDFS_LABEL, storageErrorMessage } from "cori-sdk/utils.js"
import { scanPod } from "./scan.js"
import { collectScanCandidates, collectBranchLookups, scanReasonSteps } from "./scan-findings.js"
import { scanLabel } from "./scan-rules.js"
import { geocodeAddress, NOMINATIM_ENDPOINT } from "./geocoding.js"
import { nearestLibrary } from "./nearest-library.js"
import { BP } from "./vocab.js"
import dialogHtml from "./ui/scan.html?raw"

const element = (tag, className, text) => {
    const el = document.createElement(tag)
    el.className = className
    el.textContent = text
    return el
}

// SCCON demo: use this Munich address for the lookup without changing the Pod contact file.
const DEMO_ADDRESS = { street: "Museumsinsel 1", postalCode: "80538", city: "München", country: "Deutschland" }

export function mountScanDialog(root, { onSaved }) {
    root.insertAdjacentHTML("beforeend", dialogHtml)
    const get = id => root.querySelector(`#bp-scan-${id}`)
    const dialog = get("dialog")
    const sources = get("sources")
    const status = get("status")
    const error = get("error")
    const accept = get("accept")
    const retry = get("retry")
    const cancel = get("cancel")
    const launcher = root.querySelector("#bp-scan-pod-link")
    let generation = 0
    let saving = false
    let webId = null
    let entries = []

    const connected = () => getChoice() === "solid" && isStorageReady() && getWebId() === webId
    const selected = () => entries.filter(({ checkbox }) => checkbox.checked)
    function updateSelection() {
        const count = selected().length
        accept.disabled = saving || count === 0
        accept.textContent = count ? `${count} ${count === 1 ? "Eintrag" : "Einträge"} übernehmen` : "Auswahl übernehmen"
    }
    function showError(message) {
        error.textContent = message
        error.hidden = false
    }
    function close() {
        if (saving) return
        generation++
        sources.replaceChildren()
        entries = []
        dialog.close()
    }

    async function scan() {
        const run = ++generation
        webId = getWebId()
        entries = []
        sources.replaceChildren()
        accept.hidden = retry.hidden = error.hidden = true
        accept.disabled = true
        status.textContent = "Dein Pod wird durchsucht …"
        status.hidden = false
        sources.setAttribute("aria-busy", "true")
        try {
            if (!webId || !connected()) throw new Error("Bitte verbinde deinen Pod erneut, um ihn zu durchsuchen.")
            const reports = await scanPod()
            if (run !== generation) return
            if (!connected()) throw new Error("Die Pod-Verbindung hat sich geändert. Bitte starte die Suche erneut.")
            const groups = new Map()
            for (const { result } of reports) {
                if (!result) continue
                const source = element("details", "bp-scan-source", "")
                source.open = true
                const heading = element("summary", "", `Erkannt: ${result.sourceLabel}`)
                heading.id = `bp-scan-source-${groups.size}`
                // Text only: source data and labels never become HTML.
                heading.title = `Gefunden in: ${result.source}`
                const content = element("div", "bp-scan-source-content", "")
                source.append(heading, content)
                sources.append(source)
                groups.set(result.scanSource, { content, heading })
            }
            const branchLookups = collectBranchLookups(reports)
            for (const lookup of branchLookups) {
                // Host HTML can switch Nominatim instances without rebuilding the app.
                const endpoint = root.dataset.nominatimEndpoint || NOMINATIM_ENDPOINT
                const address = DEMO_ADDRESS
                const row = element("div", "bp-scan-lookup", "")
                row.append(element("strong", "", "Bibliothek in deiner Nähe"))
                row.append(element("p", "", `${address.street}, ${address.postalCode} ${address.city}, ${address.country}`))
                const consent = document.createElement("input")
                consent.type = "checkbox"
                consent.checked = false
                const consentLabel = element("label", "bp-scan-consent", "")
                const service = endpoint === NOMINATIM_ENDPOINT ? "Nominatim (OpenStreetMap)" : `Nominatim (${new URL(endpoint).host})`
                const consentText = element("span", "", `Ich stimme zu, dass diese Adresse zur Ermittlung der Koordinaten an ${service} gesendet wird.`)
                consentLabel.append(consent, consentText)
                const button = element("button", "button", lookup.actionLabel)
                button.type = "button"
                button.disabled = true
                const message = element("p", "bp-scan-lookup-error", "")
                message.setAttribute("role", "alert")
                message.hidden = true
                consent.addEventListener("change", () => {
                    message.hidden = true
                    button.disabled = button.hidden || !consent.checked
                })
                button.addEventListener("click", async () => {
                    if (!consent.checked || button.disabled) return
                    button.disabled = consent.disabled = true
                    message.hidden = true
                    button.textContent = "Koordinaten werden ermittelt …"
                    try {
                        const coordinates = await geocodeAddress(address, { endpoint })
                        if (!dialog.open || run !== generation || !connected()) return
                        const library = nearestLibrary(coordinates)
                        if (!library) throw new Error("Keine Bibliothek mit Koordinaten gefunden.")
                        console.log("[bib-pods] Nächstgelegene Bibliothek:", library)
                        if (!row.nextElementSibling?.classList.contains("bp-scan-branch-choice")) {
                            const option = element("div", "bp-scan-option bp-scan-branch-choice", "")
                            const checkbox = document.createElement("input")
                            checkbox.type = "checkbox"
                            checkbox.id = `bp-scan-library-${entries.length}`
                            checkbox.checked = true
                            checkbox.addEventListener("change", updateSelection)
                            const text = element("div", "bp-scan-option-text", "")
                            const label = element("label", "", "")
                            label.htmlFor = checkbox.id
                            label.append(element("strong", "", library.name))
                            const details = element("p", "bp-scan-branch-reason",
                                `Nächstgelegene Bibliothek · ${library.distanceKm.toLocaleString("de-DE", { maximumFractionDigits: 1 })} km Luftlinie · `)
                            const link = element("a", "", "Mehr")
                            link.href = library.uri
                            link.target = "_blank"
                            link.rel = "noopener noreferrer"
                            details.append(link)
                            text.append(label, details)
                            option.append(checkbox, text)
                            row.after(option)
                            const branch = factory.namedNode(library.uri)
                            entries.push({ checkbox, candidate: { quads: [
                                factory.quad(factory.namedNode(getProfileSubject()), factory.namedNode(BP + "nearestLibrary"), branch),
                                factory.quad(branch, factory.namedNode(RDFS_LABEL), factory.literal(library.name)),
                            ] } })
                            accept.hidden = false
                            updateSelection()
                        }
                        row.classList.add("bp-scan-lookup-found")
                        consentLabel.hidden = button.hidden = true
                    } catch (err) {
                        console.warn("[bib-pods] Geocoding fehlgeschlagen:", err)
                        message.textContent = "Die Koordinaten konnten nicht ermittelt werden. Bitte versuche es erneut."
                        message.hidden = false
                    } finally {
                        consent.disabled = false
                        button.disabled = button.hidden || !consent.checked
                        button.textContent = lookup.actionLabel
                    }
                })
                row.append(consentLabel, button, message)
                groups.get(lookup.scanSource).content.append(row)
            }
            entries = collectScanCandidates(reports).map((candidate, index) => {
                const row = element("div", "bp-scan-option", "")
                const checkbox = document.createElement("input")
                checkbox.type = "checkbox"
                checkbox.id = `bp-scan-candidate-${index}`
                checkbox.checked = true
                checkbox.addEventListener("change", updateSelection)
                const text = element("div", "bp-scan-option-text", "")
                const label = element("label", "", "")
                label.htmlFor = checkbox.id
                label.append(element("strong", "", candidate.label))
                text.append(label)
                const actions = [...new Set(candidate.reasons.map(({ action }) =>
                    action === BP + "Derive" ? "Abgeleiteter Vorschlag" : scanLabel(action)))]
                const why = element("details", "bp-scan-reason", "")
                why.append(element("summary", "", `${candidate.propertyLabel} · ${actions.join(", ")} · Warum?`))
                const multipleSources = new Set(candidate.reasons.map(r => r.source)).size > 1
                const seen = new Set()
                for (const reason of candidate.reasons) {
                    const steps = scanReasonSteps(candidate, reason)
                    if (!steps.length) {
                        why.append(element("p", "", `Regel: ${reason.rule}`))
                        continue
                    }
                    for (const step of steps) {
                        const key = JSON.stringify([multipleSources ? reason.source : null, step])
                        if (seen.has(key)) continue
                        seen.add(key)
                        if (multipleSources) why.append(element("p", "", reason.source))
                        const inference = element("div", "bp-scan-inference", "")
                        const condition = element("div", "bp-scan-inference-side", "")
                        condition.append(element("span", "bp-scan-inference-step", "Wenn"))
                        condition.append(element("span", "bp-scan-inference-field", `${step.field}:`))
                        if (step.answer !== null) condition.append(element("span", "bp-scan-inference-value", step.answer))
                        const conclusion = element("div", "bp-scan-inference-side", "")
                        conclusion.append(element("span", "bp-scan-inference-step", "Dann vorschlagen"))
                        conclusion.append(element("span", "bp-scan-inference-field", `${step.property}:`))
                        conclusion.append(element("span", "bp-scan-inference-value", step.value))
                        inference.append(condition, conclusion)
                        why.append(inference)
                    }
                }
                text.append(why)
                row.append(checkbox, text)
                const group = groups.get(candidate.scanSource)
                if (!group.options) {
                    group.options = element("div", "bp-scan-options", "")
                    group.options.setAttribute("role", "group")
                    group.options.setAttribute("aria-labelledby", group.heading.id)
                    group.content.append(group.options)
                }
                group.options.append(row)
                return { candidate, checkbox }
            })
            const failed = reports.filter(r => r.error)
            const hasFindings = entries.length > 0 || branchLookups.length > 0
            accept.hidden = entries.length === 0
            updateSelection()
            status.hidden = hasFindings
            status.textContent = failed.length ? "Die Suche konnte nicht vollständig abgeschlossen werden." : "Keine passenden Daten gefunden."
            if (failed.length) {
                showError(`Nicht geprüft: ${failed.map(r => r.label).join(", ")}. Bitte versuche es erneut.${entries.length ? " Vorhandene Vorschläge kannst du trotzdem übernehmen." : ""}`)
            }
            retry.hidden = !failed.length && hasFindings
        } catch (err) {
            if (run !== generation) return
            status.textContent = "Die Suche konnte nicht abgeschlossen werden."
            showError(storageErrorMessage(err))
            retry.hidden = false
        } finally {
            if (run === generation) sources.setAttribute("aria-busy", "false")
        }
    }

    launcher.addEventListener("click", e => {
        e.preventDefault()
        if (saving || dialog.open) return
        dialog.showModal()
        scan()
    })
    retry.addEventListener("click", scan)
    cancel.addEventListener("click", close)
    dialog.addEventListener("cancel", e => { e.preventDefault(); close() })
    dialog.addEventListener("click", e => { if (e.target === dialog) close() })
    accept.addEventListener("click", async () => {
        const selection = selected()
        if (saving || !selection.length) return
        if (!connected()) {
            showError("Die Pod-Verbindung hat sich geändert. Bitte starte die Suche erneut.")
            retry.hidden = false
            accept.disabled = true
            return
        }
        saving = true
        error.hidden = true
        accept.disabled = cancel.disabled = retry.disabled = true
        entries.forEach(({ checkbox }) => { checkbox.disabled = true })
        accept.textContent = "Wird gespeichert …"
        try {
            await mergeProfileQuads(selection.flatMap(({ candidate }) => candidate.quads))
        } catch (err) {
            showError(`Die Auswahl konnte nicht gespeichert werden. ${storageErrorMessage(err)}`)
            return
        } finally {
            saving = false
            cancel.disabled = retry.disabled = false
            entries.forEach(({ checkbox }) => { checkbox.disabled = false })
            updateSelection()
        }
        close()
        try {
            await onSaved()
        } catch (err) {
            console.error("[bib-pods] Anzeige nach Scan-Übernahme fehlgeschlagen:", err)
        }
    })
}
