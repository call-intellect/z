import { createHash } from 'node:crypto';

/**
 * Admin-redesign Фаза 8 — helpers для `FeatureFlagsService`.
 *
 * Чистые функции hash/resolve вынесены отдельно, чтобы их можно было
 * тестировать без подъёма Nest-контекста.
 */

/**
 * Детерминированный hash для распределения тенантов по rollout. SHA-256 от
 * `key:tenantId`, берём первые 4 байта и приводим к uint32 — этого с лихвой
 * хватает для деления на 100. Используем именно SHA-256 (а не md5/cyrb53),
 * чтобы быть устойчивым к коллизиям на больших количествах ключей и
 * совместимым с node-стандартной криптой.
 */
export function computeRolloutHash(key: string, tenantId: string): number {
  const digest = createHash('sha256').update(`${key}:${tenantId}`).digest();
  // Первые 4 байта → uint32 (big-endian).
  return (
    ((digest[0]! << 24) >>> 0) +
    ((digest[1]! << 16) >>> 0) +
    ((digest[2]! << 8) >>> 0) +
    digest[3]!
  ) >>> 0;
}

export interface ResolvableFlag {
  key: string;
  defaultValue: boolean;
  orgOverrides: Record<string, boolean>;
  rolloutPercent: number | null;
}

/**
 * Resolution logic:
 *   1) если tenantId есть в orgOverrides — отдаём это значение;
 *   2) если задан rolloutPercent — hash(key + ':' + tenantId) % 100 < pct;
 *   3) иначе — defaultValue.
 *
 * rolloutPercent трактуется как «процент включения»:
 *   - null     → не применяется (идём в defaultValue);
 *   - 0        → выключено для всех (даже если defaultValue=true);
 *   - 100      → включено для всех (даже если defaultValue=false);
 *   - 1..99    → распределение по hash.
 */
export function resolveFlag(
  flag: ResolvableFlag,
  tenantId: string,
): boolean {
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

/**
 * Привести произвольный JSON-объект к `Record<string, boolean>` — нужно для
 * `orgOverrides` из Prisma.JsonValue. Невалидные значения отбрасываем.
 */
export function normalizeOrgOverrides(
  raw: unknown,
): Record<string, boolean> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}
