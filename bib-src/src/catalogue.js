// SOPAC ids in our store are "AK" + digits (e.g. AK4298169); the Munich catalogue URL
// expects "SAK" + 8-digit zero-padded form (e.g. SAK04298169).
export function sopacCatalogueUrl(sopacId) {
    const digits = sopacId.replace(/^AK/, "").padStart(8, "0")
    return `https://ssl.muenchen.de/aDISWeb/app?service=direct/0/Home/$DirectLink&sp=SOPAC&sp=SAK${digits}`
}

export async function fetchBook(endpoint, id) {
    const res = await fetch(`${endpoint}?q=id:${encodeURIComponent(id)}&wt=json`)
    if (!res.ok) throw new Error(`Solr ${res.status}: ${res.statusText}`)
    const json = await res.json()
    return json.response.docs[0]
}
