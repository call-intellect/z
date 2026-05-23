/**
 * SBA α-5 dialog-layer — нормализация tenantId для Prometheus-метрик.
 *
 * Cardinality-safe: top-100 tenant'ов сохраняем как есть (через стабильный
 * хеш-bucket); остальные сворачиваются в 'other'. Это даёт `series ≤ 101`.
 *
 * Для α-5 используем простой подход: stable bucket по hash(tenantId) % 100.
 * Не perfect top-100 (нет учёта реальной активности), но даёт постоянное
 * cardinality и стабильное распределение. Реальный top-100 — vNext через
 * сборщик с in-memory sliding window.
 */

const TOP_BUCKETS = 100;

/**
 * Стабильный bucket-id (`t000`..`t099` или 'other'). На α-5 — простая
 * fnv1a-хеш + modulo. После γ — заменим на честный top-100 sliding window.
 *
 * Caller должен передавать НОРМАЛИЗОВАННЫЙ tenantId (не null/undefined);
 * для null tenantId — `'system'`.
 */
export function tenantTopOf(tenantId: string | null | undefined): string {
  if (!tenantId) return 'system';
  const h = fnv1a(tenantId);
  const bucket = h % TOP_BUCKETS;
  return `t${String(bucket).padStart(3, '0')}`;
}

function fnv1a(s: string): number {
  let h = 0x811c_9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    // 32-bit FNV-1a (mul + mod 2^32).
    h = Math.imul(h, 0x0100_0193);
    h >>>= 0;
  }
  return h >>> 0;
}
