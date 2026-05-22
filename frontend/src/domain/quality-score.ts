/**
 * Domain-model для quality-score. Принимает ApiDto и возвращает данные,
 * готовые к показу в UI. UI-форматирование (цвет балла, иконка severity)
 * делается в компоненте.
 *
 * Соответствует слоистой модели Z (skill `frontend-rules`):
 *   ApiDto → DomainModel → UiModel.
 */

import type {
  OrgDashboardQualityScoreResponseApi,
  OrgQualityScoreSettingsResponseApi,
  QualityScoreApi,
  QualityScoreCategoriesApi,
  QualityScoreCategoryApi,
  QualityScoreRecommendationApi,
  QualityScoreResponseApi,
  QualityScoreSeverityApi,
  QualityScoreStatusApi,
} from '@/api/quality-score.api';

export type QualityScoreStatus = QualityScoreStatusApi;
export type QualityScoreCategory = QualityScoreCategoryApi;
export type QualityScoreSeverity = QualityScoreSeverityApi;

export interface QualityScoreCategoriesDomain {
  preparation: number;
  structure: number;
  clarity: number;
  outcomes: number;
  engagement: number;
}

export interface QualityScoreRecommendationDomain {
  text: string;
  severity: QualityScoreSeverity;
  category: QualityScoreCategory;
  degradedMode: boolean;
}

export interface QualityScoreDomain {
  overallScore: number;
  categories: QualityScoreCategoriesDomain;
  recommendations: QualityScoreRecommendationDomain[];
  strengths: string[];
  computedAt: Date;
  degradedMode: boolean;
}

export interface QualityScoreResponseDomain {
  status: QualityScoreStatus;
  score: QualityScoreDomain | null;
}

export function qualityScoreResponseFromApi(
  dto: QualityScoreResponseApi,
): QualityScoreResponseDomain {
  return {
    status: dto.status,
    score: dto.score ? qualityScoreFromApi(dto.score) : null,
  };
}

function qualityScoreFromApi(dto: QualityScoreApi): QualityScoreDomain {
  return {
    overallScore: dto.overallScore,
    categories: categoriesFromApi(dto.categories),
    recommendations: dto.recommendations.map((r) => recommendationFromApi(r)),
    strengths: [...dto.strengths],
    computedAt: new Date(dto.computedAt),
    degradedMode: dto.degradedMode,
  };
}

function categoriesFromApi(dto: QualityScoreCategoriesApi): QualityScoreCategoriesDomain {
  return {
    preparation: dto.preparation,
    structure: dto.structure,
    clarity: dto.clarity,
    outcomes: dto.outcomes,
    engagement: dto.engagement,
  };
}

function recommendationFromApi(
  r: QualityScoreRecommendationApi,
): QualityScoreRecommendationDomain {
  return {
    text: r.text,
    severity: r.severity,
    category: r.category,
    degradedMode: r.degradedMode === true,
  };
}

// ──────────────────────── Org settings ────────────────────────

export interface OrgQualityScoreSettingsDomain {
  tenantId: string;
  disabledForTypes: string[];
}

export function orgQualityScoreSettingsFromApi(
  dto: OrgQualityScoreSettingsResponseApi,
): OrgQualityScoreSettingsDomain {
  return {
    tenantId: dto.tenantId,
    disabledForTypes: [...dto.disabledForTypes],
  };
}

// ──────────────────────── Dashboard ───────────────────────────

export interface OrgDashboardQualityScoreDomain {
  tenantId: string;
  averageScore: number;
  meetingsCount: number;
  byType: Array<{ type: string; avg: number; count: number }>;
  trend: Array<{ date: string; avg: number; count: number }>;
}

export function orgDashboardQualityScoreFromApi(
  dto: OrgDashboardQualityScoreResponseApi,
): OrgDashboardQualityScoreDomain {
  return {
    tenantId: dto.tenantId,
    averageScore: dto.averageScore,
    meetingsCount: dto.meetingsCount,
    byType: dto.byType.map((b) => ({ ...b })),
    trend: dto.trend.map((t) => ({ ...t })),
  };
}

// ──────────────────────── UI utility ───────────────────────────

/**
 * Возвращает цветовую маркировку для балла (sub-TZ C §8.1):
 *   - red    0-39
 *   - yellow 40-69
 *   - green  70-100
 */
export function qualityScoreColor(value: number): 'red' | 'yellow' | 'green' {
  if (value <= 39) return 'red';
  if (value <= 69) return 'yellow';
  return 'green';
}

/** Локализация категории на русский. */
export function qualityScoreCategoryLabel(c: QualityScoreCategory): string {
  switch (c) {
    case 'preparation':
      return 'Подготовка';
    case 'structure':
      return 'Структура';
    case 'clarity':
      return 'Чёткость формулировок';
    case 'outcomes':
      return 'Итоги';
    case 'engagement':
      return 'Вовлечённость';
  }
}

/** Локализация severity на русский. */
export function qualityScoreSeverityLabel(s: QualityScoreSeverity): string {
  switch (s) {
    case 'info':
      return 'Информация';
    case 'warning':
      return 'Внимание';
    case 'critical':
      return 'Важно';
  }
}
