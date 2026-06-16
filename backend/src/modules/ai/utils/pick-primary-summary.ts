export function pickPrimarySummary(r: {
  summaryFast?: string | null;
  summary?: string | null;
}): string {
  return r.summaryFast?.trim() || r.summary?.trim() || '';
}
