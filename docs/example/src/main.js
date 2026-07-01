import { isActivated } from "cori-sdk/storage/index.js"
import { mount } from "bib-src/src/main.js"

// A regular (non-main) library page: like TYPO3's host gating, the widget mounts only
// once a storage location has been chosen. So after "Abmelden" the button stays for the
// rest of the current page view, but is gone on the next reload. mainHref points back to
// the plugin page so the modal's links navigate there.
if (isActivated()) {
    mount(document.getElementById("bp-root"), {
        solrEndpoint: __SOLR_ENDPOINT__,
        qdrantEndpoint: __QDRANT_ENDPOINT__,
        landing: false,
        mainHref: "../plugin/",
    })
}
