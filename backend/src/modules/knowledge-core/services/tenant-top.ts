/**
 * SBA α-3 wave 3 — нормализация tenantId для axis-метрик (`tenant_top`).
 *
 * Cardinality-safe: используем стабильный hash-bucket (mod 100) → t0..t99 +
 * 'other' fallback на ошибки. Это даёт ≤ 101 series per metric, не зависит
 * от реального количества Org.
 *
 * NB: аналог `backend/src/modules/processes/services/tenant-top.ts`. Дублируем
 * локально, чтобы knowledge-core не импортировал processes (циклическая
 * зависимость), и чтобы паттерн оставался прозрачным.
 */
import { createHash } from 'node:crypto';

const BUCKET_COUNT = 100;

export function resolveAxisTenantTop(tenantId: string): string {
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
