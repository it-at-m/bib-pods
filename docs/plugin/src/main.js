import { mount, decorateH2s } from "cori/mount.js"

mount(document.getElementById("bp-root"), {
    solrEndpoint: __SOLR_ENDPOINT__,
})

decorateH2s()
