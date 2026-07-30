# Containers

Containers is Redeven's official Docker and Podman management plugin. The
plugin owns its UI source, localized copy, icon, and package manifest in this
repository. Redeven supplies the versioned host capability implementation at
runtime; the plugin calls that capability only through the released
ReDevPlugin bridge.

## Development

Install dependencies, run the focused tests, and build the package root:

```bash
npm ci
npm test
npm run build
```

The generated `dist/` directory is local build output. Redeven development
builds must fetch an immutable commit from this repository before building the
plugin; they must never import a sibling checkout or a copy stored in Redeven.

Version `4.0.0` is currently a development source version. It is not an
official stable installable release until the deterministic package is signed
with the authorized Redeven official signing identity and its release metadata
is published.
