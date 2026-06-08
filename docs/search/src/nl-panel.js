// Controlled natural language panel — deterministic grammar in both directions.
import { fromNL, toNL } from "./model.js"
import { panelParts, setStatus } from "./ui.js"

export function createNlPanel(onCommit) {
    const { body, status } = panelParts("panel-nl")
    const textarea = body.querySelector("textarea")
    let syncing = false

    textarea.addEventListener("input", () => {
        if (syncing) return
        try {
            const ast = fromNL(textarea.value)
            setStatus(status, null)
            onCommit(ast)
        } catch (err) {
            setStatus(status, `✗ ${err.message}`)
        }
    })

    return {
        render(ast) {
            syncing = true
            textarea.value = toNL(ast)
            syncing = false
            setStatus(status, null)
        },
    }
}
