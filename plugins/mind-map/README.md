# Mind Map

Mind Map is an offline-first visual thinking plugin for Redeven. It manages up
to 32 maps, supports bilateral and right-facing tree layouts, and keeps up to
500 nodes in each map.

The editor provides keyboard-first structure editing, pointer-based panning and
reparenting, collapse controls, colours, undo/redo, zoom, bounded DSL import,
and whole-map PNG, JPEG, WebP, SVG, and DSL file export. A user-scoped
ReDevPlugin KV store saves the workspace through a small Rust WASM worker.
Optimistic revisions prevent two open surfaces from silently overwriting one
another.

The application is an ordinary Solid Web application with Floe controls, native
DOM input, pointer capture, Canvas, IME composition and responsive overlays.
It ships no network access, remote fonts or audio. The host SDK is used only for
workspace persistence, authorized export, lifecycle and explicit Agent methods.

Agent discovery exposes mindmap.document.read and mindmap.document.edit on the
exact live editor. Reads return a document ID and monotonic in-memory revision.
Edits require both fields and apply a bounded operation batch atomically through
the same model and undo history as user edits. Stale revisions, a different
selected document and an unfinished local edit return explicit business results.

Before close, pending text is committed and the workspace is saved. Failed or
uncertain saves keep the document dirty. A lost write response is reconciled
by reading its exact revision and DSL; old reads never authorize blind replay.
Forced disposal never attempts a write after authority has been revoked.

## Design references

The node hierarchy was evaluated against the established line-style patterns
in [simple-mind-map](https://github.com/wanglin2/mind-map) and
[Mind Elixir](https://github.com/SSShooter/mind-elixir-core), both MIT-licensed.
They were used as interaction and visual references only; no source code or
assets from either project are included.

## Build and test

```bash
npm ci
npm test
npm run build
```
