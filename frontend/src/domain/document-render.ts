export interface QuoteRange {
  start: number;
  end: number;
}

export interface RenderSegment {
  text: string;
  isQuote: boolean;
  pageBreakBefore: number | null;
}

export function buildRenderSegments(
  text: string,
  pageOffsets: number[],
  quoteRange: QuoteRange | null,
): RenderSegment[] {
  const length = text.length;

  const pageStartToNumber = new Map<number, number>();
  for (let k = 1; k < pageOffsets.length; k += 1) {
    const offset = pageOffsets[k]!;
    if (offset > 0 && offset < length) {
      pageStartToNumber.set(offset, k + 1);
    }
  }

  const cutSet = new Set<number>([0, length]);
  for (const offset of pageStartToNumber.keys()) cutSet.add(offset);
  if (quoteRange) {
    if (quoteRange.start >= 0 && quoteRange.start <= length) {
      cutSet.add(quoteRange.start);
    }
    if (quoteRange.end >= 0 && quoteRange.end <= length) {
      cutSet.add(quoteRange.end);
    }
  }

  const cuts = Array.from(cutSet)
    .filter((c) => c >= 0 && c <= length)
    .sort((a, b) => a - b);

  const segments: RenderSegment[] = [];
  for (let i = 0; i < cuts.length - 1; i += 1) {
    const start = cuts[i]!;
    const end = cuts[i + 1]!;
    if (start === end) continue;
    const isQuote =
      quoteRange !== null &&
      start >= quoteRange.start &&
      end <= quoteRange.end &&
      quoteRange.end > quoteRange.start;
    segments.push({
      text: text.slice(start, end),
      isQuote,
      pageBreakBefore: pageStartToNumber.get(start) ?? null,
    });
  }

  if (segments.length === 0 && length === 0) {
    segments.push({ text: "", isQuote: false, pageBreakBefore: null });
  }

  return segments;
}
