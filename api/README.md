HTTP endpoint for the bib-pods recommendation engine - the same logic the browser plugin (docs, TYPO3) runs.

### Run
```sh
npm start
```

### Request
```sh
curl -X POST http://localhost:8985/recommendations \
     -H "content-type: text/turtle" \
     --data-binary @profile.ttl
```

### Response
```json
{ "results": [ { "strategy": { "iri": "…", "label": "…" }, "docs": [ … ] } ] }
```
