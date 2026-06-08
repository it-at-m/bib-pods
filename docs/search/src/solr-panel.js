// Solr query text panel — CodeMirror with the solr mode, like the query page.
import { fromSolr, toSolr } from "./model.js"
import { panelParts, setStatus } from "./ui.js"

export function createSolrPanel(onCommit) {
    const { body, status } = panelParts("panel-solr")
    const cm = CodeMirror(body, { mode: "solr", lineWrapping: true, value: "" })
    let syncing = false

    cm.on("change", () => {
        if (syncing) return
        try {
            const ast = fromSolr(cm.getValue())
            setStatus(status, null)
            onCommit(ast)
        } catch (err) {
            setStatus(status, `✗ ${err.message}`)
        }
    })

    return {
        render(ast) {
            syncing = true
            cm.setValue(toSolr(ast))
            syncing = false
            setStatus(status, null)
        },
    }
}
