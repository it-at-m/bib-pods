// Profile validation. validateProfile() checks a profile store against cori's base
// profile shapes plus any shapes a consuming app registers (registerProfileShapes)
// or passes in explicitly. Built on the shacl-engine wrapper in sem-ops-utils.
import { buildValidatorFromDataset } from "@foerderfunke/sem-ops-utils/shacl"
import { datasetFromStore, datasetFromTurtles } from "@foerderfunke/sem-ops-utils/core"
import coriProfileShapesTtl from "./definitions/profile.shapes.ttl.js"

// Turtle strings of additional profile shapes, contributed by the app layer.
const registeredShapes = []

// Apps add their domain shapes here (e.g. bib-src registers its bp: profile shapes),
// so validateProfile() picks them up without the caller threading them through.
export function registerProfileShapes(ttl) {
    registeredShapes.push(ttl)
}

// Validates a profile store against cori's base shapes fused with `additionalShapes`
// (an array of Turtle strings; defaults to whatever apps registered). Returns the
// shacl-engine validation report ({ conforms, results }).
export async function validateProfile(store, additionalShapes = registeredShapes) {
    const shapes = datasetFromTurtles([coriProfileShapesTtl, ...additionalShapes])
    const validator = buildValidatorFromDataset(shapes)
    return await validator.validate({ dataset: datasetFromStore(store) })
}
