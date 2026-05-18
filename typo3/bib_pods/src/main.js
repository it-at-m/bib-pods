import { mount, decorateH2s } from "cori/mount.js"
import { isActivated } from "cori/storage/index.js"
import { handleSolidCallback } from "cori/storage/solid.js"

if (document.body.hasAttribute("data-bp-solid-callback")) {
    handleSolidCallback()
} else {
    const isMainPage = location.pathname.includes(__MAIN_PATH__)
    if (isMainPage || isActivated()) {
        // Route the OIDC redirect to a static page next to the bundle, so TYPO3's
        // cHash validation never sees the IdP query params and 404s the response.
        const solidCallbackUrl = new URL("../solid-callback.html", import.meta.url).href
        mount(document.getElementById("bp-root"), {
            solrEndpoint: __SOLR_ENDPOINT__,
            solidCallbackUrl,
        })
        decorateH2s()
    }
}
