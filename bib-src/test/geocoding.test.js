import test from "node:test"
import assert from "node:assert/strict"
import { geocodeAddress, NOMINATIM_ENDPOINT } from "../src/geocoding.js"

const address = { street: "Beispielstraße 7", postalCode: "01234", city: "München", country: "Deutschland" }
const result = [{ lat: "48.137154", lon: "11.576124" }]

test("geocoding sends only address components, without Solid credentials, and returns numeric coordinates", async t => {
    t.mock.method(globalThis, "fetch", async (url, options) => {
        assert.equal(url.origin + url.pathname, NOMINATIM_ENDPOINT)
        assert.deepEqual(Object.fromEntries(url.searchParams), {
            street: address.street, postalcode: "01234", city: address.city, country: address.country,
            format: "jsonv2", limit: "1",
        })
        assert.equal(options.credentials, "omit")
        assert.equal(options.cache, "no-store")
        assert.equal(options.referrerPolicy, "origin")
        assert.deepEqual(options.headers, { Accept: "application/json" })
        return Response.json(result)
    })
    assert.deepEqual(await geocodeAddress({ ...address, webId: "https://pod.example/me", name: "Hannah" }),
        { lat: 48.137154, lon: 11.576124 })
})

test("failed or empty lookups allow a later retry", async t => {
    let response
    t.mock.method(globalThis, "fetch", async () => response)
    for (const [body, status, message] of [
        [null, 429, /HTTP 429/],
        [[], 200, /keine Koordinaten gefunden/],
        [[{ lat: "NaN", lon: "11" }], 200, /Ungültige Koordinaten/],
    ]) {
        response = Response.json(body, { status })
        await assert.rejects(geocodeAddress(address), message)
    }
    response = Response.json(result)
    assert.deepEqual(await geocodeAddress(address), { lat: 48.137154, lon: 11.576124 }, "errors do not block a later retry")
})

test("concurrent calls are spaced apart and can target a host-configured Nominatim instance", async t => {
    const starts = []
    t.mock.method(globalThis, "fetch", async url => {
        assert.equal(url.origin + url.pathname, "https://geocoder.example/search")
        starts.push(Date.now())
        return Response.json(result)
    })
    const options = { endpoint: "https://geocoder.example/search" }
    await Promise.all([geocodeAddress(address, options), geocodeAddress(address, options)])
    assert.equal(starts.length, 2)
    assert.ok(starts[1] - starts[0] >= 1000)
})
