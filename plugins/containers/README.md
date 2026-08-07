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

Version `4.3.0` is the stable release-train version. Its installable package,
signed release reference, and public trust documents are published together as
immutable assets on the matching GitHub Release after the released ReDevPlugin
publisher verifies the complete external-signature exchange.

The signed manifest is the only source for the plugin's name, summary, long
description, highlights, search keywords, and Surface labels. It provides
complete independent author copy for `en-US`, `zh-CN`, `zh-TW`, `ja-JP`,
`ko-KR`, `de-DE`, `fr-FR`, `es-ES`, `pt-BR`, and `ru-RU`.
