/**
 * Чистая логика мобильного экрана «Память» (ТЗ B5/Ф6
 * `2026-06-11-remaining-handoff-finishable-now.md` блок B; полный контракт —
 * `2026-06-11-mobile-cora-exec-manager.md` §Ф6).
 *
 * Вынесена из `MobileMemoryClient` отдельным модулем (без JSX/хуков/сети), чтобы
 * детерминированно тестировать формат даты, лейбл/тон статуса и подпись-источник.
 *
 * Источник — ТОТ ЖЕ, что у десктопного `DecisionsListClient`: `decisionsApi.list`
 * → `mapDecisionListItem` → `DecisionListItem[]`. Видимость определяет backend
 * (RBAC `decision:read` за `TenantGuard`); на фронте НИЧЕГО не дофильтровываем.
 */

import {
  DECISION_STATUS_LABEL,
  DECISION_STATUS_TONE,
  type DecisionListItem,
  type DecisionStatus,
} from '@/domain/decision';

/** Парный chip-токен (bg/fg), которым красим бейдж статуса. */
export type ChipTone = 'success' | 'danger' | 'warning' | 'info' | 'neutral';

/**
 * Тон статуса решения → парный chip-токен `bg-chip-{tone}-bg` /
 * `text-chip-{tone}-fg`. `DECISION_STATUS_TONE` даёт семантику
 * (success/error/warning/info/neutral); 'error' маппим на доступный chip
 * `danger` (chip-error-* в конфиге нет — есть chip-danger-*).
 */
export function statusChipTone(status: DecisionStatus): ChipTone {
  switch (DECISION_STATUS_TONE[status]) {
    case 'success':
      return 'success';
    case 'error':
      return 'danger';
    case 'warning':
      return 'warning';
    case 'info':
      return 'info';
    default:
      return 'neutral';
  }
}

/** Русский лейбл статуса решения (реэкспорт из domain для удобства теста/UI). */
export function statusLabel(status: DecisionStatus): string {
  return DECISION_STATUS_LABEL[status];
}

/**
 * Дата решения в коротком русском формате (напр. «11 июн 2026»). Берём
 * `decidedAt`; если его нет — `createdAt` (момент, когда Кора зафиксировала
 * решение в памяти). Возвращаем подпись готовой к рендеру.
 */
export function decidedDateLabel(item: DecisionListItem): string {
  const date = item.decidedAt ?? item.createdAt;
  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Подпись-источник под карточкой: дата + краткий маркер происхождения. На
 * уровне списка отдельного «источника» (встреча/документ) бэк не отдаёт —
 * различаем лишь «зафиксировано» (decidedAt есть) vs «добавлено в память»
 * (только createdAt). Это честный сигнал без выдуманных полей.
 */
export function sourceLabel(item: DecisionListItem): string {
  return item.decidedAt ? 'Зафиксировано' : 'В памяти с';
}

/** Карточка решения для мобильной ленты «Память». */
export interface MemoryCard {
  id: string;
  statement: string;
  statusLabel: string;
  statusTone: ChipTone;
  dateLabel: string;
  sourceLabel: string;
}

/** Маппинг доменного решения в карточку ленты. */
export function memoryCard(item: DecisionListItem): MemoryCard {
  return {
    id: item.id,
    statement: item.statement,
    statusLabel: statusLabel(item.status),
    statusTone: statusChipTone(item.status),
    dateLabel: decidedDateLabel(item),
    sourceLabel: sourceLabel(item),
  };
}

export function memoryCards(items: readonly DecisionListItem[]): MemoryCard[] {
  return items.map(memoryCard);
}
