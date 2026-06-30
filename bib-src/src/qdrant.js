import { BP } from "./vocab.js"

// Recommends books from the inspira_BIB recommender, seeded by the whole Merkliste as
// positive examples. The recommender keys points on the BARE numeric akkey (bp:savedBook
// holds "AK4298169" → send "4298169"), ignores ids not in the collection, and echoes the
// used ones in `basedOn`; if none match it answers 422, handled here as "nothing matched".
// Returns { savedIds, basedOn, results, empty }; each result point's payload.metadata
// carries akkey/isbn/author/title/type for mapping back to our catalogue.
export async function recommendFromSavedBooks(profileStore, profileSubject, qdrantEndpoint, limit = 10) {
    const savedIds = profileStore.getObjects(profileSubject, BP + "savedBook", null).map(o => o.value)
    if (savedIds.length === 0) return { savedIds, basedOn: [], results: [], empty: true }

    const bareIds = savedIds.map(id => id.replace(/^AK/, ""))
    const body = JSON.stringify({ query: { recommend: { positive: bareIds } }, limit })

    // A POST with Content-Type: application/json is a "non-simple" CORS request, so the
    // browser sends an OPTIONS preflight first — which this server currently answers with
    // 503, blocking the call before it ever reaches us. Wrapping the body in a Blob with
    // no declared type makes fetch omit Content-Type entirely; that keeps the request
    // "simple" and the browser skips the preflight. FastAPI still parses it as JSON fine.
    // Once OPTIONS /api/recommend answers 2xx with the right CORS headers, swap this for
    // the commented-out version below — a plain, properly-typed application/json POST:
    //
    //   const res = await fetch(qdrantEndpoint, {
    //       method: "POST",
    //       headers: { "Content-Type": "application/json" },
    //       body,
    //   })
    const res = await fetch(qdrantEndpoint, { method: "POST", body: new Blob([body]) })
    const json = await res.json().catch(() => null)

    // 422 here means every sent akkey was filtered out as unknown, leaving no positives —
    // i.e. none of the saved books are in the collection. Logged so a genuine validation
    // bug stays visible instead of being silently read as "no matches".
    if (res.status === 422) {
        console.warn("[bib-pods] Qdrant 422 (no known akkeys?):", json?.detail)
        return { savedIds, basedOn: [], results: [], empty: false }
    }
    if (!res.ok) {
        const detail = typeof json?.detail === "string" ? json.detail : JSON.stringify(json?.detail ?? "")
        throw new Error(`Qdrant ${res.status}: ${detail || res.statusText}`)
    }

    const savedBare = new Set(bareIds)
    const results = (json?.points ?? []).filter(p => !savedBare.has(p.payload?.metadata?.akkey))
    return { savedIds, basedOn: json?.basedOn ?? [], results, empty: false }
}
