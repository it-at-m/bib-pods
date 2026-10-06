import test from "node:test"
import assert from "node:assert/strict"
import { airDistance, nearestLibrary } from "../src/nearest-library.js"

test("the Munich demo address selects Motorama ahead of every other branch", () => {
    const milchstrasse = { lat: 48.13108, lon: 11.59457 }
    const winner = nearestLibrary(milchstrasse)
    assert.equal(winner.uri, "https://www.muenchner-stadtbibliothek.de/stadtbibliothek-im-motorama")
    assert.equal(winner.name, "Motorama (Haidhausen)")
    assert.ok(winner.distanceKm > 0.3 && winner.distanceKm < 0.4)
    assert.equal(airDistance(milchstrasse, milchstrasse), 0)
})
