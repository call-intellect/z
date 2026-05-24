/**
 * Доменная модель статуса задачи (`IssueState`) — колонка канбана.
 *
 * Контракт: `backend/src/modules/tracker/dto/states/state-response.dto.ts`.
 *
 * State принадлежит проекту, имеет категорию (backlog / unstarted / started /
 * completed / cancelled) и порядок в колонке. Фронт использует state для:
 *   - рендера колонок board;
 *   - фильтра «Статус» в списках задач;
 *   - drag-and-drop переходов (на drop вызывается `PATCH /api/v1/issues/:id/transitions`
 *     с `stateId` целевой колонки).
 */

import {
  parseIssueStateCategory,
  type IssueStateCategory,
} from './enums';

// ─── ApiDto ─────────────────────────────────────────────────────────────────

export interface TrackerStateApi {
  id: string;
  tenantId: string;
  projectId: string;
  name: string;
  color: string;
  /** backlog | unstarted | started | completed | cancelled. */
  category: string;
  sequence: number;
  isDefault: boolean;
}

export interface ListStatesResponseApi {
  items: TrackerStateApi[];
  total: number;
}

// ─── Domain ─────────────────────────────────────────────────────────────────

export interface TrackerState {
  id: string;
  tenantId: string;
  projectId: string;
  name: string;
  color: string;
  category: IssueStateCategory;
  sequence: number;
  isDefault: boolean;
}

// ─── Mappers ────────────────────────────────────────────────────────────────

export function trackerStateFromApi(api: TrackerStateApi): TrackerState {
  return {
    id: api.id,
    tenantId: api.tenantId,
    projectId: api.projectId,
    name: api.name,
    color: api.color,
    category: parseIssueStateCategory(api.category),
    sequence: api.sequence,
    isDefault: api.isDefault,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Сортировка states для отображения колонок board:
 * сначала по category (фиксированный порядок), потом по sequence внутри
 * категории, потом по имени для стабильности.
 */
const CATEGORY_ORDER: Record<IssueStateCategory, number> = {
  backlog: 0,
  unstarted: 1,
  started: 2,
  completed: 3,
  cancelled: 4,
};

export function compareStatesForBoard(a: TrackerState, b: TrackerState): number {
  const byCategory = CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category];
  if (byCategory !== 0) return byCategory;
  const bySequence = a.sequence - b.sequence;
  if (bySequence !== 0) return bySequence;
  return a.name.localeCompare(b.name, 'ru');
}
