import { mount, decorateH2s } from "cori/mount.js"
import { isActivated } from "cori/storage.js"

const isMainPage = location.pathname.includes(__MAIN_PATH__)
if (isMainPage || isActivated()) {
    mount(document.getElementById("bp-root"), {
        solrEndpoint: __SOLR_ENDPOINT__,
        solidPodSuggestions: __SOLID_POD_SUGGESTIONS__,
    })
    decorateH2s()
}

