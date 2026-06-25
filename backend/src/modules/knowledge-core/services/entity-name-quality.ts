export type EntityNameRejectReason =
  | 'task_id'
  | 'phone'
  | 'email'
  | 'too_short'
  | 'numeric_only';

const TASK_ID_RE = /\b[A-ZА-ЯЁ]{2,6}-\d+\b/;
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE_RE = /(?:\+?\d[\s\-()]?){7,}/;
const CYR_LAT_RE = /[A-Za-zА-Яа-яЁё]/;

export function classifyEntityName(rawName: string): {
  ok: boolean;
  reason: EntityNameRejectReason | null;
} {
  const name = (rawName ?? '').trim();
  if (TASK_ID_RE.test(name)) return { ok: false, reason: 'task_id' };
  if (EMAIL_RE.test(name)) return { ok: false, reason: 'email' };
  if (PHONE_RE.test(name)) return { ok: false, reason: 'phone' };
  const letters = name.match(CYR_LAT_RE)
    ? name.replace(/[^A-Za-zА-Яа-яЁё]/g, '')
    : '';
  if (letters.length < 2) return { ok: false, reason: 'numeric_only' };
  if (name.length < 2) return { ok: false, reason: 'too_short' };
  return { ok: true, reason: null };
}

export function isJunkEntityName(rawName: string): boolean {
  return !classifyEntityName(rawName).ok;
}
