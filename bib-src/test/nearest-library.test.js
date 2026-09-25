import test from "node:test"
import assert from "node:assert/strict"
import { airDistance, nearestLibrary } from "../src/nearest-library.js"

test("the Munich demo address selects Motorama ahead of every other branch", () => {
    const museum = { lat: 48.1304654, lon: 11.5836265 }
    const winner = nearestLibrary(museum)
    assert.equal(winner.uri, "https://www.muenchner-stadtbibliothek.de/stadtbibliothek-im-motorama")
    assert.equal(winner.name, "Motorama (Haidhausen)")
    assert.ok(winner.distanceKm > 0.4 && winner.distanceKm < 0.5)
    assert.equal(airDistance(museum, museum), 0)
})
