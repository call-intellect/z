/**
 * SBA β-8.3 Wave 2/3 — пресентация для `Insight.causeCategory`
 * и `CompanyProfile.stage`.
 *
 * Контракт enum'а — `backend/src/modules/insights/dto/insights.dto.ts`
 * (`InsightCauseCategorySchema`). Палитра — из ТЗ
 * `plans/tz/2026-05-25-sba-beta-8-3-coo-daily-and-doelka.md` §«Принятые
 * решения», dark-first дизайн-система. Маппинг ICON_BG_CLASS используется
 * для бэйджа в виджете «Топ-5», BAR_CLASS — для столбиков в «Карте причин».
 *
 * Все строки — на русском (UI Z, см. feedback `admin_ui_russian_only`).
 */

import type { InsightCauseCategory } from '@/domain/insight';

export const CAUSE_CATEGORY_LABELS_RU: Record<InsightCauseCategory, string> = {
  process_gap: 'Процесс / процедура',
  tooling: 'Инструменты',
  role_skill: 'Роль / компетенция',
  communication: 'Коммуникация',
  priority: 'Приоритеты',
  resource_constraint: 'Ресурсы',
  external: 'Внешнее',
  unknown: 'Не определено',
};

/** Полупрозрачный фон + светлый текст — для бэйджа в «Топ-5». */
export const CAUSE_CATEGORY_BG_CLASS: Record<InsightCauseCategory, string> = {
  process_gap: 'bg-rose-500/20 text-rose-300',
  tooling: 'bg-sky-500/20 text-sky-300',
  role_skill: 'bg-violet-500/20 text-violet-300',
  communication: 'bg-amber-500/20 text-amber-300',
  priority: 'bg-pink-500/20 text-pink-300',
  resource_constraint: 'bg-stone-500/20 text-stone-300',
  external: 'bg-zinc-500/20 text-zinc-300',
  unknown: 'bg-neutral-500/20 text-neutral-300',
};

/**
 * Сплошной цвет — для горизонтального столбика в «Карте причин».
 * Без opacity, чтобы столбики были чётко видимы на тёмном фоне.
 */
export const CAUSE_CATEGORY_BAR_CLASS: Record<InsightCauseCategory, string> = {
  process_gap: 'bg-rose-500',
  tooling: 'bg-sky-500',
  role_skill: 'bg-violet-500',
  communication: 'bg-amber-500',
  priority: 'bg-pink-500',
  resource_constraint: 'bg-stone-500',
  external: 'bg-zinc-500',
  unknown: 'bg-neutral-500',
};

/**
 * Все 8 категорий в порядке отображения в виджете «Карта причин».
 * Порядок выбран по «значимости» для COO (process_gap первый — корневая
 * операционная проблема, unknown последний — мусорный бакет).
 */
export const CAUSE_CATEGORY_ORDER: InsightCauseCategory[] = [
  'process_gap',
  'communication',
  'priority',
  'role_skill',
  'tooling',
  'resource_constraint',
  'external',
  'unknown',
];

/**
 * SBA β-8.3 Wave 3 — стадии зрелости компании.
 *
 * Источник — `CompanyProfile.stage` (String, см. `MaturityScorerCron`).
 * Возможные значения сгруппированы по принципу «маленькая команда → корпорация».
 */
export type CompanyStage = 'early-stage' | 'growth' | 'scale' | 'enterprise';

export const COMPANY_STAGE_LABELS_RU: Record<CompanyStage, string> = {
  'early-stage': 'Стартап',
  growth: 'Рост',
  scale: 'Масштабирование',
  enterprise: 'Корпорация',
};

/** Безопасный mapper, который не падает на неизвестных значениях. */
export function getCompanyStageLabel(stage: string | null): string {
  if (!stage) return 'Не определено';
  if (stage in COMPANY_STAGE_LABELS_RU) {
    return COMPANY_STAGE_LABELS_RU[stage as CompanyStage];
  }
  return stage;
}
