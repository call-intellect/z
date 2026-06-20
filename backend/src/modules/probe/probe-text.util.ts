export function passesMarkerCheck(q: string): boolean {
  const text = (q ?? '').trim();
  if (text.length === 0) return false;
  if (text.length > 400) return false;
  const questionMarks = (text.match(/\?/g) ?? []).length;
  if (questionMarks !== 1) return false;
  if (/[A-Za-z]{4,}/.test(text)) return false;
  if (/[A-Za-z0-9]{16,}/.test(text)) return false;
  return true;
}

export function humanizeProbeFallback(message: string): string {
  const cleaned = message
    .replace(/\b[a-z0-9]{20,}\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:!?»])/g, '$1')
    .trim();
  return cleaned.length > 0 ? cleaned.slice(0, 200) : 'Можете уточнить, пожалуйста?';
}

function strOrUndef(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export function deriveDigestQuestion(
  reason: string,
  payload: Record<string, unknown>,
  fallbackByReason: Record<string, string>,
  fallbackDefault: string,
): string {
  const formulated = strOrUndef(payload.formulatedQuestion);
  const suggested = strOrUndef(payload.suggestedQuestion);
  const message = strOrUndef(payload.message);
  return (
    formulated ??
    suggested ??
    (message ? humanizeProbeFallback(message) : undefined) ??
    fallbackByReason[reason] ??
    fallbackDefault
  );
}
