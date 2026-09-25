export const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search"

let nextRequest = 0

export async function geocodeAddress(address, { endpoint = NOMINATIM_ENDPOINT } = {}) {
    // Space requests from this page at least a second apart.
    const delay = Math.max(0, nextRequest - Date.now())
    nextRequest = Date.now() + delay + 1100
    if (delay) await new Promise(resolve => setTimeout(resolve, delay))

    const url = new URL(endpoint)
    url.search = new URLSearchParams({
        street: address.street,
        postalcode: address.postalCode,
        city: address.city,
        country: address.country,
        format: "jsonv2",
        limit: "1",
    })
    // Plain fetch: no Solid credentials or persistent cache.
    const response = await fetch(url, {
        headers: { Accept: "application/json" },
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "origin",
        signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) throw new Error(`Nominatim: HTTP ${response.status}`)
    const [result] = await response.json()
    if (!result) throw new Error("Für diese Adresse wurden keine Koordinaten gefunden.")
    const lat = parseFloat(result.lat), lon = parseFloat(result.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("Ungültige Koordinaten von Nominatim.")
    return { lat, lon }
}
