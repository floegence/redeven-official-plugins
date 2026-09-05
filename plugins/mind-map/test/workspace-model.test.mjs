import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_DOCUMENTS,
  MAX_NODES_PER_DOCUMENT,
  addChild,
  addDocument,
  addSibling,
  createHistory,
  createWorkspace,
  deleteDocument,
  deleteNode,
  duplicateDocument,
  exportDocument,
  importDocument,
  isValidNodeTextDraft,
  moveNode,
  redoHistory,
  renameNode,
  setNodeAlignment,
  setNodeColor,
  toggleCollapsed,
  undoHistory,
  validateWorkspace,
} from '../ui/src/workspace-model.ts';

describe('Mind Map workspace model', () => {
  it('always starts with one selected document and one root', () => {
    const workspace = createWorkspace(1);
    assert.equal(workspace.documents.length, 1);
    assert.equal(workspace.documents[0].nodes.length, 1);
    assert.equal(workspace.documents[0].nodes[0].parent_id, null);
    assert.equal(workspace.documents[0].nodes[0].alignment, 'center');
    assert.equal(workspace.selected_document_id, workspace.documents[0].id);
    assert.doesNotThrow(() => validateWorkspace(workspace));
  });

  it('adds children and siblings with stable order and bilateral sides', () => {
    const workspace = createWorkspace(2);
    const document = workspace.documents[0];
    const root = document.nodes[0];
    const first = addChild(document, root.id, 'First');
    const second = addChild(document, root.id, 'Second');
    const sibling = addSibling(document, first.id, 'Sibling');
    assert.deepEqual(document.nodes.filter((node) => node.parent_id === root.id).map((node) => node.order), [0, 1, 2]);
    assert.equal(first.side, 'right');
    assert.equal(second.side, 'left');
    assert.equal(sibling.side, first.side);
    assert.doesNotThrow(() => validateWorkspace(workspace));
  });

  it('toggles the root when it has descendants', () => {
    const workspace = createWorkspace(21);
    const document = workspace.documents[0];
    const root = document.nodes[0];
    addChild(document, root.id, 'Branch');

    assert.equal(toggleCollapsed(document, root.id), true);
    assert.equal(root.collapsed, true);
    assert.equal(toggleCollapsed(document, root.id), true);
    assert.equal(root.collapsed, false);
  });

  it('moves a subtree but rejects root, self, and descendant cycles', () => {
    const workspace = createWorkspace(3);
    const document = workspace.documents[0];
    const root = document.nodes[0];
    const parent = addChild(document, root.id, 'Parent');
    const child = addChild(document, parent.id, 'Child');
    const other = addChild(document, root.id, 'Other');
    assert.equal(moveNode(document, root.id, other.id), false);
    assert.equal(moveNode(document, parent.id, child.id), false);
    assert.equal(moveNode(document, parent.id, parent.id), false);
    assert.equal(moveNode(document, child.id, other.id), true);
    assert.equal(child.parent_id, other.id);
    assert.doesNotThrow(() => validateWorkspace(workspace));
  });

  it('reorders a moved node at the requested sibling position', () => {
    const workspace = createWorkspace(31);
    const document = workspace.documents[0];
    const root = document.nodes[0];
    const first = addChild(document, root.id, 'First');
    const second = addChild(document, root.id, 'Second');
    const third = addChild(document, root.id, 'Third');
    assert.equal(moveNode(document, third.id, root.id, 'right', 0), true);
    assert.deepEqual(
      document.nodes.filter((node) => node.parent_id === root.id).sort((a, b) => a.order - b.order).map((node) => node.id),
      [third.id, first.id, second.id],
    );
    assert.deepEqual(
      document.nodes.filter((node) => node.parent_id === root.id).sort((a, b) => a.order - b.order).map((node) => node.order),
      [0, 1, 2],
    );
  });

  it('deletes a complete subtree while preserving the root', () => {
    const workspace = createWorkspace(4);
    const document = workspace.documents[0];
    const root = document.nodes[0];
    const parent = addChild(document, root.id, 'Parent');
    addChild(document, parent.id, 'Child');
    assert.equal(deleteNode(document, root.id), false);
    assert.equal(deleteNode(document, parent.id), true);
    assert.equal(document.nodes.length, 1);
  });

  it('keeps every node color independent at arbitrary depth', () => {
    const workspace = createWorkspace(41);
    const document = workspace.documents[0];
    const root = document.nodes[0];
    const child = addChild(document, root.id, 'Child');
    const grandchild = addChild(document, child.id, 'Grandchild');
    const greatGrandchild = addChild(document, grandchild.id, 'Great grandchild');

    assert.equal(setNodeColor(document, child.id, 'rose'), true);
    assert.equal(setNodeColor(document, grandchild.id, 'green'), true);
    assert.equal(setNodeColor(document, greatGrandchild.id, 'rose'), true);
    assert.equal(child.color, 'rose');
    assert.equal(grandchild.color, 'green');
    assert.equal(greatGrandchild.color, 'rose');

    assert.equal(setNodeColor(document, grandchild.id, 'violet'), true);
    assert.equal(child.color, 'rose');
    assert.equal(grandchild.color, 'violet');
    assert.equal(greatGrandchild.color, 'rose');
  });

  it('keeps text alignment independent for every node', () => {
    const workspace = createWorkspace(42);
    const document = workspace.documents[0];
    const root = document.nodes[0];
    const child = addChild(document, root.id, 'Child');

    assert.equal(child.alignment, 'center');
    assert.equal(setNodeAlignment(document, root.id, 'left'), true);
    assert.equal(setNodeAlignment(document, child.id, 'right'), true);
    assert.equal(root.alignment, 'left');
    assert.equal(child.alignment, 'right');
    assert.equal(setNodeAlignment(document, child.id, 'right'), false);
    assert.equal(setNodeAlignment(document, child.id, 'justify'), false);
    assert.doesNotThrow(() => validateWorkspace(workspace));
  });

  it('supports document creation, duplication, deletion, and a permanent final document', () => {
    const workspace = createWorkspace(5);
    const first = workspace.documents[0];
    addChild(first, first.nodes[0].id, 'Branch');
    const second = addDocument(workspace, 'Plan');
    const copy = duplicateDocument(workspace, first.id);
    assert.equal(copy.nodes.length, first.nodes.length);
    assert.notEqual(copy.id, first.id);
    assert.ok(copy.nodes.every((node) => !first.nodes.some((source) => source.id === node.id)));
    assert.equal(deleteDocument(workspace, second.id), true);
    assert.equal(deleteDocument(workspace, copy.id), true);
    assert.equal(deleteDocument(workspace, first.id), false);
  });

  it('round-trips one document through bounded DSL with regenerated identities', () => {
    const workspace = createWorkspace(6);
    const source = workspace.documents[0];
    renameNode(source, source.nodes[0].id, 'Launch');
    const branch = addChild(source, source.nodes[0].id, 'Research');
    toggleCollapsed(source, branch.id);
    const dsl = exportDocument(source);
    assert.match(dsl, /^mind-map 1\nkind: document/u);
    const imported = importDocument(dsl, workspace, 99);
    assert.equal(imported.title, 'Launch');
    assert.equal(imported.nodes.length, 2);
    assert.notEqual(imported.id, source.id);
    assert.ok(imported.nodes.every((node) => !source.nodes.some((candidate) => candidate.id === node.id)));
    assert.throws(() => importDocument('{"schema_version":"wrong"}', workspace, 100));
    const malformed = structuredClone(source);
    malformed.nodes[1].parent_id = 'missing';
    for (const node of malformed.nodes) delete node.alignment;
    assert.throws(() => importDocument(JSON.stringify(malformed), workspace, 101), /parent/u);
    assert.throws(() => importDocument(' '.repeat(60 * 1024 + 1), workspace, 102), /import limit/u);
  });

  it('provides bounded immutable undo and redo snapshots', () => {
    const workspace = createWorkspace(7);
    const history = createHistory(workspace);
    renameNode(workspace.documents[0], workspace.documents[0].nodes[0].id, 'Changed');
    history.commit(workspace);
    const undone = undoHistory(history, workspace);
    assert.equal(undone.documents[0].nodes[0].title, 'Central topic');
    const redone = redoHistory(history, undone);
    assert.equal(redone.documents[0].nodes[0].title, 'Changed');
    for (let index = 0; index < 140; index += 1) history.commit(redone);
    assert.ok(history.undo.length <= 100);
  });

  it('enforces document and node limits', () => {
    const workspace = createWorkspace(8);
    for (let index = 1; index < MAX_DOCUMENTS; index += 1) addDocument(workspace, `Map ${index}`);
    assert.throws(() => addDocument(workspace, 'Too many'));
    const document = workspace.documents[0];
    const root = document.nodes[0];
    for (let index = 1; index < MAX_NODES_PER_DOCUMENT; index += 1) addChild(document, root.id, `N${index}`);
    assert.throws(() => addChild(document, root.id, 'Too many'));
  });

  it('enforces complete node text limits without truncating accepted input', () => {
    const workspace = createWorkspace(9);
    const document = workspace.documents[0];
    const root = document.nodes[0];
    const maximum = '🚀'.repeat(512);
    assert.equal(isValidNodeTextDraft(maximum), true);
    assert.equal(renameNode(document, root.id, maximum), true);
    assert.equal(root.title, maximum);
    assert.equal(isValidNodeTextDraft(`${maximum}x`), false);
    assert.equal(isValidNodeTextDraft(`line${'\nnext'.repeat(32)}`), true);
    assert.equal(isValidNodeTextDraft(`line${'\nnext'.repeat(33)}`), false);
    assert.throws(() => renameNode(document, root.id, `${maximum}x`), /limits/u);
  });

  it('matches the Worker validation boundary for timestamps, controls, root order, and branch sides', () => {
    const valid = createWorkspace(10);
    const document = valid.documents[0];
    const root = document.nodes[0];
    const branch = addChild(document, root.id, 'Branch');
    const topic = addChild(document, branch.id, 'Topic');
    assert.doesNotThrow(() => validateWorkspace(valid));

    const timestampDrift = structuredClone(valid);
    timestampDrift.documents[0].updated_at = 'x'.repeat(65);
    assert.throws(() => validateWorkspace(timestampDrift), /document/u);

    const controlDrift = structuredClone(valid);
    controlDrift.documents[0].nodes[0].title = 'Root\u0085topic';
    assert.throws(() => validateWorkspace(controlDrift), /node/u);

    const rootOrderDrift = structuredClone(valid);
    rootOrderDrift.documents[0].nodes[0].order = 1;
    assert.throws(() => validateWorkspace(rootOrderDrift), /root/u);

    const sideDrift = structuredClone(valid);
    sideDrift.documents[0].nodes.find((node) => node.id === topic.id).side = branch.side === 'left' ? 'right' : 'left';
    assert.throws(() => validateWorkspace(sideDrift), /side/u);

    const alignmentDrift = structuredClone(valid);
    alignmentDrift.documents[0].nodes[0].alignment = 'justify';
    assert.throws(() => validateWorkspace(alignmentDrift), /node/u);
  });
});
