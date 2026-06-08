// Force graph panel — read-only view of the query. It's the only panel that
// reshapes the model: it converts the AST (the single internal model; see
// model.js) into force-graph's flat { nodes, links } form. Layout is
// force-graph's own force-directed simulation (no hierarchy imposed).
// Operators are blue, conditions green (red when negated). Nodes can be
// dragged to rearrange the view, and the canvas pans/zooms — but the query
// itself is read-only here; edit it in another panel and this view follows.
// (Earlier versions allowed in-graph editing — node popups, drag to re-parent
// — but getting those interactions right wasn't worth it.)
import { ForceGraph } from "../../dist/search.js"
import { isGroup } from "./model.js"
import { panelParts, setStatus } from "./ui.js"

// AST -> force-graph's { nodes, links }. Node ids are tree paths ("r", "r.0",
// "r.0.1") so a node keeps its id across edits that don't move it —
// force-graph then preserves its position instead of re-running the whole
// layout on every keystroke.
function astToGraphData(ast) {
    const nodes = [], links = []
    const walk = (node, parentId, id) => {
        nodes.push({
            id,
            kind: isGroup(node) ? "op" : "cond",
            negated: !isGroup(node) && !!node.negated,
            label: isGroup(node)
                ? node.op
                : `${node.field} ${node.negated ? "!=" : "="} ${node.value}`,
        })
        if (parentId !== null) links.push({ source: parentId, target: id })
        if (isGroup(node)) node.children.forEach((child, i) => walk(child, id, `${id}.${i}`))
    }
    walk(ast, null, "r")
    return { nodes, links }
}

export function createGraphPanel() {
    const { status } = panelParts("panel-graph")
    const container = document.getElementById("graph-div")
    let pendingFit = false

    const graph = ForceGraph()(container)
        .width(container.clientWidth)
        .height(420)
        // settle (and auto-fit) in ~3s rather than the 15s default, so the
        // one-time zoomToFit on engine stop doesn't read as a late "jump"
        .cooldownTime(3000)
        .linkColor(() => "#bbc4cc")
        .linkWidth(1.5)
        .nodeCanvasObject((node, ctx, scale) => {
            const fontSize = 13 / scale
            ctx.font = `${node.kind === "op" ? "bold " : ""}${fontSize}px Arial`
            const w = ctx.measureText(node.label).width + 14 / scale
            const h = fontSize + 10 / scale
            ctx.fillStyle = node.kind === "op" ? "#dbe7f5" : node.negated ? "#f5dede" : "#e6f2dd"
            ctx.strokeStyle = "#9aa7b5"
            ctx.lineWidth = 1 / scale
            ctx.beginPath()
            ctx.roundRect(node.x - w / 2, node.y - h / 2, w, h, 4 / scale)
            ctx.fill()
            ctx.stroke()
            ctx.fillStyle = "#223"
            ctx.textAlign = "center"
            ctx.textBaseline = "middle"
            ctx.fillText(node.label, node.x, node.y)
            node.__w = w // remember the box size for the drag hit-area below
            node.__h = h
        })
        // custom-painted nodes get only a tiny default hit circle; paint the
        // full label box so the whole node is grabbable for dragging
        .nodePointerAreaPaint((node, color, ctx) => {
            if (node.__w === undefined) return
            ctx.fillStyle = color
            ctx.fillRect(node.x - node.__w / 2, node.y - node.__h / 2, node.__w, node.__h)
        })
        .onEngineStop(() => {
            if (pendingFit) {
                pendingFit = false
                graph.zoomToFit(300, 30)
            }
        })

    container.__forceGraph = graph // console/debug handle

    window.addEventListener("resize", () => graph.width(container.clientWidth))

    return {
        render(ast) {
            setStatus(status, null)
            pendingFit = true
            graph.graphData(astToGraphData(ast))
        },
    }
}
