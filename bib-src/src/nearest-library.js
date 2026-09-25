import { parseTurtle, RDF_TYPE } from "cori-sdk/utils.js"
import branchesTtl from "../definitions/msb-standorte.ttl.js"

const SCHEMA = "https://schema.org/"
const store = parseTurtle(branchesTtl)
const value = (subject, property) => store.getObjects(subject, SCHEMA + property, null)[0]?.value
const branches = store.getSubjects(RDF_TYPE, SCHEMA + "Library", null)
    .map(node => ({
        uri: node.value,
        name: value(node, "name"),
        lat: Number(value(node, "latitude")),
        lon: Number(value(node, "longitude")),
    }))
    .filter(branch => branch.name && Number.isFinite(branch.lat) && Number.isFinite(branch.lon))

// Great-circle distance over the Earth's surface, in kilometres.
export function airDistance(a, b) {
    const radians = Math.PI / 180
    const dLat = (b.lat - a.lat) * radians
    const dLon = (b.lon - a.lon) * radians
    const haversine = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(dLon / 2) ** 2
    return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, haversine)))
}

export function nearestLibrary(coordinates) {
    return branches.reduce((best, branch) => {
        const distanceKm = airDistance(coordinates, branch)
        return !best || distanceKm < best.distanceKm ? { ...branch, distanceKm } : best
    }, null)
}
