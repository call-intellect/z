/**
 * TZ-1 Фаза 4.C (daily-value-engine) — чистая логика синтеза знание-под-риском
 * × уход человека.
 *
 * Без зависимостей от Prisma/NestJS — unit-тестируется без БД.
 */

export type SeverityLevel = 'critical' | 'warning' | 'ok';
export type PersonRiskLevel = 'high' | 'medium' | 'low';

/**
 * Совмещённая серьёзность «знание-под-риском». Чистая функция.
 *
 * Идея: критично, когда зона знаний держится на одном человеке (bus-factor
 * critical) И этот человек под высоким риском ухода (personRisk high) — может
 * унести знания. Матрица:
 *
 *   busFactor \ personRisk |  high   | medium |  low/none
 *   ─────────────────────────────────────────────────────
 *   critical               | critical| critical| warning
 *   warning                | warning | warning |  ok
 *   ok                     |  ok     |  ok     |  ok
 *
 * Логика:
 *   - busFactor='critical' + personRisk='high'|'medium' → critical (соло-эксперт
 *     под риском ухода — высший приоритет дублировать зону);
 *   - busFactor='critical' + personRisk низкий/нет → warning (соло-эксперт, но
 *     уходить не собирается — мягче, но всё равно дублировать);
 *   - busFactor='warning' + personRisk high/medium → warning;
 *   - иначе → ok.
 */
export function computeCombinedSeverity(
  busFactor: SeverityLevel,
  personRisk: PersonRiskLevel | null,
): SeverityLevel {
  if (busFactor === 'critical') {
    if (personRisk === 'high' || personRisk === 'medium') return 'critical';
    return 'warning';
  }
  if (busFactor === 'warning') {
    if (personRisk === 'high' || personRisk === 'medium') return 'warning';
    return 'ok';
  }
  return 'ok';
}

/**
 * Вывести уровень риска ухода носителя из risk-флагов + engagementScore.
 * Чистая функция.
 *
 *   - есть хотя бы один high-severity risk-флаг → 'high';
 *   - есть medium-severity флаг ИЛИ engagementScore < 0.4 → 'medium';
 *   - иначе → 'low'.
 *
 * `riskFlags` — массив `{ severity }` (из `Person.riskFlagsJson.flags`).
 * `engagementScore` — 0..1 или null.
 */
export function derivePersonRiskLevel(args: {
  riskFlags: Array<{ severity?: string | null }>;
  engagementScore: number | null;
}): PersonRiskLevel {
  const flags = Array.isArray(args.riskFlags) ? args.riskFlags : [];
  const hasHigh = flags.some((f) => f && f.severity === 'high');
  if (hasHigh) return 'high';
  const hasMedium = flags.some((f) => f && f.severity === 'medium');
  const lowEngagement =
    typeof args.engagementScore === 'number' &&
    Number.isFinite(args.engagementScore) &&
    args.engagementScore < 0.4;
  if (hasMedium || lowEngagement) return 'medium';
  return 'low';
}

/**
 * Нормализовать bus-factor уровень из KnowledgeRiskSnapshot.riskLevel в
 * SeverityLevel (защита от мусора). 'critical'|'warning'|'ok'.
 */
export function normalizeBusFactorLevel(raw: string | null | undefined): SeverityLevel {
  if (raw === 'critical') return 'critical';
  if (raw === 'warning') return 'warning';
  return 'ok';
}
