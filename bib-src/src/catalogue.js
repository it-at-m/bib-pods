// SOPAC ids in our store are "AK" + digits (e.g. AK4298169); the Munich catalogue URL
// expects "SAK" + 8-digit zero-padded form (e.g. SAK04298169).
export function sopacCatalogueUrl(sopacId) {
    const digits = sopacId.replace(/^AK/, "").padStart(8, "0")
    return `https://ssl.muenchen.de/aDISWeb/app?service=direct/0/Home/$DirectLink&sp=SOPAC&sp=SAK${digits}`
}

// aDIS/BMS SOPAC URLs use `sp=S<key>` where the leading `S` is a service-param
// type tag and the numeric portion is zero-padded to 8 digits. Solr stores the
// bare MARC 001 (e.g. "AK4250109"), so strip both. The OPAC's DirectLink form
// carries a second `sp=SOPAC` param that this deliberately skips over.
export const SOPAC_RE = /[?&]sp=S(AK)0*(\d+)/

// Onleihe mediaInfo URLs carry the divibib media id as the third dash-segment
// after the comma; the surrounding segments are navigation/view state and vary
// between pages, so only the media id is a stable key.
export const ONLEIHE_RE = /onleihe\.de\/.+\/mediaInfo,\d+-\d+-(\d+)-/

// Onleihe 3.0 (the React app served at <tenant>.onleihe.de) addresses a title by a
// 24-hex product id that appears nowhere in the catalogue: the harvested 856$u links
// still carry the old mediaInfo form, and divibib's product API needs credentials.
// Matched anyway so the modal can say what the link is instead of rejecting it blindly.
export const ONLEIHE_V3_RE = /onleihe\.de\/mediadetail\?[^#\s]*productId=([0-9a-f]{24})/i

// Amazon addresses every product by a ten-character ASIN in /dp/ or /gp/product/, and
// for printed books that ASIN *is* the ISBN-10 — so a shared Amazon link carries a
// usable catalogue key for free. Kindle editions and non-books get a minted ASIN
// instead (usually "B0…"), which is the same length and would sail through a mere
// length check, so the ISBN-10 checksum below is what separates the two. Deliberately
// not advertised in the modal: it works for print titles and silently does not for the
// rest, which is not a promise worth making to a patron.
const AMAZON_RE = /amazon\.[a-z.]{2,6}\/(?:.*\/)?(?:dp|gp\/product)\/([0-9][0-9Xx]{9})(?:[/?#]|$)/i

// Goodreads book URLs carry Goodreads' own work id and a title slug
// (/book/show/129915654-pride-and-prejudice) — no ISBN, and nothing that appears in a
// library catalogue. Matched only so the modal can say why it cannot be used; see
// resolveCatalogueRef.
const GOODREADS_RE = /goodreads\.com\/book\/show\/(\d+)/i

// An ISBN-10's check digit makes the weighted sum of all ten characters divisible by 11
// (the last position may be X, meaning 10). Used to tell a real ISBN from a minted
// Amazon ASIN; typed ISBNs are not checksum-tested, because a typo is better reported
// as "not found" than rejected as malformed.
function isIsbn10(s) {
    let sum = 0
    for (let i = 0; i < 10; i++) {
        const c = s[i].toUpperCase()
        const v = c === "X" ? 10 : Number(c)
        if (!Number.isInteger(v)) return false
        sum += v * (10 - i)
    }
    return sum % 11 === 0
}

// Bare record ids, as the OPAC prints them in its "Datensatznummer" field and in the
// tail of its Zitierlink. A lone number is read as a SOPAC id, not an Onleihe media
// id — Onleihe items are copied as whole URLs, the catalogue's number is not.
const BARE_ID_RE = /^S?(?:AK)?0*(\d+)$/i

// ISBNs arrive in every printed shape — hyphenated, spaced, bare, sometimes behind an
// "ISBN" label. Strip to the significant characters; the trailing check digit of an
// ISBN-10 may be an X. 10 or 13 characters is what separates an ISBN from a
// Datensatznummer (8 digits), so the two never collide.
// Kept free of any shape test because it also normalises catalogue-side values during
// lookup, where the input is whatever the index holds. Those are plain digit/hyphen
// forms today (1 of 425 sampled deviates, and that one is malformed), so a stored value
// carrying a MARC 020$a qualifier ("… : EUR 22.00") would simply not match rather than
// mis-match — a miss, not a wrong hit.
export function normalizeIsbn(input) {
    const bare = input.replace(/[^0-9Xx]/g, "").toUpperCase()
    return bare.length === 10 || bare.length === 13 ? bare : null
}

// What a user typed counts as an ISBN only if it is *nothing but* an ISBN: optionally an
// "ISBN" label, then digits with printer's hyphens or spaces, ending in a digit or the
// ISBN-10 check letter X. Without this gate, the lenient normalisation above would
// reduce any text carrying enough digits — a URL's opaque id, an order number — to ten
// or thirteen characters and call it an ISBN. The lookup then reports "not in the
// catalogue", which is a worse answer than admitting the input wasn't understood.
const ISBN_SHAPE_RE = /^(?:ISBN(?:-1[03])?:?\s*)?[0-9][0-9\s-]{8,19}[0-9X]$/i

function parseIsbnInput(text) {
    return ISBN_SHAPE_RE.test(text) ? normalizeIsbn(text) : null
}

// The patron's only handle on a catalogue we can't put the widget on is what they can
// copy out of it (the aDIS OPAC labels it "Zitierlink"), so accept every shape the
// clipboard plausibly carries. Returns the lookup key and the field it belongs to,
// or null when there is nothing recognisable in the string.
export function parseCatalogueRef(input) {
    const text = input.trim()
    if (!text) return null
    const onleihe = text.match(ONLEIHE_RE)
    if (onleihe) return { kind: "onleihe", id: onleihe[1] }
    const onleiheV3 = text.match(ONLEIHE_V3_RE)
    if (onleiheV3) return { kind: "onleihe-v3", id: onleiheV3[1] }
    const sopac = text.match(SOPAC_RE)
    if (sopac) return { kind: "sopac", id: sopac[1] + sopac[2] }
    const amazon = text.match(AMAZON_RE)
    if (amazon && isIsbn10(amazon[1])) return { kind: "isbn", id: amazon[1].toUpperCase() }
    const goodreads = text.match(GOODREADS_RE)
    if (goodreads) return { kind: "goodreads", id: goodreads[1] }
    // Before BARE_ID_RE: a hyphen-less ISBN is all digits and would otherwise be read
    // as a record number.
    const isbn = parseIsbnInput(text)
    if (isbn) return { kind: "isbn", id: isbn }
    const bare = text.match(BARE_ID_RE)
    if (bare) return { kind: "sopac", id: "AK" + bare[1] }
    return null
}

// Resolve a parsed reference to the record it names. An Onleihe media id is only a
// lookup key: the record's own AK id is what gets saved (the recommender's
// savedBook→akkey stripping assumes an "AK…" id), so it replaces the input id and a
// failed resolution leaves nothing usable behind.
export async function resolveCatalogueRef(endpoint, ref) {
    if (ref.kind === "onleihe-v3") throw new Error("Onleihe 3.0 product ids are not in the catalogue index")
    if (ref.kind === "goodreads") throw new Error("Goodreads book ids carry no ISBN and are not in the catalogue index")
    if (ref.kind === "isbn") {
        const book = await fetchBookByIsbn(endpoint, ref.id)
        return { id: book?.id ?? null, book: book ?? null }
    }
    if (ref.kind === "onleihe") {
        const book = await fetchBookByOnleiheId(endpoint, ref.id)
        return { id: book?.id ?? null, book: book ?? null }
    }
    const book = await fetchBook(endpoint, ref.id)
    return { id: ref.id, book: book ?? null }
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

// Solr's `isbn` field is tokenized on the hyphens of the printed form, so the stored
// "978-3-446-26595-0" is the term sequence 978|3|446|26595|0 — a hyphen-less
// "9783446265950" matches no term at all, and a wildcard cannot span two terms.
// Instead, narrow with a window that necessarily falls inside a single term and settle
// the match here, where the full ISBN can be compared exactly. The check digit is its
// own term, hence dropped from the window. Verified against ISBN-10 and ISBN-13 in
// hyphenated, spaced and bare form.
export async function fetchBookByIsbn(endpoint, isbn) {
    const want = normalizeIsbn(isbn)
    if (!want) return undefined
    const body = want.slice(0, -1)
    // Shrinking window: the widest one is the most selective, but it straddles a term
    // boundary whenever the last term is shorter than it — and a query spanning two
    // terms matches nothing. Zero candidates is therefore "try a window that fits",
    // while any candidates at all mean the index has been asked the right question.
    for (const size of [5, 4, 3]) {
        const res = await fetch(`${endpoint}?q=${encodeURIComponent(`isbn:*${body.slice(-size)}*`)}&fl=id,isbn&rows=100&wt=json`)
        if (!res.ok) throw new Error(`Solr ${res.status}: ${res.statusText}`)
        const docs = (await res.json()).response.docs
        const hit = docs.find(d => (d.isbn ?? []).some(v => normalizeIsbn(v) === want))
        if (hit) return fetchBook(endpoint, hit.id)
        if (docs.length > 0) break
    }
    return undefined
}
