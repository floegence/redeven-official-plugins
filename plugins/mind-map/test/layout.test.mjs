import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addChild, createWorkspace } from '../ui/src/workspace-model.ts';
import { edgeAnchor, expanderCenter, fitLayoutToViewport, layoutDocument, nodeVisualKind, topicUnderline } from '../ui/src/layout.ts';

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

  it('allocates non-overlapping vertical spans for multiline sibling groups', () => {
    const document = createWorkspace(3).documents[0];
    document.layout = 'right';
    const root = document.nodes[0];
    for (let index = 0; index < 20; index += 1) {
      const branch = addChild(document, root.id, `Branch ${index}\nwith an explicit second line`);
      addChild(document, branch.id, `Leaf ${index}\nwith a second line\nand a third line`);
    }
    const boxes = [...layoutDocument(document).nodes.values()].filter((box) => box.depth === 1).sort((a, b) => a.y - b.y);
    for (let index = 1; index < boxes.length; index += 1) {
      assert.ok(boxes[index].y - boxes[index - 1].y >= (boxes[index].height + boxes[index - 1].height) / 2 + 20);
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

  it('removes all root descendants while the root is collapsed', () => {
    const document = createWorkspace(45).documents[0];
    const root = document.nodes[0];
    const branch = addChild(document, root.id, 'Branch');
    addChild(document, branch.id, 'Leaf');
    root.collapsed = true;

    const layout = layoutDocument(document);
    assert.deepEqual([...layout.nodes.keys()], [root.id]);
    assert.equal(layout.edges.length, 0);
    assert.equal(document.nodes.length, 3);
  });

  it('gives root, branch, and deeper topics distinct visual geometry', () => {
    const document = createWorkspace(42).documents[0];
    const root = document.nodes[0];
    const branch = addChild(document, root.id, 'Branch');
    const child = addChild(document, branch.id, 'Child');
    const leaf = addChild(document, child.id, 'Leaf');
    const layout = layoutDocument(document);

    const rootBox = layout.nodes.get(root.id);
    const branchBox = layout.nodes.get(branch.id);
    const childBox = layout.nodes.get(child.id);
    const leafBox = layout.nodes.get(leaf.id);
    assert.ok(rootBox.height > branchBox.height);
    assert.ok(branchBox.height > childBox.height);
    assert.equal(childBox.height, leafBox.height);
    assert.ok(branchBox.width >= childBox.width);
  });

  it('uses an editing title in the single shared layout result', () => {
    const document = createWorkspace(43).documents[0];
    const root = document.nodes[0];
    const normal = layoutDocument(document).nodes.get(root.id);
    const editing = layoutDocument(document, { nodeID: root.id, title: 'A long live editing title\nwith another line' }).nodes.get(root.id);
    assert.ok(editing.height > normal.height);
    assert.ok(editing.width >= normal.width);
    assert.deepEqual(editing.text.lines, ['A long live editing title', 'with another line']);
  });

  it('keeps the horizontal gap outside real multiline node bounds', () => {
    const document = createWorkspace(44).documents[0];
    document.layout = 'right';
    const root = document.nodes[0];
    root.title = 'A root title that grows to its full measured width';
    const branch = addChild(document, root.id, 'A branch title that also grows across the available width');
    const layout = layoutDocument(document);
    const rootBox = layout.nodes.get(root.id);
    const branchBox = layout.nodes.get(branch.id);
    assert.equal(branchBox.x - branchBox.width / 2 - (rootBox.x + rootBox.width / 2), 88);
  });

  it('uses block nodes only for the root and first-level branches', () => {
    assert.equal(nodeVisualKind(0), 'root');
    assert.equal(nodeVisualKind(1), 'branch');
    assert.equal(nodeVisualKind(2), 'topic');
    assert.equal(nodeVisualKind(8), 'topic');
  });

  it('keeps deep topic hit areas while placing a full-width underline below the text', () => {
    const rightTopic = { id: 'right', x: 320, y: 48, width: 140, height: 36, depth: 2, side: 'right' };
    const leftTopic = { ...rightTopic, id: 'left', x: -320, side: 'left' };
    const rightLine = topicUnderline(rightTopic);
    const leftLine = topicUnderline(leftTopic);

    assert.deepEqual(rightLine, { startX: 256, endX: 384, y: 62 });
    assert.deepEqual(leftLine, { startX: -384, endX: -256, y: 62 });
    assert.equal(rightLine.endX - rightLine.startX, rightTopic.width - 12);
    assert.equal(leftLine.endX - leftLine.startX, leftTopic.width - 12);
    assert.equal(rightTopic.height, 36);
  });

  it('joins deep-node edges to the inner and outer ends of the underline', () => {
    const rightTopic = { id: 'right', x: 320, y: 48, width: 140, height: 36, depth: 2, side: 'right' };
    const leftTopic = { ...rightTopic, id: 'left', x: -320, side: 'left' };

    assert.deepEqual(edgeAnchor(rightTopic, 'right', 'target'), { x: 256, y: 62 });
    assert.deepEqual(edgeAnchor(rightTopic, 'right', 'source'), { x: 384, y: 62 });
    assert.deepEqual(edgeAnchor(leftTopic, 'left', 'target'), { x: -256, y: 62 });
    assert.deepEqual(edgeAnchor(leftTopic, 'left', 'source'), { x: -384, y: 62 });
  });

  it('uses one outer anchor for drawing and hitting subtree expanders', () => {
    const rightBranch = { id: 'right-branch', x: 320, y: 48, width: 140, height: 44, depth: 1, side: 'right' };
    const leftBranch = { ...rightBranch, id: 'left-branch', x: -320, side: 'left' };
    const rightTopic = { ...rightBranch, id: 'right-topic', height: 36, depth: 3 };

    assert.deepEqual(expanderCenter(rightBranch), { x: 390, y: 48 });
    assert.deepEqual(expanderCenter(leftBranch), { x: -390, y: 48 });
    assert.deepEqual(expanderCenter(rightTopic), { x: 384, y: 62 });
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
    assert.ok(viewport.zoom >= 0.32);
  });

  it('uses the shared minimum zoom when fitting very large content', () => {
    const layout = {
      nodes: new Map([['large', { id: 'large', x: 0, y: 0, width: 4_000, height: 4_000, depth: 0, side: 'right' }]]),
      edges: [],
    };
    assert.equal(fitLayoutToViewport(layout, 800, 600, { top: 76, right: 28, bottom: 68, left: 28 }).zoom, 0.32);
  });
});
