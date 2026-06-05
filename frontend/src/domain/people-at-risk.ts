/**
 * Domain-типы для виджета «Сотрудники под риском» (ТЗ-G Фаза 1-2).
 *
 * Источник правды: `backend/src/modules/dashboard/services/people-at-risk.service.ts`
 * (DTO `backend/src/modules/dashboard/dto/people-at-risk.dto.ts`).
 * GET `/api/v1/dashboard/people-at-risk?limit=N` → `PeopleAtRiskResponseApi`.
 *
 * Mapping ApiDto → DomainModel здесь тождественный (поля простые, уже
 * сериализованы — `engagementScoreAt` приходит ISO-строкой). Если в будущем
 * появится `Date` или нормализация — менять мапперы здесь, без правки UI.
 */

export type PeopleAtRiskItemApi = {
  personId: string;
  name: string;
  /** Отдел сотрудника или null, если не задан. */
  department: string | null;
  /** 0..100, чем ниже — тем критичнее. */
  pulseScore: number;
  /** Готовая фраза-действие («Признаки перегрузки — обсудите нагрузку»). */
  topReason: string;
  /** ISO-строка момента последнего расчёта engagementScore или null. */
  engagementScoreAt: string | null;
};

export type PeopleAtRiskResponseApi = {
  items: PeopleAtRiskItemApi[];
  /** Сколько всего сотрудников под порогом риска (может быть > items.length). */
  totalAtRisk: number;
  generatedAt: string;
};

// Domain — alias (типы простые, без нормализации).
export type PeopleAtRiskItemDomain = PeopleAtRiskItemApi;
export type PeopleAtRiskResponseDomain = PeopleAtRiskResponseApi;

export function peopleAtRiskFromApi(
  api: PeopleAtRiskResponseApi,
): PeopleAtRiskResponseDomain {
  return {
    items: api.items.map((it) => ({
      personId: it.personId,
      name: it.name,
      department: it.department,
      pulseScore: it.pulseScore,
      topReason: it.topReason,
      engagementScoreAt: it.engagementScoreAt,
    })),
    totalAtRisk: api.totalAtRisk,
    generatedAt: api.generatedAt,
  };
}
