import { addTriple, newStore, storeToTurtle } from "@foerderfunke/sem-ops-utils"

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("solid-pod-connect").addEventListener("click", async () => {
        document.getElementById("solid-pod-status").textContent = "hello world"

        let store = newStore()
        addTriple(store, "http://ex.com/subj", "http://ex.com/pred", "http://ex.com/obj")
        console.log(await storeToTurtle(store))
    })
})
