const STORAGE_KEY = "bib-pods.storage"

export function getChoice() {
    return localStorage.getItem(STORAGE_KEY)
}

export function setChoice(choice) {
    localStorage.setItem(STORAGE_KEY, choice)
}

export function clearChoice() {
    localStorage.removeItem(STORAGE_KEY)
}

export function isActivated() {
    const choice = getChoice()
    return choice === "local" || choice === "solid"
}
