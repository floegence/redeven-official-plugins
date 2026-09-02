import type { BranchSide, MindMapDocument, MindMapNode } from './workspace-model.js';

export type LayoutNode = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  side: BranchSide;
};

export type LayoutEdge = { from: string; to: string; side: BranchSide };
export type DocumentLayout = { nodes: Map<string, LayoutNode>; edges: LayoutEdge[] };
export type ViewportPadding = { top: number; right: number; bottom: number; left: number };
export type FittedViewport = { x: number; y: number; zoom: number };

const HORIZONTAL_GAP = 88;
const VERTICAL_GAP = 18;
const NODE_HEIGHT = 46;

export function layoutDocument(document: MindMapDocument): DocumentLayout {
  const root = document.nodes.find((node) => node.parent_id === null);
  if (!root) return { nodes: new Map(), edges: [] };
  const output: DocumentLayout = { nodes: new Map(), edges: [] };
  output.nodes.set(root.id, boxFor(root, 0, 0, 0, 'right', true));
  const rootChildren = childrenOf(document, root.id);
  const groups: Array<{ side: BranchSide; children: MindMapNode[] }> = document.layout === 'right'
    ? [{ side: 'right', children: rootChildren }]
    : [
      { side: 'left', children: rootChildren.filter((node) => node.side === 'left') },
      { side: 'right', children: rootChildren.filter((node) => node.side === 'right') },
    ];
  for (const group of groups) layoutSide(document, root, group.children, group.side, output);
  return output;
}

export function fitLayoutToViewport(
  layout: DocumentLayout,
  viewportWidth: number,
  viewportHeight: number,
  padding: ViewportPadding,
): FittedViewport {
  const nodes = [...layout.nodes.values()];
  if (nodes.length === 0) return { x: 0, y: 0, zoom: 1 };
  const minX = Math.min(...nodes.map((node) => node.x - node.width / 2));
  const maxX = Math.max(...nodes.map((node) => node.x + node.width / 2));
  const minY = Math.min(...nodes.map((node) => node.y - node.height / 2));
  const maxY = Math.max(...nodes.map((node) => node.y + node.height / 2));
  const availableWidth = Math.max(1, viewportWidth - padding.left - padding.right);
  const availableHeight = Math.max(1, viewportHeight - padding.top - padding.bottom);
  const contentWidth = Math.max(1, maxX - minX);
  const contentHeight = Math.max(1, maxY - minY);
  const zoom = Math.max(0.42, Math.min(1, availableWidth / contentWidth, availableHeight / contentHeight));
  const visibleCenterX = padding.left + availableWidth / 2;
  const visibleCenterY = padding.top + availableHeight / 2;
  return {
    x: visibleCenterX - viewportWidth / 2 - ((minX + maxX) / 2) * zoom,
    y: visibleCenterY - viewportHeight / 2 - ((minY + maxY) / 2) * zoom,
    zoom,
  };
}

function layoutSide(
  document: MindMapDocument,
  root: MindMapNode,
  children: MindMapNode[],
  side: BranchSide,
  output: DocumentLayout,
): void {
  if (children.length === 0) return;
  const spans = children.map((child) => subtreeHeight(document, child));
  const total = spans.reduce((sum, value) => sum + value, 0) + VERTICAL_GAP * Math.max(0, children.length - 1);
  let cursor = -total / 2;
  children.forEach((child, index) => {
    const span = spans[index];
    placeSubtree(document, child, 1, cursor + span / 2, side, output);
    output.edges.push({ from: root.id, to: child.id, side });
    cursor += span + VERTICAL_GAP;
  });
}

function placeSubtree(
  document: MindMapDocument,
  node: MindMapNode,
  depth: number,
  centerY: number,
  side: BranchSide,
  output: DocumentLayout,
): void {
  const width = nodeWidth(node.title, depth === 0);
  const x = (side === 'right' ? 1 : -1) * (depth * (188 + HORIZONTAL_GAP));
  output.nodes.set(node.id, { id: node.id, x, y: centerY, width, height: NODE_HEIGHT, depth, side });
  if (node.collapsed) return;
  const children = childrenOf(document, node.id);
  if (children.length === 0) return;
  const spans = children.map((child) => subtreeHeight(document, child));
  const total = spans.reduce((sum, value) => sum + value, 0) + VERTICAL_GAP * Math.max(0, children.length - 1);
  let cursor = centerY - total / 2;
  children.forEach((child, index) => {
    const span = spans[index];
    placeSubtree(document, child, depth + 1, cursor + span / 2, side, output);
    output.edges.push({ from: node.id, to: child.id, side });
    cursor += span + VERTICAL_GAP;
  });
}

function subtreeHeight(document: MindMapDocument, node: MindMapNode): number {
  if (node.collapsed) return NODE_HEIGHT;
  const children = childrenOf(document, node.id);
  if (children.length === 0) return NODE_HEIGHT;
  return Math.max(
    NODE_HEIGHT,
    children.reduce((sum, child) => sum + subtreeHeight(document, child), 0) + VERTICAL_GAP * (children.length - 1),
  );
}

function childrenOf(document: MindMapDocument, parentID: string): MindMapNode[] {
  return document.nodes.filter((node) => node.parent_id === parentID).sort((a, b) => a.order - b.order);
}

function boxFor(node: MindMapNode, x: number, y: number, depth: number, side: BranchSide, root = false): LayoutNode {
  return { id: node.id, x, y, width: nodeWidth(node.title, root), height: root ? 54 : NODE_HEIGHT, depth, side };
}

function nodeWidth(title: string, root: boolean): number {
  const estimated = [...title].reduce((width, char) => width + ((char.codePointAt(0) ?? 0) <= 0x7f ? 7.5 : 14), 38);
  return Math.min(root ? 236 : 216, Math.max(root ? 160 : 132, estimated));
}
