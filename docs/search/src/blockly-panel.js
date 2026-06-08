// Blockly panel — two custom blocks: a group block (AND/OR) whose statement
// input stacks children vertically, and a condition block (field / is / value).
// Stacking inside a group means "combined with the group's operator".
import { FIELDS, isGroup } from "./model.js"
import { panelParts, setStatus } from "./ui.js"

export function createBlocklyPanel(onCommit) {
    const { status } = panelParts("panel-blockly")
    let syncing = false

    Blockly.Blocks["bp_group"] = {
        init() {
            this.appendDummyInput()
                .appendField(new Blockly.FieldDropdown([["all of (AND)", "AND"], ["any of (OR)", "OR"]]), "OP")
            this.appendStatementInput("CHILDREN")
            this.setPreviousStatement(true)
            this.setNextStatement(true)
            this.setColour(210)
        },
    }
    Blockly.Blocks["bp_condition"] = {
        init() {
            this.appendDummyInput()
                .appendField(new Blockly.FieldDropdown(FIELDS.map(f => [f, f])), "FIELD")
                .appendField(new Blockly.FieldDropdown([["is", "IS"], ["is not", "NOT"]]), "NEG")
                .appendField(new Blockly.FieldTextInput("value"), "VALUE")
            this.setPreviousStatement(true)
            this.setNextStatement(true)
            this.setColour(120)
        },
    }

    const workspace = Blockly.inject("blockly-div", {
        toolbox: {
            kind: "flyoutToolbox",
            contents: [
                { kind: "block", type: "bp_group" },
                { kind: "block", type: "bp_condition" },
            ],
        },
        scrollbars: true,
        trashcan: false,
    })

    // ---- AST -> workspace state (serialization JSON)

    function nodeState(node) {
        if (!isGroup(node)) {
            return {
                type: "bp_condition",
                fields: { FIELD: node.field, NEG: node.negated ? "NOT" : "IS", VALUE: node.value },
            }
        }
        return {
            type: "bp_group",
            fields: { OP: node.op },
            inputs: { CHILDREN: { block: chainState(node.children) } },
        }
    }
    function chainState(nodes) {
        let state = null
        for (let i = nodes.length - 1; i >= 0; i--) {
            const s = nodeState(nodes[i])
            if (state) s.next = { block: state }
            state = s
        }
        return state
    }

    // ---- workspace -> AST

    function blockToAst(block) {
        if (block.type === "bp_condition") {
            const value = block.getFieldValue("VALUE").trim()
            if (value === "") throw new Error("a condition value is empty")
            return {
                field: block.getFieldValue("FIELD"),
                value,
                ...(block.getFieldValue("NEG") === "NOT" ? { negated: true } : {}),
            }
        }
        const children = []
        let child = block.getInputTargetBlock("CHILDREN")
        while (child) {
            children.push(blockToAst(child))
            child = child.getNextBlock()
        }
        if (children.length === 0) throw new Error("a group has no blocks inside")
        return { op: block.getFieldValue("OP"), children }
    }

    function workspaceToAst() {
        const tops = workspace.getTopBlocks(true).filter(b => b.type === "bp_group" || b.type === "bp_condition")
        if (tops.length === 0) throw new Error("workspace is empty")
        if (tops.length > 1) throw new Error(`${tops.length} loose stacks — connect everything into one`)
        // a top-level stack of several blocks (outside any group) reads as AND
        const chain = []
        let block = tops[0]
        while (block) {
            chain.push(blockToAst(block))
            block = block.getNextBlock()
        }
        return chain.length === 1 ? chain[0] : { op: "AND", children: chain }
    }

    let debounce = null
    workspace.addChangeListener((event) => {
        if (syncing || event.isUiEvent) return
        clearTimeout(debounce)
        debounce = setTimeout(() => {
            try {
                const ast = workspaceToAst()
                setStatus(status, null)
                onCommit(ast)
            } catch (err) {
                setStatus(status, `✗ ${err.message}`)
            }
        }, 200)
    })

    return {
        render(ast) {
            syncing = true
            Blockly.serialization.workspaces.load(
                { blocks: { languageVersion: 0, blocks: [{ ...nodeState(ast), x: 20, y: 20 }] } },
                workspace,
            )
            syncing = false
            setStatus(status, null)
        },
    }
}
