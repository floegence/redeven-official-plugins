import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addChild, createWorkspace } from '../ui/src/workspace-model.ts';
import { layoutDocument } from '../ui/src/layout.ts';
import {
  bitmapExportSize,
  exportLayoutBounds,
  safeExportBaseName,
  serializeMindMapSVG,
} from '../ui/src/export.ts';

const appearance = {
  canvas: '#f6f7fb',
  surface: '#ffffff',
  surface_elevated: '#ffffff',
  text: '#202532',
  text_muted: '#737b8c',
  border: '#dfe3eb',
  accent: '#5865d8',
  accent_text: '#ffffff',
  success: '#2d9b75',
  warning: '#c78722',
  danger: '#cf4c62',
  focus: '#5865d8',
};

describe('Mind Map file export', () => {
  it('creates safe, useful file names without allowing path-like output', () => {
    assert.equal(safeExportBaseName(' Product / Q4: roadmap? '), 'Product-Q4-roadmap');
    assert.equal(safeExportBaseName('..'), 'mind-map');
    assert.equal(safeExportBaseName('  思维\n导图  '), '思维-导图');
    assert.ok(safeExportBaseName('x'.repeat(200)).length <= 80);
  });

  it('derives bounded bitmap dimensions from the whole layout instead of the editor viewport', () => {
    const document = createWorkspace(7).documents[0];
    document.layout = 'right';
    const root = document.nodes[0];
    const branch = addChild(document, root.id, 'A wide branch');
    addChild(document, branch.id, 'A deep topic');
    const layout = layoutDocument(document);
    const bounds = exportLayoutBounds(layout);
    const bitmap = bitmapExportSize(bounds);

    assert.ok(bounds.left < 0);
    assert.ok(bounds.right > 300);
    assert.ok(bitmap.width >= Math.ceil(bounds.width));
    assert.ok(bitmap.height >= Math.ceil(bounds.height));
    assert.ok(bitmap.width <= 4096);
    assert.ok(bitmap.height <= 4096);
    assert.ok(bitmap.scale > 0);
  });

  it('serializes the complete visible map as standalone, escaped SVG without editor chrome', () => {
    const document = createWorkspace(9).documents[0];
    document.title = 'R&D <plan>';
    const root = document.nodes[0];
    root.title = 'Root & <goal>';
    const branch = addChild(document, root.id, 'Branch "one"');
    addChild(document, branch.id, 'Line one\nLine two');
    const layout = layoutDocument(document);
    const svg = serializeMindMapSVG(document, layout, appearance);

    assert.match(svg, /^<\?xml version="1\.0" encoding="UTF-8"\?>/u);
    assert.match(svg, /<svg[^>]+role="img"/u);
    assert.match(svg, /<title>R&amp;D &lt;plan&gt;<\/title>/u);
    assert.match(svg, /Root &amp; &lt;goal&gt;/u);
    assert.match(svg, /Branch &quot;one&quot;/u);
    assert.match(svg, /<path /u);
    assert.equal((svg.match(/data-node-id=/gu) ?? []).length, 3);
    assert.doesNotMatch(svg, /selection|tooltip|editor|shortcut/iu);
  });
});
