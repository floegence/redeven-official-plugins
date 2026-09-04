export type TextWidthMeasurer = (value: string, font: string) => number;

export type NodeTextMetrics = {
  lines: string[];
  contentWidth: number;
  width: number;
  height: number;
  lineHeight: number;
  horizontalPadding: number;
  verticalPadding: number;
  font: string;
  truncated: false;
};

export const MAX_NODE_CONTENT_WIDTH = 280;

const STYLES = [
  { font: '720 15.5px system-ui, sans-serif', minWidth: 160, lineHeight: 21, horizontalPadding: 20, verticalPadding: 16 },
  { font: '660 13.5px system-ui, sans-serif', minWidth: 136, lineHeight: 19, horizontalPadding: 18, verticalPadding: 14 },
  { font: '590 12.5px system-ui, sans-serif', minWidth: 112, lineHeight: 18, horizontalPadding: 12, verticalPadding: 12 },
] as const;

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const wordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' });

export function measureNodeText(
  value: string,
  depth: number,
  measure: TextWidthMeasurer = approximateTextWidth,
  maximumContentWidth = MAX_NODE_CONTENT_WIDTH,
): NodeTextMetrics {
  const style = STYLES[Math.min(Math.max(0, depth), STYLES.length - 1)];
  const contentLimit = Math.max(1, Math.min(MAX_NODE_CONTENT_WIDTH, maximumContentWidth));
  const lines = String(value).replace(new RegExp('\\r\\n?', 'gu'), '\n').split('\n').flatMap((line) => wrapExplicitLine(line, style.font, contentLimit, measure));
  const contentWidth = Math.min(contentLimit, Math.max(0, ...lines.map((line) => measure(line, style.font))));
  return {
    lines,
    contentWidth,
    width: Math.max(style.minWidth, Math.ceil(contentWidth + style.horizontalPadding * 2)),
    height: Math.ceil(lines.length * style.lineHeight + style.verticalPadding * 2),
    lineHeight: style.lineHeight,
    horizontalPadding: style.horizontalPadding,
    verticalPadding: style.verticalPadding,
    font: style.font,
    truncated: false,
  };
}

function wrapExplicitLine(line: string, font: string, limit: number, measure: TextWidthMeasurer): string[] {
  if (line.length === 0) return [''];
  if (measure(line, font) <= limit) return [line];
  const words = [...wordSegmenter.segment(line)].map(({ segment }) => segment);
  const output: string[] = [];
  let current = '';
  for (const word of words) {
    if (measure(`${current}${word}`, font) <= limit) {
      current += word;
      continue;
    }
    if (current.length > 0) output.push(current);
    current = word;
    if (measure(current, font) <= limit) continue;
    const graphemes = [...graphemeSegmenter.segment(current)].map(({ segment }) => segment);
    current = '';
    for (const grapheme of graphemes) {
      if (current.length > 0 && measure(`${current}${grapheme}`, font) > limit) {
        output.push(current);
        current = grapheme;
      } else {
        current += grapheme;
      }
    }
  }
  if (current.length > 0 || output.length === 0) output.push(current);
  return output;
}

function approximateTextWidth(value: string): number {
  return [...graphemeSegmenter.segment(value)].reduce((width, { segment }) => width + (new RegExp('^[\\x00-\\x7f]+$', 'u').test(segment) ? 7.5 : 14), 0);
}
