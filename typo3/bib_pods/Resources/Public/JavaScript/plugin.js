const STORAGE_KEY = "bib-pods.storage"
const root = document.getElementById("bib-pods-root")

const views = {
    chooser: () => `
        <p>Wo sollen deine Daten gespeichert werden?</p>
        <button data-choice="local">Lokal im Browser</button>
        <button data-choice="solid">In meinem Solid Pod</button>
    `,
    local: () => `
        <p>Speicherung: lokal in deinem Browser</p>
        <button data-action="switch">Speicherort wechseln</button>
    `,
    solid: () => `
        <p>Speicherung: in deinem Solid Pod</p>
        <button data-action="switch">Speicherort wechseln</button>
    `,
}

function render() {
    const choice = localStorage.getItem(STORAGE_KEY)
    const view = choice === "local" || choice === "solid" ? choice : "chooser"
    root.innerHTML = views[view]()
}

root.addEventListener("click", (event) => {
    const { choice, action } = event.target.dataset
    if (choice === "local" || choice === "solid") {
        localStorage.setItem(STORAGE_KEY, choice)
        render()
    } else if (action === "switch") {
        localStorage.removeItem(STORAGE_KEY)
        render()
    }
})

render()
