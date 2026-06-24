import { mount } from "bib-src/src/main.js"

mount(document.getElementById("bp-root"), {
    solrEndpoint: __SOLR_ENDPOINT__,
    qdrantEndpoint: __QDRANT_ENDPOINT__,
    landing: true,
})
