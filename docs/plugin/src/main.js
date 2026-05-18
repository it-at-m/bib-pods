import { mount, decorateH2s, decorateBooks } from "cori/mount.js"

mount(document.getElementById("bp-root"), {
    solrEndpoint: __SOLR_ENDPOINT__,
})

decorateH2s()
decorateBooks()
