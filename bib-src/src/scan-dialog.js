import { getChoice, isStorageReady, mergeProfileQuads } from "cori-sdk/storage/index.js"
import { getWebId } from "cori-sdk/storage/solid.js"
import { storageErrorMessage } from "cori-sdk/utils.js"
import { scanPod } from "./scan.js"
import { collectScanCandidates, scanReasonSteps } from "./scan-findings.js"
import { scanLabel } from "./scan-rules.js"
import { BP } from "./vocab.js"
import dialogHtml from "./ui/scan.html?raw"

const element = (tag, className, text) => {
    const el = document.createElement(tag)
    el.className = className
    el.textContent = text
    return el
}

export function mountScanDialog(root, { onSaved }) {
    root.insertAdjacentHTML("beforeend", dialogHtml)
    const get = id => root.querySelector(`#bp-scan-${id}`)
    const dialog = get("dialog")
    const sources = get("sources")
    const status = get("status")
    const review = get("review")
    const options = get("options")
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
        dialog.close()
    }

    async function scan() {
        const run = ++generation
        webId = getWebId()
        entries = []
        sources.replaceChildren()
        options.replaceChildren()
        review.hidden = accept.hidden = retry.hidden = error.hidden = true
        accept.disabled = true
        status.textContent = "Dein Pod wird durchsucht …"
        status.hidden = false
        options.setAttribute("aria-busy", "true")
        try {
            if (!webId || !connected()) throw new Error("Bitte verbinde deinen Pod erneut, um ihn zu durchsuchen.")
            const reports = await scanPod()
            if (run !== generation) return
            if (!connected()) throw new Error("Die Pod-Verbindung hat sich geändert. Bitte starte die Suche erneut.")
            for (const { result } of reports) {
                if (!result) continue
                const source = element("details", "bp-scan-source", "")
                source.append(element("summary", "", `Erkannt: ${result.sourceLabel}`))
                source.append(element("p", "", `Vordefinierte Regeln: „${result.ruleSetLabel}“.`))
                // Text only: source data and labels never become HTML.
                source.append(element("p", "bp-scan-source-path", `Gefunden in: ${result.source}`))
                sources.append(source)
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
                options.append(row)
                return { candidate, checkbox }
            })
            const failed = reports.filter(r => r.error)
            review.hidden = entries.length === 0
            accept.hidden = entries.length === 0
            updateSelection()
            status.hidden = entries.length > 0
            status.textContent = failed.length ? "Die Suche konnte nicht vollständig abgeschlossen werden." : "Keine passenden Profileinträge gefunden."
            if (failed.length) {
                showError(`Nicht geprüft: ${failed.map(r => r.label).join(", ")}. Bitte versuche es erneut.${entries.length ? " Vorhandene Vorschläge kannst du trotzdem übernehmen." : ""}`)
            }
            retry.hidden = !failed.length && entries.length > 0
        } catch (err) {
            if (run !== generation) return
            status.textContent = "Die Suche konnte nicht abgeschlossen werden."
            showError(storageErrorMessage(err))
            retry.hidden = false
        } finally {
            if (run === generation) options.setAttribute("aria-busy", "false")
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
