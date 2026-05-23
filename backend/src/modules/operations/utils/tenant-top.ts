/**
 * SBA β-8 — нормализация tenantId для метрик (`tenant_top`).
 *
 * Cardinality-safe: используем стабильный hash-bucket (mod 100) → t0..t99 +
 * 'other' fallback на ошибки. ≤ 101 series per metric, не зависит
 * от реального количества Org.
 *
 * Дублируем локально (аналог `knowledge-core/services/tenant-top.ts`), чтобы
 * operations не импортировал knowledge-core (циклическая зависимость).
 */
import { createHash } from 'node:crypto';

const BUCKET_COUNT = 100;

export function resolveOperationsTenantTop(tenantId: string): string {
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
