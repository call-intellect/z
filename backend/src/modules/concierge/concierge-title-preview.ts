const TITLE_PREVIEW_MAX_LEN = 80;

export function conciergeTitlePreview(text: string | null): string | null {
  if (text === null) return null;
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed === '') return null;
  if (collapsed.length <= TITLE_PREVIEW_MAX_LEN) return collapsed;
  return `${collapsed.slice(0, TITLE_PREVIEW_MAX_LEN)}…`;
}
