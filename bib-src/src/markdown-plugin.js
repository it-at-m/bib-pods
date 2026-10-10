import { readFileSync } from "fs"
import { Marked, Renderer } from "marked"
import pdfmake from "pdfmake"
import helvetica from "pdfmake/standard-fonts/Helvetica.js"

// Renders a Markdown file at build time, so the .md stays the only stored copy of a text
// the page shows and offers for download (the Datenschutzauskunft):
//   import html from "./x.md?html"  → HTML fragment for inside the widget
//   import pdf from "./x.md?pdf"    → data:application/pdf URL
// Both formats cover what such a text uses: headings, paragraphs, bullet lists, bold,
// italics, links. The PDF uses the PDF standard Helvetica, so no font files are needed.

// In the widget the surrounding <summary> already names the document: the # title is
// dropped and ## becomes <h4>, matching the landing's heading levels.
const htmlRenderer = new Renderer()
htmlRenderer.heading = function ({ tokens, depth }) {
    if (depth === 1) return ""
    return `<h${depth + 2}>${this.parser.parseInline(tokens)}</h${depth + 2}>\n`
}
const marked = new Marked({ renderer: htmlRenderer })

function toHtml(md) {
    return marked.parse(md)
}

pdfmake.setFonts(helvetica)
// The documents embed nothing external. pdfmake still passes the standard font names
// through its local-file check, so those (and only those) are let through.
const STANDARD_FONTS = Object.values(helvetica.Helvetica)
pdfmake.setUrlAccessPolicy(() => false)
pdfmake.setLocalAccessPolicy(path => STANDARD_FONTS.includes(path))

function pdfInlines(tokens, marks = {}) {
    return tokens.flatMap((t) => {
        if (t.type === "strong") return pdfInlines(t.tokens, { ...marks, bold: true })
        if (t.type === "em") return pdfInlines(t.tokens, { ...marks, italics: true })
        if (t.type === "link") return pdfInlines(t.tokens, { ...marks, link: t.href, decoration: "underline" })
        if (t.type === "br") return [{ text: "\n", ...marks }]
        if (t.tokens) return pdfInlines(t.tokens, marks)
        return [{ text: t.text, ...marks }]
    })
}

function pdfBlocks(tokens) {
    const content = []
    let previous = null
    for (const t of tokens) {
        if (t.type === "heading") content.push({ text: pdfInlines(t.tokens), style: `h${t.depth}` })
        else if (t.type === "paragraph") {
            // the line right under the title (the version) reads as a subtitle
            content.push({ text: pdfInlines(t.tokens), style: previous?.depth === 1 ? "subtitle" : "p" })
        } else if (t.type === "list") {
            const items = t.items.map(item => pdfBlocks(item.tokens))
            content.push({ [t.ordered ? "ol" : "ul"]: items, style: "list" })
        } else if (t.type === "text") content.push({ text: pdfInlines(t.tokens ?? [t]) })
        if (t.type !== "space") previous = t
    }
    return content
}

function toPdfDataUrl(md) {
    const tokens = marked.lexer(md)
    const title = tokens.find(t => t.type === "heading" && t.depth === 1)?.text
    return pdfmake.createPdf({
        info: { title },
        pageSize: "A4",
        pageMargins: [57, 62, 57, 62],
        content: pdfBlocks(tokens),
        defaultStyle: { font: "Helvetica", fontSize: 10.5, lineHeight: 1.3, color: "#222222" },
        styles: {
            h1: { fontSize: 17, bold: true, margin: [0, 0, 0, 2] },
            subtitle: { color: "#666666", margin: [0, 0, 0, 6] },
            h2: { fontSize: 12, bold: true, margin: [0, 14, 0, 4] },
            p: { margin: [0, 0, 0, 8] },
            list: { margin: [0, 0, 0, 8] },
        },
    }).getDataUrl()
}

export const markdownPlugin = {
    name: "bib-pods-markdown",
    enforce: "pre",
    async load(id) {
        const [path, query] = id.split("?")
        if (!path.endsWith(".md") || !query) return null
        const params = new URLSearchParams(query)
        if (!params.has("html") && !params.has("pdf")) return null
        this.addWatchFile(path)
        const md = readFileSync(path, "utf8")
        const value = params.has("html") ? toHtml(md) : await toPdfDataUrl(md)
        return `export default ${JSON.stringify(value)}`
    },
}
