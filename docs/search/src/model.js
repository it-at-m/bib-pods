// The internal query model shared by all panels on the search page.
//
// AST node shapes:
//   condition: { field, value, negated? }            e.g. { field: "author", value: "Bach" }
//   group:     { op: "AND"|"OR", children: [node] }  nested arbitrarily
//
// v1 scope: nested AND/OR over field:value terms and quoted phrases, plus
// negation on single conditions ("AND NOT genre:X"). Ranges, boosts, fuzzy
// and negated groups are out of scope — the parsers reject them with a
// readable error so the panel shows why it can't sync.

// `electronic` is a boolean field (true = onleihe / e-medium, false = physical).
export const FIELDS = ["author", "title", "genre", "topic", "publishDate", "electronic"]

export const DEFAULT_QUERY =
    '(author:Bach OR author:Telemann) AND genre:Musiktonträger AND (topic:Fantasie OR topic:Suite)'

export const isGroup = (node) => node.op !== undefined

// Flatten same-op nesting and collapse single-child groups, recursively.
// Panels always receive and emit normalized ASTs, so structural round-trip
// differences (extra parens, singleton groups) never count as changes.
export function normalize(node) {
    if (!isGroup(node)) return { ...node }
    const children = []
    for (const child of node.children.map(normalize)) {
        if (isGroup(child) && child.op === node.op) children.push(...child.children)
        else children.push(child)
    }
    if (children.length === 1) return children[0]
    return { op: node.op, children }
}

// Canonical string form — used as cheap semantic equality between ASTs.
export const astKey = (node) => toSolr(normalize(node))

// Widget panels (query builders, Blockly) build ASTs incrementally — reject
// in-progress states (an empty group, a value not filled in yet) before
// committing, so half-finished edits never reach the model.
export function checkComplete(node) {
    if (isGroup(node)) {
        if (node.children.length === 0) throw new Error("empty group")
        node.children.forEach(checkComplete)
    } else if (!node.field || node.value === "") {
        throw new Error("fill in the value")
    }
}

// Both grammars share the same lexical shape: parentheses, double-quoted
// strings (with \" escapes) and bare words — they differ only in what a
// word means, so that's the parameter.
function tokenize(text, classifyWord) {
    const tokens = []
    let i = 0
    while (i < text.length) {
        const ch = text[i]
        if (/\s/.test(ch)) { i++; continue }
        if (ch === "(" || ch === ")") { tokens.push({ type: ch }); i++; continue }
        if (ch === '"') {
            let j = i + 1, value = ""
            while (j < text.length && text[j] !== '"') {
                if (text[j] === "\\" && text[j + 1] === '"') { value += '"'; j += 2 }
                else value += text[j++]
            }
            if (j >= text.length) throw new Error("unclosed quote")
            tokens.push({ type: "quoted", value })
            i = j + 1
            continue
        }
        let j = i
        while (j < text.length && !/[\s()"]/.test(text[j])) j++
        tokens.push(classifyWord(text.slice(i, j)))
        i = j
    }
    return tokens
}

// ---------------------------------------------------------------- Solr text

function quoteValue(value) {
    if (value === "" || /[\s"():]/.test(value)) return `"${value.replace(/"/g, '\\"')}"`
    return value
}

// A group of >1 non-negated conditions on one field — rendered via the
// self-delimiting shorthands (`author:(Bach OR Telemann)`, "author is Bach
// or Telemann"), which never need extra parentheses around them.
export function isSameFieldGroup(node) {
    return isGroup(node) && node.children.length > 1
        && node.children.every(c => !isGroup(c) && !c.negated && c.field === node.children[0].field)
}

export function toSolr(node) {
    if (!isGroup(node)) {
        return `${node.negated ? "NOT " : ""}${node.field}:${quoteValue(node.value)}`
    }
    if (isSameFieldGroup(node)) {
        return `${node.children[0].field}:(${node.children.map(c => quoteValue(c.value)).join(` ${node.op} `)})`
    }
    return node.children
        .map(c => isGroup(c) && !isSameFieldGroup(c) ? `(${toSolr(c)})` : toSolr(c))
        .join(` ${node.op} `)
}

const tokenizeSolr = (text) => tokenize(text, word => ({ type: "word", value: word }))

function checkField(field) {
    if (!FIELDS.includes(field)) {
        throw new Error(`unknown field "${field}" — use one of: ${FIELDS.join(", ")}`)
    }
    return field
}

export function fromSolr(text) {
    const tokens = tokenizeSolr(text)
    let pos = 0
    const peek = () => tokens[pos]
    const next = () => tokens[pos++]
    const isWord = (t, w) => t && t.type === "word" && t.value === w

    function parseOr() {
        const parts = [parseAnd()]
        while (isWord(peek(), "OR")) { next(); parts.push(parseAnd()) }
        return parts.length === 1 ? parts[0] : { op: "OR", children: parts }
    }
    function parseAnd() {
        const parts = [parseUnary()]
        while (isWord(peek(), "AND")) { next(); parts.push(parseUnary()) }
        return parts.length === 1 ? parts[0] : { op: "AND", children: parts }
    }
    function parseUnary() {
        if (isWord(peek(), "NOT")) {
            next()
            const node = parsePrimary()
            if (isGroup(node)) throw new Error("negated groups are not supported (yet) — negate single conditions instead")
            return { ...node, negated: true }
        }
        return parsePrimary()
    }
    function parsePrimary() {
        const t = next()
        if (!t) throw new Error("unexpected end of query")
        if (t.type === "(") {
            const node = parseOr()
            if (!peek() || peek().type !== ")") throw new Error("missing closing parenthesis")
            next()
            return node
        }
        if (t.type !== "word") throw new Error(`unexpected ${t.type === ")" ? "')'" : `"${t.value}"`}`)
        const colon = t.value.indexOf(":")
        if (colon < 1) throw new Error(`expected field:value, got "${t.value}"`)
        const field = checkField(t.value.slice(0, colon))
        const rest = t.value.slice(colon + 1)
        if (/[~^]/.test(rest)) throw new Error("fuzzy (~) and boost (^) are not supported yet")
        if (/^[[{]/.test(rest)) throw new Error("range queries are not supported yet")
        if (rest !== "") return { field, value: rest }
        const v = peek()
        if (v && v.type === "quoted") { next(); return { field, value: v.value } }
        if (v && v.type === "(") {
            // field grouping: field:(a OR b), uniform connector
            next()
            const children = []
            let op = null
            for (;;) {
                const vt = next()
                if (!vt || (vt.type !== "word" && vt.type !== "quoted")) throw new Error(`expected a value in ${field}:(...)`)
                children.push({ field, value: vt.value })
                const sep = next()
                if (!sep) throw new Error("missing closing parenthesis")
                if (sep.type === ")") break
                if (sep.type !== "word" || (sep.value !== "OR" && sep.value !== "AND")) {
                    throw new Error(`expected OR/AND inside ${field}:(...)`)
                }
                if (op && op !== sep.value) throw new Error(`mixed AND/OR inside ${field}:(...) — use one connector`)
                op = sep.value
            }
            if (children.length === 1) return children[0]
            return { op: op ?? "OR", children }
        }
        throw new Error(`missing value after "${field}:"`)
    }

    if (tokens.length === 0) throw new Error("empty query")
    const ast = parseOr()
    if (pos < tokens.length) {
        const t = tokens[pos]
        throw new Error(`unexpected "${t.value ?? t.type}" — combine terms with AND/OR`)
    }
    return normalize(ast)
}

// ------------------------------------------------- controlled natural language
//
// Grammar (keywords case-insensitive): condition = `<field> is [not] <value>`,
// same-field shorthand `author is Bach or Telemann`, groups via parentheses,
// combined with and/or. Mirrors the AST exactly, so both directions are
// deterministic.

const NL_KEYWORDS = new Set(["and", "or", "not", "is"])

function nlValue(value) {
    if (value === "" || /[\s"()]/.test(value) || NL_KEYWORDS.has(value.toLowerCase())) {
        return `"${value.replace(/"/g, '\\"')}"`
    }
    return value
}

export function toNL(node) {
    if (!isGroup(node)) {
        return `${node.field} is${node.negated ? " not" : ""} ${nlValue(node.value)}`
    }
    const sep = node.op === "OR" ? " or " : " and "
    if (isSameFieldGroup(node)) {
        return `${node.children[0].field} is ${node.children.map(c => nlValue(c.value)).join(sep)}`
    }
    return node.children
        .map(c => isGroup(c) && !isSameFieldGroup(c) ? `(${toNL(c)})` : toNL(c))
        .join(sep)
}

const tokenizeNL = (text) => tokenize(text, word => {
    const lower = word.toLowerCase()
    return NL_KEYWORDS.has(lower) ? { type: lower } : { type: "word", value: word }
})

export function fromNL(text) {
    const tokens = tokenizeNL(text)
    let pos = 0
    const peek = (n = 0) => tokens[pos + n]

    function parseOr() {
        const parts = [parseAnd()]
        while (peek()?.type === "or") { pos++; parts.push(parseAnd()) }
        return parts.length === 1 ? parts[0] : { op: "OR", children: parts }
    }
    function parseAnd() {
        const parts = [parsePrimary()]
        while (peek()?.type === "and" && !startsValueList()) { pos++; parts.push(parsePrimary()) }
        return parts.length === 1 ? parts[0] : { op: "AND", children: parts }
    }
    // `author is Bach or Telemann` — a connector continues the value list of the
    // preceding condition iff the next token is a value NOT followed by "is".
    function startsValueList() {
        const v = peek(1)
        return v && (v.type === "word" || v.type === "quoted") && peek(2)?.type !== "is"
    }
    function parsePrimary() {
        const t = tokens[pos++]
        if (!t) throw new Error("unexpected end of input")
        if (t.type === "(") {
            const node = parseOr()
            if (peek()?.type !== ")") throw new Error("missing closing parenthesis")
            pos++
            return node
        }
        if (t.type !== "word") throw new Error(`expected a field name, got "${t.type}"`)
        const field = FIELDS.find(f => f.toLowerCase() === t.value.toLowerCase())
        if (!field) throw new Error(`unknown field "${t.value}" — use one of: ${FIELDS.join(", ")}`)
        if (peek()?.type !== "is") throw new Error(`expected "is" after "${field}"`)
        pos++
        let negated = false
        if (peek()?.type === "not") { pos++; negated = true }
        const first = tokens[pos++]
        if (!first || (first.type !== "word" && first.type !== "quoted")) {
            throw new Error(`expected a value after "${field} is${negated ? " not" : ""}"`)
        }
        const conditions = [{ field, value: first.value, ...(negated ? { negated: true } : {}) }]
        let op = null
        while (!negated && (peek()?.type === "or" || peek()?.type === "and") && startsValueList()) {
            const connector = peek().type === "or" ? "OR" : "AND"
            if (op && op !== connector) break
            op = connector
            pos++
            conditions.push({ field, value: tokens[pos++].value })
        }
        if (conditions.length === 1) return conditions[0]
        return { op, children: conditions }
    }

    if (tokens.length === 0) throw new Error("empty query")
    const ast = parseOr()
    if (pos < tokens.length) {
        const t = tokens[pos]
        throw new Error(`unexpected "${t.value ?? t.type}" — combine conditions with and/or`)
    }
    return normalize(ast)
}
