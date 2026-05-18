import { mount, decorateBooks } from "cori/mount.js"

mount(document.getElementById("bp-root"), {
    solrEndpoint: __SOLR_ENDPOINT__,
})

decorateBooks()
