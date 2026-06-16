import { createHash } from 'node:crypto';

export function computeRolloutHash(key: string, tenantId: string): number {
  const digest = createHash('sha256').update(`${key}:${tenantId}`).digest();
  return (
    (((digest[0]! << 24) >>> 0) +
      ((digest[1]! << 16) >>> 0) +
      ((digest[2]! << 8) >>> 0) +
      digest[3]!) >>>
    0
  );
}

export interface ResolvableFlag {
  key: string;
  defaultValue: boolean;
  orgOverrides: Record<string, boolean>;
  rolloutPercent: number | null;
}

export function resolveFlag(flag: ResolvableFlag, tenantId: string): boolean {
  if (Object.prototype.hasOwnProperty.call(flag.orgOverrides, tenantId)) {
    return flag.orgOverrides[tenantId] === true;
  }
  if (flag.rolloutPercent !== null && flag.rolloutPercent !== undefined) {
    const pct = Math.max(0, Math.min(100, flag.rolloutPercent));
    if (pct === 0) return false;
    if (pct === 100) return true;
    const hash = computeRolloutHash(flag.key, tenantId);
    return hash % 100 < pct;
  }
  return flag.defaultValue;
}

export function normalizeOrgOverrides(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}
