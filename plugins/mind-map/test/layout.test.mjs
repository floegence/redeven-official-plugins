import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addChild, createWorkspace } from '../ui/src/workspace-model.ts';
import { fitLayoutToViewport, layoutDocument } from '../ui/src/layout.ts';

describe('Mind Map automatic layout', () => {
  it('keeps the root centered and distributes bilateral branches to both sides', () => {
    const document = createWorkspace(1).documents[0];
    const root = document.nodes[0];
    for (let index = 0; index < 8; index += 1) addChild(document, root.id, `Branch ${index}`);
    const layout = layoutDocument(document);
    const rootBox = layout.nodes.get(root.id);
    assert.deepEqual({ x: rootBox.x, y: rootBox.y }, { x: 0, y: 0 });
    const branches = document.nodes.filter((node) => node.parent_id === root.id).map((node) => layout.nodes.get(node.id));
    assert.ok(branches.some((box) => box.x < 0));
    assert.ok(branches.some((box) => box.x > 0));
  });

  it('places every visible node on the right in single-direction mode', () => {
    const document = createWorkspace(2).documents[0];
    document.layout = 'right';
    const root = document.nodes[0];
    const branch = addChild(document, root.id, 'Branch');
    addChild(document, branch.id, 'Leaf');
    const layout = layoutDocument(document);
    assert.ok([...layout.nodes.values()].filter((box) => box.id !== root.id).every((box) => box.x > 0));
  });

  it('allocates non-overlapping vertical spans for large sibling groups', () => {
    const document = createWorkspace(3).documents[0];
    document.layout = 'right';
    const root = document.nodes[0];
    for (let index = 0; index < 20; index += 1) {
      const branch = addChild(document, root.id, `Branch ${index}`);
      addChild(document, branch.id, `Leaf ${index}`);
    }
    const boxes = [...layoutDocument(document).nodes.values()].filter((box) => box.depth === 1).sort((a, b) => a.y - b.y);
    for (let index = 1; index < boxes.length; index += 1) {
      assert.ok(boxes[index].y - boxes[index - 1].y >= 64);
    }
  });

  it('removes collapsed descendants without changing the stored tree', () => {
    const document = createWorkspace(4).documents[0];
    const root = document.nodes[0];
    const branch = addChild(document, root.id, 'Branch');
    const leaf = addChild(document, branch.id, 'Leaf');
    branch.collapsed = true;
    const layout = layoutDocument(document);
    assert.equal(layout.nodes.has(branch.id), true);
    assert.equal(layout.nodes.has(leaf.id), false);
    assert.equal(document.nodes.length, 3);
  });

  it('fits visible content inside a compact editor viewport', () => {
    const document = createWorkspace(5).documents[0];
    document.layout = 'right';
    const root = document.nodes[0];
    addChild(document, root.id, 'A visible branch');
    const layout = layoutDocument(document);
    const viewport = fitLayoutToViewport(layout, 620, 554, { top: 76, right: 28, bottom: 68, left: 28 });
    const boxes = [...layout.nodes.values()];
    const left = Math.min(...boxes.map((box) => 310 + viewport.x + (box.x - box.width / 2) * viewport.zoom));
    const right = Math.max(...boxes.map((box) => 310 + viewport.x + (box.x + box.width / 2) * viewport.zoom));
    assert.ok(left >= 28);
    assert.ok(right <= 592);
    assert.ok(viewport.zoom <= 1);
    assert.ok(viewport.zoom >= 0.42);
  });
});
