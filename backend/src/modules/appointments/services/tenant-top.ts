/**
 * SBA α-8 wave 3 — нормализация tenantId для appointment/kpi-метрик (`tenant_top`).
 *
 * Cardinality-safe: используем стабильный hash-bucket (mod 100) → t0..t99 +
 * 'other' fallback на ошибки. ≤ 101 series per metric, не зависит от
 * фактического числа Org.
 *
 * Аналог `backend/src/modules/processes/services/tenant-top.ts` и
 * `backend/src/modules/company-foundation/utils/tenant-top.ts` — дублируем
 * локально, чтобы избежать кросс-модульной зависимости.
 */
import { createHash } from 'node:crypto';

const BUCKET_COUNT = 100;

export function resolveAppointmentTenantTop(tenantId: string): string {
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

/**
 * SBA α-8 wave 3 — авто-резолв статуса Appointment'а по валидному интервалу.
 *
 *   - validTo IS NULL                       → 'active'
 *   - validTo IS NOT NULL AND validTo<now() → 'former'
 *   - validTo > now()                       → 'active' (запланированное завершение).
 *
 * `acting` (исполняющий обязанности) — не автоматический; admin выставляет
 * руками для интерим-назначений. См. ТЗ §3.
 */
export function resolveAppointmentStatus(
  validTo: Date | null,
  now: number = Date.now(),
): 'active' | 'former' {
  if (!validTo) return 'active';
  return validTo.getTime() < now ? 'former' : 'active';
}
