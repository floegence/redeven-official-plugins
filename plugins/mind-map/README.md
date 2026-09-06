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

One layout button shows the target layout as a central topic with four curved
branches. Click it to switch between both sides and right only. Its tooltip
names the target layout in the current language.

The interface, application icon, layout icons, layout algorithm, renderer, and
worker are original. Other toolbar icons are rasterized Lucide assets. The
plugin includes no third-party audio or fonts and requests no network access.

The editable layout icons are `assets/icons/switch-bilateral.svg` and
`assets/icons/switch-right.svg`. Their 64px PNG exports ship as CSS masks;
regenerate each PNG with Inkscape at 64px width and height after editing its SVG.

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
