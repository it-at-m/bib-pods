// Tiny shared helpers for the search page panels.

export function panelParts(panelId) {
    const section = document.getElementById(panelId)
    return {
        body: section.querySelector(".panel-body"),
        status: section.querySelector(".panel-status"),
    }
}

// Show a parse/representability problem on the panel heading; null clears it.
export function setStatus(el, message) {
    el.textContent = message ?? ""
}
