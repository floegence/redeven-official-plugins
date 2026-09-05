import type { BranchSide, MindMapDocument, MindMapNode, NodeAlignment } from './workspace-model.js';
import { MIN_ZOOM } from './editor-ui.ts';
import { measureNodeText, type NodeTextMetrics, type TextWidthMeasurer } from './node-text-metrics.ts';

export type LayoutNode = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  side: BranchSide;
  text: NodeTextMetrics;
};

export type LayoutEdge = { from: string; to: string; side: BranchSide };
export type DocumentLayout = { nodes: Map<string, LayoutNode>; edges: LayoutEdge[] };
export type ViewportPadding = { top: number; right: number; bottom: number; left: number };
export type FittedViewport = { x: number; y: number; zoom: number };
export type NodeVisualKind = 'root' | 'branch' | 'topic';
export type EdgeEndpoint = 'source' | 'target';
export type Point = { x: number; y: number };
export type Underline = { startX: number; endX: number; y: number };
export type TextLineAnchor = { x: number; textAlign: NodeAlignment };

const HORIZONTAL_GAP = 88;
const VERTICAL_GAP = 20;
export type EditingTitle = { nodeID: string; title: string };

export function layoutDocument(document: MindMapDocument, editing?: EditingTitle, measure?: TextWidthMeasurer): DocumentLayout {
  const root = document.nodes.find((node) => node.parent_id === null);
  if (!root) return { nodes: new Map(), edges: [] };
  const output: DocumentLayout = { nodes: new Map(), edges: [] };
  output.nodes.set(root.id, boxFor(root, 0, 0, 0, 'right', editing, measure));
  if (root.collapsed) return output;
  const rootChildren = childrenOf(document, root.id);
  const groups: Array<{ side: BranchSide; children: MindMapNode[] }> = document.layout === 'right'
    ? [{ side: 'right', children: rootChildren }]
    : [
      { side: 'left', children: rootChildren.filter((node) => node.side === 'left') },
      { side: 'right', children: rootChildren.filter((node) => node.side === 'right') },
    ];
  for (const group of groups) layoutSide(document, root, output.nodes.get(root.id)!, group.children, group.side, output, editing, measure);
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
  const zoom = Math.max(MIN_ZOOM, Math.min(1, availableWidth / contentWidth, availableHeight / contentHeight));
  const visibleCenterX = padding.left + availableWidth / 2;
  const visibleCenterY = padding.top + availableHeight / 2;
  return {
    x: visibleCenterX - viewportWidth / 2 - ((minX + maxX) / 2) * zoom,
    y: visibleCenterY - viewportHeight / 2 - ((minY + maxY) / 2) * zoom,
    zoom,
  };
}

export function nodeVisualKind(depth: number): NodeVisualKind {
  if (depth === 0) return 'root';
  if (depth === 1) return 'branch';
  return 'topic';
}

export function textLineAnchor(node: Pick<LayoutNode, 'x' | 'width' | 'text'>, alignment: NodeAlignment): TextLineAnchor {
  if (alignment === 'left') return { x: node.x - node.width / 2 + node.text.horizontalPadding, textAlign: 'left' };
  if (alignment === 'right') return { x: node.x + node.width / 2 - node.text.horizontalPadding, textAlign: 'right' };
  return { x: node.x, textAlign: 'center' };
}

export function topicUnderline(node: LayoutNode): Underline {
  const inset = 6;
  return {
    startX: node.x - node.width / 2 + inset,
    endX: node.x + node.width / 2 - inset,
    y: node.y + node.height / 2 - 4,
  };
}

export function edgeAnchor(node: LayoutNode, side: BranchSide, endpoint: EdgeEndpoint): Point {
  const right = side === 'right';
  if (nodeVisualKind(node.depth) === 'topic') {
    const underline = topicUnderline(node);
    const sourceX = right ? underline.endX : underline.startX;
    const targetX = right ? underline.startX : underline.endX;
    return { x: endpoint === 'source' ? sourceX : targetX, y: underline.y };
  }
  const sourceX = node.x + (right ? node.width / 2 : -node.width / 2);
  const targetX = node.x + (right ? -node.width / 2 : node.width / 2);
  return { x: endpoint === 'source' ? sourceX : targetX, y: node.y };
}

export function expanderCenter(node: LayoutNode): Point {
  if (nodeVisualKind(node.depth) === 'topic') {
    return edgeAnchor(node, node.side, 'source');
  }
  return {
    x: node.x + (node.side === 'left' && node.depth > 0 ? -node.width / 2 : node.width / 2),
    y: node.y,
  };
}

function layoutSide(
  document: MindMapDocument,
  root: MindMapNode,
  rootBox: LayoutNode,
  children: MindMapNode[],
  side: BranchSide,
  output: DocumentLayout,
  editing?: EditingTitle,
  measure?: TextWidthMeasurer,
): void {
  if (children.length === 0) return;
  const spans = children.map((child) => subtreeHeight(document, child, editing, measure));
  const total = spans.reduce((sum, value) => sum + value, 0) + VERTICAL_GAP * Math.max(0, children.length - 1);
  let cursor = -total / 2;
  children.forEach((child, index) => {
    const span = spans[index];
    placeSubtree(document, child, 1, cursor + span / 2, side, rootBox, output, editing, measure);
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
  parentBox: LayoutNode,
  output: DocumentLayout,
  editing?: EditingTitle,
  measure?: TextWidthMeasurer,
): void {
  const text = measureNodeText(editing?.nodeID === node.id ? editing.title : node.title, depth, measure);
  const direction = side === 'right' ? 1 : -1;
  const x = parentBox.x + direction * (parentBox.width / 2 + HORIZONTAL_GAP + text.width / 2);
  const box = { id: node.id, x, y: centerY, width: text.width, height: text.height, depth, side, text };
  output.nodes.set(node.id, box);
  if (node.collapsed) return;
  const children = childrenOf(document, node.id);
  if (children.length === 0) return;
  const spans = children.map((child) => subtreeHeight(document, child, editing, measure));
  const total = spans.reduce((sum, value) => sum + value, 0) + VERTICAL_GAP * Math.max(0, children.length - 1);
  let cursor = centerY - total / 2;
  children.forEach((child, index) => {
    const span = spans[index];
    placeSubtree(document, child, depth + 1, cursor + span / 2, side, box, output, editing, measure);
    output.edges.push({ from: node.id, to: child.id, side });
    cursor += span + VERTICAL_GAP;
  });
}

function subtreeHeight(document: MindMapDocument, node: MindMapNode, editing?: EditingTitle, measure?: TextWidthMeasurer): number {
  const depth = nodeDepth(document, node.id);
  const height = measureNodeText(editing?.nodeID === node.id ? editing.title : node.title, depth, measure).height;
  if (node.collapsed) return height;
  const children = childrenOf(document, node.id);
  if (children.length === 0) return height;
  return Math.max(
    height,
    children.reduce((sum, child) => sum + subtreeHeight(document, child, editing, measure), 0) + VERTICAL_GAP * (children.length - 1),
  );
}

function childrenOf(document: MindMapDocument, parentID: string): MindMapNode[] {
  return document.nodes.filter((node) => node.parent_id === parentID).sort((a, b) => a.order - b.order);
}

function boxFor(node: MindMapNode, x: number, y: number, depth: number, side: BranchSide, editing?: EditingTitle, measure?: TextWidthMeasurer): LayoutNode {
  const text = measureNodeText(editing?.nodeID === node.id ? editing.title : node.title, depth, measure);
  return { id: node.id, x, y, width: text.width, height: text.height, depth, side, text };
}

function nodeDepth(document: MindMapDocument, nodeID: string): number {
  let depth = 0;
  let node = document.nodes.find((candidate) => candidate.id === nodeID);
  while (node && node.parent_id !== null) {
    depth += 1;
    const parentID: string = node.parent_id;
    node = document.nodes.find((candidate) => candidate.id === parentID);
  }
  return depth;
}
