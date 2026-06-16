const DAY_MS = 24 * 60 * 60 * 1000;

export function computeExpiresAt(ttlDays: number, from: Date = new Date()): Date | null {
  if (!Number.isFinite(ttlDays) || ttlDays <= 0) return null;
  return new Date(from.getTime() + ttlDays * DAY_MS);
}
