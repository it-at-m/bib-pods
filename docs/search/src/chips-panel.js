// Filter chips panel — the flat AND-of-ORs model of production search UIs.
// Representable: a single condition, one same-field OR group, or an AND of
// those. Anything nested deeper or negated makes the panel step aside and
// say so — that limitation is the point of showing this concept.
import { FIELDS, isGroup, isSameFieldGroup, normalize } from "./model.js"
import { panelParts, setStatus } from "./ui.js"

// AST -> [{field, values: [...]}, ...] or null if not representable.
function toChips(ast) {
    const entry = (node) => {
        if (!isGroup(node)) {
            return node.negated ? null : { field: node.field, values: [node.value] }
        }
        if (node.op === "OR" && isSameFieldGroup(node)) {
            return { field: node.children[0].field, values: node.children.map(c => c.value) }
        }
        return null
    }
    const single = entry(ast)
    if (single) return [single]
    if (!isGroup(ast) || ast.op !== "AND") return null
    const entries = ast.children.map(entry)
    return entries.every(Boolean) ? entries : null
}

function toAst(entries) {
    const nodes = entries.map(e =>
        e.values.length === 1
            ? { field: e.field, value: e.values[0] }
            : { op: "OR", children: e.values.map(value => ({ field: e.field, value })) }
    )
    return normalize(nodes.length === 1 ? nodes[0] : { op: "AND", children: nodes })
}

export function createChipsPanel(onCommit) {
    const { body, status } = panelParts("panel-chips")
    const row = document.createElement("div")
    row.className = "chips-row"
    body.appendChild(row)
    let entries = []

    const totalChips = () => entries.reduce((n, e) => n + e.values.length, 0)

    function commit() {
        onCommit(toAst(entries))
        renderChips()
    }

    function valueInput(onDone) {
        const input = document.createElement("input")
        input.type = "text"
        input.placeholder = "value"
        let done = false
        const finish = () => {
            if (done) return
            done = true
            const value = input.value.trim()
            input.remove()
            if (value) onDone(value)
            else renderChips()
        }
        input.addEventListener("keydown", e => {
            if (e.key === "Enter") finish()
            if (e.key === "Escape") { input.value = ""; finish() }
        })
        input.addEventListener("blur", finish)
        return input
    }

    function renderChips() {
        row.replaceChildren()
        entries.forEach((e, i) => {
            if (i > 0) {
                const sep = document.createElement("span")
                sep.className = "chip-andsep"
                sep.textContent = "AND"
                row.appendChild(sep)
            }
            const group = document.createElement("span")
            group.className = "chip-group"
            const field = document.createElement("span")
            field.className = "chip-field"
            field.textContent = e.field
            group.appendChild(field)
            e.values.forEach((value, j) => {
                if (j > 0) {
                    const or = document.createElement("span")
                    or.className = "chip-or"
                    or.textContent = "or"
                    group.appendChild(or)
                }
                const chip = document.createElement("span")
                chip.className = "chip"
                chip.append(value)
                const x = document.createElement("button")
                x.textContent = "×"
                x.title = totalChips() === 1 ? "at least one filter is required" : "remove"
                x.disabled = totalChips() === 1
                x.addEventListener("click", () => {
                    e.values.splice(j, 1)
                    if (e.values.length === 0) entries.splice(i, 1)
                    commit()
                })
                chip.appendChild(x)
                group.appendChild(chip)
            })
            const add = document.createElement("button")
            add.textContent = "+"
            add.title = "add an OR alternative"
            add.addEventListener("click", () => {
                const input = valueInput(value => { e.values.push(value); commit() })
                group.insertBefore(input, add)
                input.focus()
            })
            group.appendChild(add)
            row.appendChild(group)
        })

        const newFilter = document.createElement("button")
        newFilter.textContent = "+ filter"
        newFilter.addEventListener("click", () => {
            // The new-filter draft is two focusable elements (field select +
            // value input). Treat them as one unit: commit/cancel only when
            // focus leaves the whole draft, so clicking the field dropdown
            // doesn't read as "clicked away" and tear the draft down.
            const draft = document.createElement("span")
            draft.style.cssText = "display: inline-flex; gap: 0.5rem; align-items: center"
            const select = document.createElement("select")
            for (const f of FIELDS) {
                const opt = document.createElement("option")
                opt.value = opt.textContent = f
                select.appendChild(opt)
            }
            const input = document.createElement("input")
            input.type = "text"
            input.placeholder = "value"
            draft.append(select, input)

            let done = false
            const finish = () => {
                if (done) return
                done = true
                const value = input.value.trim()
                if (value) { entries.push({ field: select.value, values: [value] }); commit() }
                else renderChips()
            }
            input.addEventListener("keydown", e => {
                if (e.key === "Enter") finish()
                if (e.key === "Escape") { input.value = ""; finish() }
            })
            // focusout bubbles (blur doesn't); defer so activeElement has
            // settled, then act only if focus actually left the draft
            draft.addEventListener("focusout", () => {
                setTimeout(() => { if (!draft.contains(document.activeElement)) finish() }, 0)
            })

            newFilter.replaceWith(draft)
            input.focus()
        })
        row.appendChild(newFilter)
    }

    return {
        render(ast) {
            const chips = toChips(ast)
            if (chips === null) {
                entries = []
                row.replaceChildren()
                const note = document.createElement("div")
                note.className = "chips-unrepresentable"
                note.textContent = "Not representable as flat filter chips — the query nests OR around AND or uses NOT, which this model does not support."
                row.appendChild(note)
                setStatus(status, "✗ out of chip territory")
                return
            }
            entries = chips
            setStatus(status, null)
            renderChips()
        },
    }
}
