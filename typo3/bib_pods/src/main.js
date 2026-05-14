import { mount, decorateH2s } from "cori/mount.js"

const root = document.getElementById("bp-root")

mount(root, {
    solrEndpoint: __SOLR_ENDPOINT__,
    isLocalDev: root.dataset.localDev === "1",
})

decorateH2s()
