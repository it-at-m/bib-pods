import { handleSolidCallback } from "cori-sdk/storage/solid.js"
import { isActivated } from "cori-sdk/storage/index.js"
import { mount } from "bib-src/src/main.js"

// Test aid on the main page: quick links to the other pages with the plugin activated.
function mountPluginPagesNav(root) {
    const nav = document.createElement("p")
    nav.style.cssText = "font-size: 0.6em; margin: 1.5em 0 0; text-align: right; color: #aaa;"
    nav.innerHTML = ["/", "/film-kino", "/jung-erwachsen", "/nachhaltigkeit"]
        .map(p => `<a href="${p}" style="color: inherit;">${p === "/" ? "startseite" : p.slice(1)}</a>`).join(" · ")
    root.append(nav)
}

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
            qdrantEndpoint: __QDRANT_ENDPOINT__,
            solidCallbackUrl,
            landing: isMainPage,
            mainHref: __MAIN_PATH__
        }).then(() => {
            if (isMainPage) mountPluginPagesNav(document.getElementById("bp-root"))
        })
    }
}
