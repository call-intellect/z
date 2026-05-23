import { createHash } from 'node:crypto';

/**
 * SBA α-8 wave 4 — нормализация tenantId для role-map метрик (`tenant_top`).
 *
 * Cardinality-safe: используем стабильный hash-bucket (mod 100) → t0..t99 +
 * 'other' fallback на ошибки. ≤ 101 series per metric, не зависит от
 * фактического числа Org.
 *
 * Аналог `backend/src/modules/appointments/services/tenant-top.ts` и
 * `backend/src/modules/company-foundation/utils/tenant-top.ts` — дублируем
 * локально, чтобы избежать кросс-модульной зависимости.
 */
const BUCKET_COUNT = 100;

export function resolveRoleMapTenantTop(tenantId: string): string {
  if (!tenantId) return 'other';
  try {
    const hash = createHash('sha1').update(tenantId).digest();
    const slice = hash.readUInt32BE(0);
    const bucket = slice % BUCKET_COUNT;
    return `t${bucket}`;
  } catch {
    return 'other';
  }
}
