export type MapLayout = 'bilateral' | 'right';
export type BranchSide = 'left' | 'right';
export type NodeColor = 'accent' | 'blue' | 'green' | 'amber' | 'rose' | 'violet';

export type MindMapNode = {
  id: string;
  parent_id: string | null;
  order: number;
  side: BranchSide;
  title: string;
  color: NodeColor;
  collapsed: boolean;
};

export type MindMapDocument = {
  schema_version: 'mind-map.document.v1';
  id: string;
  title: string;
  layout: MapLayout;
  nodes: MindMapNode[];
  updated_at: string;
};

export type MindMapWorkspace = {
  schema_version: 'mind-map.workspace.v1';
  selected_document_id: string;
  documents: MindMapDocument[];
};

export type WorkspaceHistory = {
  undo: MindMapWorkspace[];
  redo: MindMapWorkspace[];
  present: MindMapWorkspace;
  commit(workspace: MindMapWorkspace): void;
};

export const MAX_DOCUMENTS = 32;
export const MAX_NODES_PER_DOCUMENT = 500;
export const MAX_TITLE_LENGTH = 512;
export const MAX_TITLE_NEWLINES = 32;
export const MAX_TITLE_UTF8_BYTES = 2048;
export const MAX_DOCUMENT_TITLE_LENGTH = 80;
export const MAX_IMPORT_BYTES = 60 * 1024;
export const MAX_WORKSPACE_DSL_UTF8_BYTES = 3_000_000;
const COLORS: readonly NodeColor[] = ['accent', 'blue', 'green', 'amber', 'rose', 'violet'];
const LEGACY_MAX_TITLE_LENGTH = 120;
const DOCUMENT_FIELDS = ['schema_version', 'id', 'title', 'layout', 'updated_at', 'nodes'] as const;
const NODE_FIELDS = ['id', 'parent_id', 'order', 'side', 'title', 'color', 'collapsed'] as const;

export function createWorkspace(seed = Date.now()): MindMapWorkspace {
  const document = createDocument(`map-${normalizeSeed(seed)}`, 'New Mind Map');
  return {
    schema_version: 'mind-map.workspace.v1',
    selected_document_id: document.id,
    documents: [document],
  };
}

export function createDocument(id: string, title: string): MindMapDocument {
  const cleanTitle = boundedTitle(title, MAX_DOCUMENT_TITLE_LENGTH, 'New Mind Map');
  return {
    schema_version: 'mind-map.document.v1',
    id,
    title: cleanTitle,
    layout: 'bilateral',
    nodes: [{
      id: `${id}:node-1`,
      parent_id: null,
      order: 0,
      side: 'right',
      title: 'Central topic',
      color: 'accent',
      collapsed: false,
    }],
    updated_at: new Date(0).toISOString(),
  };
}

export function addDocument(workspace: MindMapWorkspace, title = 'New Mind Map'): MindMapDocument {
  if (workspace.documents.length >= MAX_DOCUMENTS) throw new Error('document limit reached');
  const document = createDocument(nextDocumentID(workspace), title);
  workspace.documents.push(document);
  workspace.selected_document_id = document.id;
  touch(document);
  return document;
}

export function duplicateDocument(workspace: MindMapWorkspace, documentID: string): MindMapDocument {
  if (workspace.documents.length >= MAX_DOCUMENTS) throw new Error('document limit reached');
  const source = requiredDocument(workspace, documentID);
  const documentIDCopy = nextDocumentID(workspace);
  const nodeIDs = new Map(source.nodes.map((node, index) => [node.id, `${documentIDCopy}:node-${index + 1}`]));
  const copy: MindMapDocument = {
    ...clone(source),
    id: documentIDCopy,
    title: boundedTitle(`${source.title} copy`, MAX_DOCUMENT_TITLE_LENGTH, 'Copy'),
    nodes: source.nodes.map((node) => ({
      ...node,
      id: nodeIDs.get(node.id)!,
      parent_id: node.parent_id === null ? null : nodeIDs.get(node.parent_id)!,
    })),
  };
  touch(copy);
  workspace.documents.push(copy);
  workspace.selected_document_id = copy.id;
  return copy;
}

export function deleteDocument(workspace: MindMapWorkspace, documentID: string): boolean {
  if (workspace.documents.length <= 1) return false;
  const index = workspace.documents.findIndex((document) => document.id === documentID);
  if (index < 0) return false;
  workspace.documents.splice(index, 1);
  if (workspace.selected_document_id === documentID) {
    workspace.selected_document_id = workspace.documents[Math.min(index, workspace.documents.length - 1)].id;
  }
  return true;
}

export function renameDocument(document: MindMapDocument, title: string): boolean {
  const next = boundedTitle(title, MAX_DOCUMENT_TITLE_LENGTH, 'Untitled');
  if (next === document.title) return false;
  document.title = next;
  touch(document);
  return true;
}

export function addChild(document: MindMapDocument, parentID: string, title = 'New topic'): MindMapNode {
  if (document.nodes.length >= MAX_NODES_PER_DOCUMENT) throw new Error('node limit reached');
  const parent = requiredNode(document, parentID);
  const siblings = childrenOf(document, parentID);
  const side = parent.parent_id === null ? balancedRootSide(document) : parent.side;
  const node: MindMapNode = {
    id: nextNodeID(document),
    parent_id: parent.id,
    order: siblings.length,
    side,
    title: nodeText(title, 'New topic'),
    color: parent.parent_id === null ? colorForIndex(siblings.length + 1) : parent.color,
    collapsed: false,
  };
  document.nodes.push(node);
  parent.collapsed = false;
  touch(document);
  return node;
}

export function addSibling(document: MindMapDocument, nodeID: string, title = 'New topic'): MindMapNode {
  const node = requiredNode(document, nodeID);
  if (node.parent_id === null) return addChild(document, node.id, title);
  const created = addChild(document, node.parent_id, title);
  created.side = node.side;
  return created;
}

export function renameNode(document: MindMapDocument, nodeID: string, title: string): boolean {
  const node = requiredNode(document, nodeID);
  const next = nodeText(title, node.title);
  if (next === node.title) return false;
  node.title = next;
  if (node.parent_id === null) document.title = boundedTitle(next, MAX_DOCUMENT_TITLE_LENGTH, document.title);
  touch(document);
  return true;
}

export function deleteNode(document: MindMapDocument, nodeID: string): boolean {
  const node = requiredNode(document, nodeID);
  if (node.parent_id === null) return false;
  const deleted = new Set<string>([node.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of document.nodes) {
      if (candidate.parent_id !== null && deleted.has(candidate.parent_id) && !deleted.has(candidate.id)) {
        deleted.add(candidate.id);
        changed = true;
      }
    }
  }
  document.nodes = document.nodes.filter((candidate) => !deleted.has(candidate.id));
  normalizeOrders(document, node.parent_id);
  touch(document);
  return true;
}

export function toggleCollapsed(document: MindMapDocument, nodeID: string): boolean {
  const node = requiredNode(document, nodeID);
  if (childrenOf(document, node.id).length === 0) return false;
  node.collapsed = !node.collapsed;
  touch(document);
  return true;
}

export function setNodeColor(document: MindMapDocument, nodeID: string, color: NodeColor): boolean {
  if (!COLORS.includes(color)) return false;
  const node = requiredNode(document, nodeID);
  if (node.color === color) return false;
  node.color = color;
  touch(document);
  return true;
}

export function moveNode(
  document: MindMapDocument,
  nodeID: string,
  parentID: string,
  side?: BranchSide,
  targetOrder?: number,
): boolean {
  const node = requiredNode(document, nodeID);
  const parent = requiredNode(document, parentID);
  if (node.parent_id === null || node.id === parent.id || isDescendant(document, parent.id, node.id)) return false;
  const previousParent = node.parent_id;
  const siblings = childrenOf(document, parent.id).filter((candidate) => candidate.id !== node.id);
  const insertionIndex = Math.max(0, Math.min(siblings.length, targetOrder ?? siblings.length));
  node.parent_id = parent.id;
  siblings.splice(insertionIndex, 0, node);
  siblings.forEach((candidate, index) => { candidate.order = index; });
  node.side = parent.parent_id === null ? side ?? balancedRootSide(document, node.id) : parent.side;
  propagateSide(document, node.id, node.side);
  if (previousParent !== parent.id) normalizeOrders(document, previousParent);
  parent.collapsed = false;
  touch(document);
  return true;
}

export function nodeAndDescendantCount(document: MindMapDocument, nodeID: string): number {
  let count = 0;
  const visit = (id: string): void => {
    count += 1;
    for (const child of childrenOf(document, id)) visit(child.id);
  };
  visit(nodeID);
  return count;
}

export function exportDocument(document: MindMapDocument): string {
  return serializeDocumentDSL(document);
}

export function importDocument(serialized: string, workspace: MindMapWorkspace, seed = Date.now()): MindMapDocument {
  if (workspace.documents.length >= MAX_DOCUMENTS) throw new Error('document limit reached');
  if (new TextEncoder().encode(serialized).length > MAX_IMPORT_BYTES) throw new Error('document exceeds import limit');
  const candidate = parseDocumentDSL(serialized);
  const documentID = uniqueDocumentID(workspace, `map-${normalizeSeed(seed)}`);
  const nodeIDs = new Map(candidate.nodes.map((node, index) => [node.id, `${documentID}:node-${index + 1}`]));
  const imported: MindMapDocument = {
    ...clone(candidate),
    id: documentID,
    nodes: candidate.nodes.map((node) => ({
      ...node,
      id: nodeIDs.get(node.id)!,
      parent_id: node.parent_id === null ? null : nodeIDs.get(node.parent_id)!,
    })),
  };
  touch(imported);
  workspace.documents.push(imported);
  workspace.selected_document_id = imported.id;
  validateWorkspace(workspace);
  return imported;
}

export function validateWorkspace(value: unknown): asserts value is MindMapWorkspace {
  if (!isRecord(value) || value.schema_version !== 'mind-map.workspace.v1' ||
      typeof value.selected_document_id !== 'string' || !Array.isArray(value.documents) ||
      value.documents.length < 1 || value.documents.length > MAX_DOCUMENTS) {
    throw new Error('workspace is invalid');
  }
  const ids = new Set<string>();
  for (const raw of value.documents) {
    const document = validateDocument(raw);
    if (ids.has(document.id)) throw new Error('document id is duplicated');
    ids.add(document.id);
  }
  if (!ids.has(value.selected_document_id)) throw new Error('selected document is missing');
}

export function validateDocument(value: unknown): MindMapDocument {
  if (!isRecord(value) || value.schema_version !== 'mind-map.document.v1' || typeof value.id !== 'string' ||
      !validID(value.id) || typeof value.title !== 'string' || !validSingleLineText(value.title, MAX_DOCUMENT_TITLE_LENGTH) ||
      (value.layout !== 'bilateral' && value.layout !== 'right') ||
      typeof value.updated_at !== 'string' || new TextEncoder().encode(value.updated_at).length > 64 ||
      !Array.isArray(value.nodes) || value.nodes.length < 1 ||
      value.nodes.length > MAX_NODES_PER_DOCUMENT) throw new Error('document is invalid');
  const nodes = value.nodes as unknown[];
  const ids = new Set<string>();
  const roots: MindMapNode[] = [];
  for (const raw of nodes) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || !validID(raw.id) || ids.has(raw.id) ||
        !(raw.parent_id === null || typeof raw.parent_id === 'string') || !Number.isSafeInteger(raw.order) || Number(raw.order) < 0 ||
        (raw.side !== 'left' && raw.side !== 'right') || typeof raw.title !== 'string' || !validNodeText(raw.title) ||
        !COLORS.includes(raw.color as NodeColor) || typeof raw.collapsed !== 'boolean') {
      throw new Error('node is invalid');
    }
    ids.add(raw.id);
    if (raw.parent_id === null) roots.push(raw as unknown as MindMapNode);
  }
  if (roots.length !== 1 || roots[0].order !== 0) throw new Error('document must have one root with order zero');
  const document = value as unknown as MindMapDocument;
  for (const node of document.nodes) {
    if (node.parent_id !== null && !ids.has(node.parent_id)) throw new Error('node parent is missing');
    const visited = new Set<string>();
    let cursor: MindMapNode | undefined = node;
    while (cursor && cursor.parent_id !== null) {
      if (visited.has(cursor.id)) throw new Error('document contains a cycle');
      visited.add(cursor.id);
      const parentID: string = cursor.parent_id;
      cursor = document.nodes.find((candidate) => candidate.id === parentID);
    }
  }
  for (const parent of document.nodes) {
    const children = childrenOf(document, parent.id);
    if (children.some((child, index) => child.order !== index)) throw new Error('sibling order is invalid');
    if (parent.parent_id !== null && children.some((child) => child.side !== parent.side)) {
      throw new Error('branch side is inconsistent');
    }
  }
  return document;
}

export function selectedDocument(workspace: MindMapWorkspace): MindMapDocument {
  return requiredDocument(workspace, workspace.selected_document_id);
}

export function createHistory(initial: MindMapWorkspace): WorkspaceHistory {
  const history: WorkspaceHistory = {
    undo: [],
    redo: [],
    present: clone(initial),
    commit(workspace) {
      if (JSON.stringify(workspace) === JSON.stringify(history.present)) return;
      history.undo.push(clone(history.present));
      if (history.undo.length > 100) history.undo.splice(0, history.undo.length - 100);
      history.redo.length = 0;
      history.present = clone(workspace);
    },
  };
  return history;
}

export function undoHistory(history: WorkspaceHistory, current: MindMapWorkspace): MindMapWorkspace {
  const previous = history.undo.pop();
  if (!previous) return current;
  history.redo.push(clone(current));
  history.present = clone(previous);
  return clone(previous);
}

export function redoHistory(history: WorkspaceHistory, current: MindMapWorkspace): MindMapWorkspace {
  const next = history.redo.pop();
  if (!next) return current;
  history.undo.push(clone(current));
  history.present = clone(next);
  return clone(next);
}

function requiredDocument(workspace: MindMapWorkspace, id: string): MindMapDocument {
  const document = workspace.documents.find((candidate) => candidate.id === id);
  if (!document) throw new Error('document is missing');
  return document;
}

function requiredNode(document: MindMapDocument, id: string): MindMapNode {
  const node = document.nodes.find((candidate) => candidate.id === id);
  if (!node) throw new Error('node is missing');
  return node;
}

function childrenOf(document: MindMapDocument, parentID: string): MindMapNode[] {
  return document.nodes.filter((node) => node.parent_id === parentID).sort((left, right) => left.order - right.order);
}

function isDescendant(document: MindMapDocument, nodeID: string, ancestorID: string): boolean {
  let cursor = document.nodes.find((node) => node.id === nodeID);
  while (cursor?.parent_id !== null) {
    if (cursor?.parent_id === ancestorID) return true;
    cursor = document.nodes.find((node) => node.id === cursor?.parent_id);
  }
  return false;
}

function propagateSide(document: MindMapDocument, nodeID: string, side: BranchSide): void {
  for (const child of childrenOf(document, nodeID)) {
    child.side = side;
    propagateSide(document, child.id, side);
  }
}

function normalizeOrders(document: MindMapDocument, parentID: string | null): void {
  document.nodes.filter((node) => node.parent_id === parentID).sort((a, b) => a.order - b.order)
    .forEach((node, index) => { node.order = index; });
}

function balancedRootSide(document: MindMapDocument, ignoredID?: string): BranchSide {
  const root = document.nodes.find((node) => node.parent_id === null)!;
  const children = childrenOf(document, root.id).filter((node) => node.id !== ignoredID);
  const right = children.filter((node) => node.side === 'right').length;
  const left = children.length - right;
  return right <= left ? 'right' : 'left';
}

function colorForIndex(index: number): NodeColor {
  return COLORS[index % COLORS.length];
}

function nextNodeID(document: MindMapDocument): string {
  let sequence = document.nodes.length + 1;
  while (document.nodes.some((node) => node.id === `${document.id}:node-${sequence}`)) sequence += 1;
  return `${document.id}:node-${sequence}`;
}

function nextDocumentID(workspace: MindMapWorkspace): string {
  let sequence = workspace.documents.length + 1;
  while (workspace.documents.some((document) => document.id === `map-${sequence}`)) sequence += 1;
  return `map-${sequence}`;
}

function uniqueDocumentID(workspace: MindMapWorkspace, candidate: string): string {
  if (!workspace.documents.some((document) => document.id === candidate)) return candidate;
  return nextDocumentID(workspace);
}

function boundedTitle(value: string, maximum: number, fallback: string): string {
  let clean = '';
  let pendingSpace = false;
  for (const character of String(value).trim()) {
    if (character.trim() === '') {
      pendingSpace = clean.length > 0;
      continue;
    }
    if (pendingSpace) clean += ' ';
    clean += character;
    pendingSpace = false;
  }
  if (!clean) return fallback;
  return [...clean].slice(0, maximum).join('');
}

function nodeText(value: string, fallback: string): string {
  const normalized = String(value).replace(new RegExp('\\r\\n?', 'gu'), '\n');
  if (!normalized.trim()) return fallback;
  if (!validNodeText(normalized)) throw new Error('node text exceeds its supported limits');
  return normalized;
}

function validNodeText(value: string): boolean {
  return value.trim().length > 0 && [...value].length <= MAX_TITLE_LENGTH &&
    value.split('\n').length - 1 <= MAX_TITLE_NEWLINES && new TextEncoder().encode(value).length <= MAX_TITLE_UTF8_BYTES &&
    ![...value].some((character) => character !== '\n' && isControlCharacter(character));
}

function validSingleLineText(value: string, maximum: number): boolean {
  const length = [...value].length;
  return length > 0 && length <= maximum && value.trim() === value && ![...value].some(isControlCharacter);
}

function isControlCharacter(value: string): boolean {
  return new RegExp('^\\p{Cc}$', 'u').test(value);
}

export function isValidNodeTextDraft(value: string): boolean {
  const normalized = String(value).replace(new RegExp('\\r\\n?', 'gu'), '\n');
  return normalized.length === 0 || validNodeText(normalized);
}

function validID(value: string): boolean {
  if (value.length < 1 || value.length > 128 || !asciiAlphaNumeric(value.charCodeAt(0))) return false;
  return [...value].every((character) => {
    const code = character.charCodeAt(0);
    return asciiAlphaNumeric(code) || character === '.' || character === '_' || character === ':' || character === '-';
  });
}

function asciiAlphaNumeric(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function touch(document: MindMapDocument): void {
  document.updated_at = new Date().toISOString();
}

function normalizeSeed(seed: number): number {
  const value = Number.isFinite(seed) ? Math.abs(Math.trunc(seed)) : 1;
  return value || 1;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function serializeWorkspaceDSL(workspace: MindMapWorkspace): string {
  validateWorkspace(workspace);
  const serialized = `mind-map 1\nkind: workspace\nselected: ${JSON.stringify(workspace.selected_document_id)}\n\n${workspace.documents.map(serializeMap).join('\n\n')}\n`;
  ensureDSLByteLimit(serialized, MAX_WORKSPACE_DSL_UTF8_BYTES);
  return serialized;
}

export function serializeDocumentDSL(document: MindMapDocument): string {
  validateDocument(document);
  const serialized = `mind-map 1\nkind: document\n\n${serializeMap(document)}\n`;
  ensureDSLByteLimit(serialized, MAX_IMPORT_BYTES);
  return serialized;
}

export function parseWorkspaceDSL(serialized: string): MindMapWorkspace {
  const parsed = parseDSL(serialized, 'workspace');
  return parsed as MindMapWorkspace;
}

export function parseDocumentDSL(serialized: string): MindMapDocument {
  const normalized = normalizeSerialized(serialized);
  ensureDSLByteLimit(normalized, MAX_IMPORT_BYTES);
  if (normalized.trimStart().startsWith('{')) return validateLegacyDocument(JSON.parse(normalized));
  const parsed = parseDSL(normalized, 'document') as MindMapWorkspace;
  return parsed.documents[0];
}

function validateLegacyDocument(value: unknown): MindMapDocument {
  if (!isRecord(value) || !hasExactFields(value, DOCUMENT_FIELDS)) throw new Error('legacy document is invalid');
  if (!Array.isArray(value.nodes)) throw new Error('legacy document nodes are invalid');
  for (const raw of value.nodes) {
    if (!isRecord(raw) || !hasExactFields(raw, NODE_FIELDS) || typeof raw.title !== 'string' ||
        raw.title.includes('\n') || [...raw.title].length > LEGACY_MAX_TITLE_LENGTH) {
      throw new Error('legacy node is invalid');
    }
  }
  return validateDocument(value);
}

function hasExactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every((field) => Object.hasOwn(value, field));
}

function serializeMap(document: MindMapDocument): string {
  const root = document.nodes.find((node) => node.parent_id === null)!;
  return [
    `map ${JSON.stringify(document.id)}`,
    `  title: ${JSON.stringify(document.title)}`,
    `  layout: ${document.layout}`,
    `  updated-at: ${JSON.stringify(document.updated_at)}`,
    ...serializeNode(document, root, 1),
  ].join('\n');
}

function serializeNode(document: MindMapDocument, node: MindMapNode, depth: number): string[] {
  const prefix = '  '.repeat(depth);
  const fieldPrefix = '  '.repeat(depth + 1);
  const textPrefix = '  '.repeat(depth + 2);
  const lines = [
    `${prefix}node ${JSON.stringify(node.id)}`,
    `${fieldPrefix}side: ${node.side}`,
    `${fieldPrefix}color: ${node.color}`,
    `${fieldPrefix}folded: ${node.collapsed}`,
    `${fieldPrefix}text: |-`,
    ...node.title.split('\n').map((line) => `${textPrefix}${line}`),
  ];
  for (const child of childrenOf(document, node.id)) lines.push(...serializeNode(document, child, depth + 1));
  return lines;
}

function parseDSL(serialized: string, requiredKind: 'workspace' | 'document'): MindMapWorkspace {
  const normalized = normalizeSerialized(serialized);
  ensureDSLByteLimit(normalized, requiredKind === 'workspace' ? MAX_WORKSPACE_DSL_UTF8_BYTES : MAX_IMPORT_BYTES);
  if (normalized.includes('\t')) throw new Error('tabs are not allowed in Mind Map DSL');
  const lines = normalized.split('\n');
  if (lines.at(-1) === '') lines.pop();
  for (const [index, line] of lines.entries()) {
    const leading = new RegExp('^ *', 'u').exec(line)?.[0].length ?? 0;
    if (leading % 2 !== 0) throw new Error(`invalid indentation at line ${index + 1}`);
  }
  let cursor = 0;
  expect(lines, cursor++, 'mind-map 1');
  expect(lines, cursor++, `kind: ${requiredKind}`);
  let selected = '';
  if (requiredKind === 'workspace') selected = parseJSONStringField(lines[cursor++], 'selected: ');
  expect(lines, cursor++, '');
  const documents: MindMapDocument[] = [];
  while (cursor < lines.length) {
    const mapMatch = new RegExp('^map (.+)$', 'u').exec(lines[cursor++]);
    if (!mapMatch) throw new Error(`expected map at line ${cursor}`);
    const id = parseJSONString(mapMatch[1], 'map id');
    const title = parseJSONStringField(lines[cursor++], '  title: ');
    const layoutLine = lines[cursor++];
    const layout = layoutLine === '  layout: bilateral' ? 'bilateral' : layoutLine === '  layout: right' ? 'right' : undefined;
    if (!layout) throw new Error(`invalid layout at line ${cursor}`);
    const updated_at = parseJSONStringField(lines[cursor++], '  updated-at: ');
    const nodes: MindMapNode[] = [];
    const nodeIDs = new Set<string>();
    const parsed = parseDSLNode(lines, cursor, 1, null, nodes, nodeIDs);
    cursor = parsed.cursor;
    const document: MindMapDocument = { schema_version: 'mind-map.document.v1', id, title, layout, updated_at, nodes };
    validateDocument(document);
    documents.push(document);
    if (cursor === lines.length) break;
    expect(lines, cursor++, '');
  }
  if (requiredKind === 'document' && documents.length !== 1) throw new Error('document DSL must contain exactly one map');
  if (requiredKind === 'workspace' && documents.length < 1) throw new Error('workspace DSL must contain a map');
  const workspace: MindMapWorkspace = {
    schema_version: 'mind-map.workspace.v1',
    selected_document_id: requiredKind === 'workspace' ? selected : documents[0].id,
    documents,
  };
  validateWorkspace(workspace);
  return workspace;
}

function parseDSLNode(
  lines: string[],
  start: number,
  depth: number,
  parentID: string | null,
  output: MindMapNode[],
  ids: Set<string>,
): { cursor: number; node: MindMapNode } {
  let cursor = start;
  const prefix = '  '.repeat(depth);
  const fieldPrefix = '  '.repeat(depth + 1);
  const contentPrefix = '  '.repeat(depth + 2);
  const nodeMatch = new RegExp(`^${prefix}node (.+)$`, 'u').exec(lines[cursor++] ?? '');
  if (!nodeMatch) throw new Error(`invalid node indentation at line ${cursor}`);
  const id = parseJSONString(nodeMatch[1], 'node id');
  if (ids.has(id)) throw new Error(`duplicate node id ${id}`);
  ids.add(id);
  const sideLine = lines[cursor++];
  const side = sideLine === `${fieldPrefix}side: left` ? 'left' : sideLine === `${fieldPrefix}side: right` ? 'right' : undefined;
  if (!side) throw new Error(`invalid node side at line ${cursor}`);
  const colorLine = lines[cursor++];
  const color = colorLine?.startsWith(`${fieldPrefix}color: `) ? colorLine.slice(`${fieldPrefix}color: `.length) as NodeColor : undefined;
  if (!color || !COLORS.includes(color)) throw new Error(`invalid node color at line ${cursor}`);
  const foldedLine = lines[cursor++];
  const collapsed = foldedLine === `${fieldPrefix}folded: true` ? true : foldedLine === `${fieldPrefix}folded: false` ? false : undefined;
  if (collapsed === undefined) throw new Error(`invalid folded value at line ${cursor}`);
  expect(lines, cursor++, `${fieldPrefix}text: |-`);
  const textLines: string[] = [];
  while (cursor < lines.length && lines[cursor].startsWith(contentPrefix)) textLines.push(lines[cursor++].slice(contentPrefix.length));
  if (textLines.length === 0) throw new Error(`node text is missing at line ${cursor + 1}`);
  const node: MindMapNode = { id, parent_id: parentID, order: parentID === null ? 0 : output.filter((candidate) => candidate.parent_id === parentID).length, side, title: textLines.join('\n'), color, collapsed };
  output.push(node);
  while (cursor < lines.length && lines[cursor].startsWith(`${fieldPrefix}node `)) {
    cursor = parseDSLNode(lines, cursor, depth + 1, id, output, ids).cursor;
  }
  return { cursor, node };
}

function parseJSONStringField(line: string | undefined, prefix: string): string {
  if (!line?.startsWith(prefix)) throw new Error(`expected ${prefix.trim()}`);
  return parseJSONString(line.slice(prefix.length), prefix.trim());
}

function parseJSONString(source: string, label: string): string {
  let value: unknown;
  try { value = JSON.parse(source); } catch { throw new Error(`${label} must be a JSON string`); }
  if (typeof value !== 'string') throw new Error(`${label} must be a JSON string`);
  return value;
}

function expect(lines: string[], index: number, expected: string): void {
  if (lines[index] !== expected) throw new Error(`expected ${JSON.stringify(expected)} at line ${index + 1}`);
}

function normalizeSerialized(serialized: string): string {
  return String(serialized).replace(new RegExp('\\r\\n?', 'gu'), '\n');
}

function ensureDSLByteLimit(serialized: string, limit: number): void {
  if (new TextEncoder().encode(serialized).length > limit) throw new Error('DSL exceeds import limit');
}
