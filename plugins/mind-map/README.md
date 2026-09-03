# Mind Map

Mind Map is an offline-first visual thinking plugin for Redeven. It manages up
to 32 maps, supports bilateral and right-facing tree layouts, and keeps up to
500 nodes in each map.

The editor provides keyboard-first structure editing, pointer-based panning and
reparenting, collapse controls, colours, undo/redo, zoom, and bounded JSON
import/export. A user-scoped ReDevPlugin KV store saves the workspace through a
small Rust WASM worker. Optimistic revisions prevent two open surfaces from
silently overwriting one another.

The interface, icon, layout algorithm, renderer, and worker are original. The
plugin contains no third-party visual, audio, or font assets and requests no
network access.

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
