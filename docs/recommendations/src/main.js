export { getStrategies, buildQuery } from "bib-src/src/recommendations.js"
export { contractTerm, getProfileSubject } from "cori-sdk/utils.js"
export { getChoice, isStorageReady, loadStore } from "cori-sdk/storage/index.js"

// The query column is built from the same profile the plugin demo writes; the storage
// backends only find its entries under the app's key prefix, so mirror main.js's config.
import { setStorageConfig } from "cori-sdk/storage/index.js"
import { CORI, parseTurtle } from "cori-sdk/utils.js"
import configTtl from "bib-src/definitions/config.ttl.js"

const configStore = parseTurtle(configTtl)
setStorageConfig({ appName: configStore.getObjects(null, CORI + "appName", null)[0]?.value })

export const SOLR_ENDPOINT = __SOLR_ENDPOINT__
