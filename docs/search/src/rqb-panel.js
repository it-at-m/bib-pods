// react-querybuilder panel — an isolated React island. React and the
// component are loaded as ES modules from esm.sh; nothing else on the page
// knows React exists. Mapping mirrors the jQuery QueryBuilder panel, just
// with lowercase combinators and '='/'!=' operator names.
import React from "https://esm.sh/react@18.3.1"
import { createRoot } from "https://esm.sh/react-dom@18.3.1/client"
import { QueryBuilder } from "https://esm.sh/react-querybuilder@7.7.1?deps=react@18.3.1"
import { FIELDS, isGroup, checkComplete } from "./model.js"
import { panelParts, setStatus } from "./ui.js"

function astToRqb(ast) {
    const groupToRqb = (g) => ({
        combinator: g.op.toLowerCase(),
        rules: g.children.map(c => isGroup(c)
            ? groupToRqb(c)
            : { field: c.field, operator: c.negated ? "!=" : "=", value: c.value }),
    })
    return isGroup(ast)
        ? groupToRqb(ast)
        : { combinator: "and", rules: [{ field: ast.field, operator: ast.negated ? "!=" : "=", value: ast.value }] }
}

function rqbToAst(group) {
    const children = (group.rules ?? []).map(r => r.rules
        ? rqbToAst(r)
        : {
            field: r.field,
            value: String(r.value ?? ""),
            ...(r.operator === "!=" ? { negated: true } : {}),
        })
    return { op: group.combinator === "or" ? "OR" : "AND", children }
}

export function createRqbPanel(onCommit) {
    const { status } = panelParts("panel-rqb")
    const root = createRoot(document.getElementById("rqb-root"))
    let query = { combinator: "and", rules: [] }
    let syncing = false

    const fields = FIELDS.map(f => ({ name: f, label: f }))
    const operators = [{ name: "=", label: "is" }, { name: "!=", label: "is not" }]

    function onQueryChange(next) {
        query = next
        rerender()
        if (syncing) return
        try {
            const ast = rqbToAst(next)
            checkComplete(ast)
            setStatus(status, null)
            onCommit(ast)
        } catch (err) {
            setStatus(status, `✗ ${err.message}`)
        }
    }

    function rerender() {
        root.render(React.createElement(QueryBuilder, { fields, operators, query, onQueryChange }))
    }

    return {
        render(ast) {
            syncing = true
            query = astToRqb(ast)
            rerender()
            // release the flag after React has flushed the mount-time onQueryChange
            queueMicrotask(() => { syncing = false })
            setStatus(status, null)
        },
    }
}
