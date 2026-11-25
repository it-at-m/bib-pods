// Literary genres read off a record's subtitle (245$b).
//
// MSB's records carry a genre (655) almost only for non-fiction; a novel's record says
// what it is nowhere but in the subtitle the publisher printed on the cover: "Roman",
// "Kriminalroman", "ein Sylt-Krimi", "historischer Roman", "Gedichte". This module
// turns that convention into genre labels for the index (genre, genre_derived), so
// fiction becomes reachable by genre at all. Measurements: field-notes.md §4.
//
// The rule is deliberately narrow: a subtitle counts only where a genre word is its
// head. That is, it sits at the start of the subtitle (or of one of its ISBD segments),
// preceded at most by an article and lower-case words (adjectives, numerals:
// "historischer Roman", "zwei Novellen") and followed at most by a lower-case word (a
// preposition or article: "Roman nach einer wahren Geschichte"). A capitalised
// neighbour means the word is something else: "Roman Herzog im Gespräch" is about a
// man called Roman. Two conventions get their own allowance: a capitalised adjective
// in front ("Historischer Roman"), and the series formula that ends a short segment
// ("Oberbayern Krimi", "ein Jack-Reacher-Roman", "a Stephanie Plum novel").
//
// Whether a record is a text or a reading at all (not sheet music whose subtitle says
// "sechs Gedichte für Altstimme") is the caller's question: see mapRecord.

const ARTICLES = new Set(["ein", "eine", "der", "die", "das", "a", "an", "the", "un", "une", "uno", "una", "le", "la", "il"])

// How far into a segment the genre word may sit, articles not counted.
const HEAD_WITHIN = 3
// How long a segment may be for its last word to count as the series formula.
const FORMULA_WITHIN = 5

// Words that may stand capitalised before the genre word: the adjectives and numerals
// publishers put there.
const LEADING_ADJECTIVE = /^(histor|heiter|satir|autobiogra|biogra|utop|phantast|fantast|polit|klein|neu|kurz|ausgewählt|sämtlich|gesammelt|früh|spät|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|zwölf)/i

const isCrime = w => /^kriminal(roman|geschichte|erzählung|novelle|hörspiel|komödie)/.test(w) || /krimis?$/.test(w) || /^detektiv(roman|geschichte)/.test(w)
const isThriller = w => /thriller$/.test(w)

// A segment's genre, from its head word (lower-cased) and the lower-cased words before
// it. First match wins, so the specific forms come before the general "…roman". The
// labels for children's and youth novels (the comic novel is a children's format) are
// the catalogue's own 655 terms.
function genreOf(word, before) {
    const historical = before.some(w => /^histor/.test(w))
    if (isCrime(word)) return historical ? ["Krimi", "Historischer Roman"] : ["Krimi"]
    if (isThriller(word)) return ["Thriller"]
    if (word === "novel" || word === "novels") return before.at(-1) === "graphic" ? ["Graphic Novel"] : ["Roman"]
    if (/^kinder-?roman/.test(word) || /^comic-?roman/.test(word)) return ["Kinderbuch"]
    if (/^jugend-?roman/.test(word)) return ["Jugendbuch"]
    if (/^(science-?fiction|sf|zukunfts)-?roman/.test(word)) return ["Science-Fiction"]
    if (/^fantasy-?roman/.test(word)) return ["Fantasy"]
    if (/^liebesroman/.test(word) || word === "romance") return ["Liebesroman"]
    if (/romane?$/.test(word) || word === "romanzo" || word === "novela") return historical ? ["Historischer Roman"] : ["Roman"]
    if (/^(erzählung|novelle|kurzgeschichte)(en|n)?$/.test(word) || word === "stories" || word === "storys") return ["Erzählungen"]
    if (word === "gedichte" || word === "lyrik" || word === "poems" || word === "sonette" || word === "balladen") return ["Lyrik"]
    return null
}

const lowerInitial = w => /^[\p{Ll}\p{N}]/u.test(w)
const bare = w => w.toLowerCase().replace(/[.,!?]+$/, "")

// The genre labels a subtitle states, in the order found; [] for none.
export function derivedGenres(subtitle) {
    if (!subtitle) return []
    const found = []
    // ISBD segments: "Roman : ungekürzte Lesung", "= Gesamtausgabe"
    for (const segment of subtitle.split(/\s*[:;=]\s*/)) {
        const words = segment.replace(/[\[\]()„“"«»]/g, "").split(/\s+/).filter(Boolean)
        while (words.length && ARTICLES.has(words[0].toLowerCase())) words.shift()
        if (words.length === 0) continue
        // "ein Fall für Poirot", "neuer Fall für …": the crime series' own formula
        if (/^(neuer |\d+\. )?fall für /i.test(words.join(" "))) { found.push("Krimi"); continue }
        let genres = null
        for (let i = 0; i < Math.min(words.length, HEAD_WITHIN) && !genres; i++) {
            const before = words.slice(0, i)
            if (!before.every((w, n) => lowerInitial(w) || (n === 0 && LEADING_ADJECTIVE.test(w)))) break
            const next = words[i + 1]
            if (next && !lowerInitial(next)) continue
            const word = bare(words[i])
            genres = genreOf(word, before.map(bare))
            // "Roman für Kinder", "ein Roman für Kinder"
            if (genres?.[0] === "Roman" && /^für (kinder|junge leser)/i.test(words.slice(i + 1).join(" "))) genres = ["Kinderbuch"]
        }
        // the series formula at the end of a short segment, whatever precedes it
        if (!genres && words.length <= FORMULA_WITHIN) {
            const last = bare(words.at(-1))
            if (isCrime(last) || isThriller(last) || last === "novel" || /-romane?$/.test(last)) genres = genreOf(last, words.slice(0, -1).map(bare))
        }
        if (genres) found.push(...genres)
    }
    return [...new Set(found)]
}
