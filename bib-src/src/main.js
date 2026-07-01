// Thin composer: wires the bib-pods widget and the book-prompt dialog together and
// configures cori-sdk with the app's identifying strings.
import { setStorageConfig } from "cori-sdk/storage/index.js"
import { CORI, parseTurtle } from "cori-sdk/utils.js"
import configTtl from "../definitions/config.ttl.js"
import { installBookPrompt } from "./book-prompt.js"
import { installWidget } from "./widget.js"
import "./vocab.js"

const configStore = parseTurtle(configTtl)
const configLookup = (iri) => configStore.getObjects(null, iri, null)[0]?.value
setStorageConfig({
    appName: configLookup(CORI + "appName"),
    profileFilename: configLookup(CORI + "profileFilename"),
})

export async function mount(root, { solrEndpoint, qdrantEndpoint, solidCallbackUrl, landing, mainHref } = {}) {
    // book-prompt must exist before the widget's applyState first decorates cards,
    // since decorate-cards calls openBookPrompt on user click.
    let applyState = () => {}
    const openBookPrompt = installBookPrompt(root, { onSaved: () => applyState() })
    const widget = await installWidget(root, { solrEndpoint, qdrantEndpoint, solidCallbackUrl, openBookPrompt, landing, mainHref })
    applyState = widget.applyState
}
