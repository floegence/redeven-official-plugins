import { edgeAnchor, expanderCenter, textLineAnchor, topicUnderline, type DocumentLayout } from './layout.ts';
import type { MindMapDocument, MindMapNode, NodeColor } from './workspace-model.ts';

export const EXPORT_FORMATS = ['png', 'jpeg', 'webp', 'svg', 'dsl'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export type ExportAppearance = {
  canvas: string;
  surface: string;
  surface_elevated: string;
  text: string;
  text_muted: string;
  border: string;
  accent: string;
  accent_text: string;
  success: string;
  warning: string;
  danger: string;
  focus: string;
};

export type ExportLayoutBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

export type BitmapExportSize = {
  width: number;
  height: number;
  scale: number;
};

const EXPORT_PADDING = 64;
const MAX_BITMAP_DIMENSION = 4096;
const MAX_BITMAP_PIXELS = 12_000_000;

export function safeExportBaseName(title: string): string {
  let baseName = '';
  let pendingSeparator = false;
  for (const character of title.normalize('NFKC')) {
    const codePoint = character.codePointAt(0) ?? 0;
    const unsafe = codePoint <= 0x1f || '<>:"/\\|?*'.includes(character);
    if (unsafe || character.trim().length === 0) {
      pendingSeparator = baseName.length > 0;
      continue;
    }
    if (pendingSeparator && baseName.length < 80 && !baseName.endsWith('-')) baseName += '-';
    pendingSeparator = false;
    if (baseName.length + character.length > 80) break;
    baseName += character;
  }

  let start = 0;
  let end = baseName.length;
  while (start < end && (baseName[start] === '-' || baseName[start] === '.')) start += 1;
  while (end > start && (baseName[end - 1] === '-' || baseName[end - 1] === '.')) end -= 1;
  return baseName.slice(start, end) || 'mind-map';
}

export function exportLayoutBounds(layout: DocumentLayout, padding = EXPORT_PADDING): ExportLayoutBounds {
  const nodes = [...layout.nodes.values()];
  if (nodes.length === 0) {
    return { left: -padding, top: -padding, right: padding, bottom: padding, width: padding * 2, height: padding * 2 };
  }
  const left = Math.min(...nodes.map((node) => node.x - node.width / 2)) - padding;
  const top = Math.min(...nodes.map((node) => node.y - node.height / 2)) - padding;
  const right = Math.max(...nodes.map((node) => node.x + node.width / 2)) + padding;
  const bottom = Math.max(...nodes.map((node) => node.y + node.height / 2)) + padding;
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

export function bitmapExportSize(bounds: ExportLayoutBounds): BitmapExportSize {
  const naturalScale = 2;
  const scale = Math.min(
    naturalScale,
    MAX_BITMAP_DIMENSION / Math.max(1, bounds.width),
    MAX_BITMAP_DIMENSION / Math.max(1, bounds.height),
    Math.sqrt(MAX_BITMAP_PIXELS / Math.max(1, bounds.width * bounds.height)),
  );
  return {
    width: Math.max(1, Math.ceil(bounds.width * scale)),
    height: Math.max(1, Math.ceil(bounds.height * scale)),
    scale,
  };
}

export function nodeColorValue(color: NodeColor, appearance: ExportAppearance): string {
  if (color === 'accent') return appearance.accent;
  if (color === 'blue') return '#5f86ee';
  if (color === 'green') return '#43b990';
  if (color === 'amber') return '#e6a23c';
  if (color === 'rose') return '#e9687d';
  return '#8d6de8';
}

export function serializeMindMapSVG(
  document: MindMapDocument,
  layout: DocumentLayout,
  appearance: ExportAppearance,
): string {
  const bounds = exportLayoutBounds(layout);
  const width = rounded(bounds.width);
  const height = rounded(bounds.height);
  const translateX = rounded(-bounds.left);
  const translateY = rounded(-bounds.top);
  const nodesByID = new Map(document.nodes.map((node) => [node.id, node]));
  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">`,
    `<title>${escapeXML(document.title)}</title>`,
    `<rect width="${width}" height="${height}" fill="${escapeXML(appearance.canvas)}"/>`,
    `<g transform="translate(${translateX} ${translateY})">`,
  ];

  for (const edge of layout.edges) {
    const from = layout.nodes.get(edge.from);
    const to = layout.nodes.get(edge.to);
    const toNode = nodesByID.get(edge.to);
    if (!from || !to || !toNode) continue;
    const start = edgeAnchor(from, edge.side, 'source');
    const end = edgeAnchor(to, edge.side, 'target');
    const bend = Math.abs(end.x - start.x) * 0.48;
    const direction = edge.side === 'right' ? 1 : -1;
    const stroke = nodeColorValue(toNode.color, appearance);
    parts.push(
      `<path d="M ${rounded(start.x)} ${rounded(start.y)} C ${rounded(start.x + direction * bend)} ${rounded(start.y)} ${rounded(end.x - direction * bend)} ${rounded(end.y)} ${rounded(end.x)} ${rounded(end.y)}" fill="none" stroke="${escapeXML(stroke)}" stroke-opacity="0.78" stroke-width="${to.depth === 1 ? '2.6' : to.depth === 2 ? '1.8' : '1.45'}" stroke-linecap="round"/>`,
    );
  }

  for (const box of layout.nodes.values()) {
    const node = nodesByID.get(box.id);
    if (!node) continue;
    const accent = nodeColorValue(node.color, appearance);
    parts.push(`<g data-node-id="${escapeXML(node.id)}">`);
    if (box.depth === 0) {
      parts.push(`<rect x="${rounded(box.x - box.width / 2)}" y="${rounded(box.y - box.height / 2)}" width="${rounded(box.width)}" height="${rounded(box.height)}" rx="14" fill="${escapeXML(accent)}"/>`);
    } else if (box.depth === 1) {
      parts.push(`<rect x="${rounded(box.x - box.width / 2)}" y="${rounded(box.y - box.height / 2)}" width="${rounded(box.width)}" height="${rounded(box.height)}" rx="11" fill="${escapeXML(appearance.surface_elevated)}" stroke="${escapeXML(accent)}" stroke-opacity="0.32"/>`);
    } else {
      const underline = topicUnderline(box);
      parts.push(`<line x1="${rounded(underline.startX)}" y1="${rounded(underline.y)}" x2="${rounded(underline.endX)}" y2="${rounded(underline.y)}" stroke="${escapeXML(accent)}" stroke-opacity="0.82" stroke-width="${box.depth === 2 ? '2' : '1.6'}" stroke-linecap="round"/>`);
    }
    parts.push(serializeNodeText(node, box, accent, appearance));
    if (document.nodes.some((candidate) => candidate.parent_id === node.id)) {
      const badge = expanderCenter(box);
      parts.push(`<circle cx="${rounded(badge.x)}" cy="${rounded(badge.y)}" r="7.5" fill="${escapeXML(appearance.surface)}" stroke="${escapeXML(accent)}" stroke-opacity="0.68" stroke-width="1.25"/>`);
      parts.push(`<text x="${rounded(badge.x)}" y="${rounded(badge.y + 3.5)}" text-anchor="middle" fill="${escapeXML(accent)}" font-family="system-ui, sans-serif" font-size="10" font-weight="700">${node.collapsed ? '+' : '&#8722;'}</text>`);
    }
    parts.push('</g>');
  }

  parts.push('</g>', '</svg>');
  return parts.join('');
}

function serializeNodeText(
  node: MindMapNode,
  box: DocumentLayout['nodes'] extends Map<string, infer Node> ? Node : never,
  accent: string,
  appearance: ExportAppearance,
): string {
  const anchor = textLineAnchor(box, node.alignment);
  const textAnchor = anchor.textAlign === 'left' ? 'start' : anchor.textAlign === 'right' ? 'end' : 'middle';
  const fill = box.depth === 0 ? contrastText(accent) : box.depth === 1 ? appearance.text : accent;
  const fontSize = box.depth === 0 ? 15.5 : box.depth === 1 ? 13.5 : 12.5;
  const firstLineY = box.y + (box.depth >= 2 ? -2 : 0) - ((box.text.lines.length - 1) * box.text.lineHeight) / 2;
  const weight = box.depth === 0 ? 720 : box.depth === 1 ? 660 : 590;
  const lines = box.text.lines.map((line, index) => (
    `<tspan x="${rounded(anchor.x)}" y="${rounded(firstLineY + index * box.text.lineHeight + fontSize * 0.34)}">${escapeXML(line)}</tspan>`
  )).join('');
  return `<text x="${rounded(anchor.x)}" text-anchor="${textAnchor}" fill="${escapeXML(fill)}" font-family="system-ui, sans-serif" font-size="${fontSize}" font-weight="${weight}">${lines}</text>`;
}

function contrastText(color: string): string {
  const value = parseHexColor(color);
  if (value === undefined) return '#ffffff';
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return red * 0.299 + green * 0.587 + blue * 0.114 > 166 ? '#18202a' : '#ffffff';
}

function parseHexColor(value: string): number | undefined {
  const normalized = value.trim();
  if (normalized.length !== 7 || normalized[0] !== '#') return undefined;
  const digits = normalized.slice(1);
  for (const character of digits.toLowerCase()) {
    if (!'0123456789abcdef'.includes(character)) return undefined;
  }
  return Number.parseInt(digits, 16);
}

function escapeXML(value: string): string {
  let escaped = '';
  for (const character of value) {
    if (character === '&') escaped += '&amp;';
    else if (character === '<') escaped += '&lt;';
    else if (character === '>') escaped += '&gt;';
    else if (character === '"') escaped += '&quot;';
    else if (character === "'") escaped += '&apos;';
    else escaped += character;
  }
  return escaped;
}

function rounded(value: number): string {
  return String(Math.round(value * 100) / 100);
}
