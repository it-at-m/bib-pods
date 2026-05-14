import { mount, decorateH2s } from "cori/mount.js"
import { isActivated } from "cori/storage.js"

const root = document.getElementById("bp-root")

if (root) {
    const isMainPage = location.pathname.includes(__MAIN_PATH__)
    if (isMainPage || isActivated()) {
        mount(root, {
            solrEndpoint: __SOLR_ENDPOINT__,
            solidPodSuggestions: __SOLID_POD_SUGGESTIONS__,
            isLocalDev: isMainPage && root.dataset.localDev === "1",
        })
        decorateH2s()
    }
}
