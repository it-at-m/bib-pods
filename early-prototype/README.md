# library-pods-prototype

The repo contains three modules:
- `solid-server`: the solid server managing the pods
- `integration-layer`: the integration layer between the solid server and clients using the pods
  - provides a bundle to be imported in HTML pages of clients
  - uses that bundle for a client-independent pod-management site
    - this could also be the place for running [decoupled processing logic](https://github.com/benjaminaaron/evolvable-semantic-infrastructure) client-side
- `library-site`: mockup of a library site that is integrating with the library pods system
