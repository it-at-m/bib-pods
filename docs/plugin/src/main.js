import { mount, decorateH2s } from "cori/mount.js"

mount(document.getElementById("bp-root"), {
    solrEndpoint: __SOLR_ENDPOINT__,
    solidPodSuggestions: __SOLID_POD_SUGGESTIONS__,
})

decorateH2s()
