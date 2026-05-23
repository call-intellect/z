/**
 * SBA α-7 wave 2 — нормализация tenantId для метрик `tenant_top`.
 *
 * Cardinality-safe: top-100 tenant'ов выходят как есть, остальные сворачиваются
 * в 'other'. Для wave 2 (без in-memory cache top-100) используем простой хеш-
 * детерминированный bucket: hash mod 100. Это даёт стабильное распределение
 * меньше 101 series (100 buckets + 'other' fallback при ошибке).
 *
 * NB: реальное «top-100 by activity» хранится в Redis sorted-set + cron, см.
 * `backend/src/modules/probe/probe-response.handler.ts:resolveTenantTop`.
 * На α-7 wave 2 мы используем стабильный hash-bucket — этого достаточно
 * для контроля cardinality (gauge не должен взрываться).
 */
import { createHash } from 'node:crypto';

const BUCKET_COUNT = 100;

export function resolveProcessTenantTop(tenantId: string): string {
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
