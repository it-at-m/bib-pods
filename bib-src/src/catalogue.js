// SOPAC ids in our store are "AK" + digits (e.g. AK4298169); the Munich catalogue URL
// expects "SAK" + 8-digit zero-padded form (e.g. SAK04298169).
export function sopacCatalogueUrl(sopacId) {
    const digits = sopacId.replace(/^AK/, "").padStart(8, "0")
    return `https://ssl.muenchen.de/aDISWeb/app?service=direct/0/Home/$DirectLink&sp=SOPAC&sp=SAK${digits}`
}

async function fetchFirst(endpoint, field, value) {
    const res = await fetch(`${endpoint}?q=${field}:${encodeURIComponent(value)}&wt=json`)
    if (!res.ok) throw new Error(`Solr ${res.status}: ${res.statusText}`)
    const json = await res.json()
    return json.response.docs[0]
}

export function fetchBook(endpoint, id) {
    return fetchFirst(endpoint, "id", id)
}

// onleihe_id isn't guaranteed unique — the same Onleihe title occasionally gets
// catalogued more than once (re-imported holdings) — but duplicates share the same
// bibliographic data, so any match is an equally valid resolution; taking the first
// is fine.
export function fetchBookByOnleiheId(endpoint, mediaId) {
    return fetchFirst(endpoint, "onleihe_id", mediaId)
}
