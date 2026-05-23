/**
 * SBA β-7 — нормализация tenantId для метрик `tenant_top` BrandVoice.
 *
 * Cardinality-safe: top-100 buckets (hash mod 100) + 'other' fallback при
 * ошибке. Это даёт стабильное распределение ≤ 101 series, что безопасно
 * даже на масштабе тысяч Org. Реальное «top-100 by activity» в проде —
 * через Redis sorted-set, но для daily-cron'а hash-bucket'а достаточно
 * (он стабилен между прогонами, не «прыгает»).
 */
import { createHash } from 'node:crypto';

const BUCKET_COUNT = 100;

export function brandVoiceTenantTop(tenantId: string): string {
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
