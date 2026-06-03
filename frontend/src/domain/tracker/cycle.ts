/**
 * Доменная модель цикла (Cycle / спринт / неделя) трекера.
 *
 * Контракт: `backend/src/modules/tracker/dto/cycles/cycle-response.dto.ts`.
 */

// ─── ApiDto ─────────────────────────────────────────────────────────────────

export interface CycleApi {
  id: string;
  tenantId: string;
  projectId: string;
  name: string;
  startDate: string;
  endDate: string;
  ownedById: string | null;
  description: string | null;
  progressSnapshot: unknown;
  version: number;
  timezone: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Goals OKR v2 — цель, которую продвигает спринт (null = не задана). */
  primaryGoalId: string | null;
}

export interface ListCyclesResponseApi {
  items: CycleApi[];
  total: number;
}

export interface CompleteCycleResultApi {
  cycleId: string;
  movedIssueCount: number;
  rolledOverTo: string | null;
}

// ─── Domain ─────────────────────────────────────────────────────────────────

export interface Cycle {
  id: string;
  tenantId: string;
  projectId: string;
  name: string;
  startDate: Date;
  endDate: Date;
  ownedById: string | null;
  description: string | null;
  /** Снимок прогресса от backend — `{ done, total, doneRate }` (форма уточняется). */
  progressSnapshot: unknown;
  version: number;
  timezone: string;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** Goals OKR v2 — цель, которую продвигает спринт (null = не задана). */
  primaryGoalId: string | null;
  // ─ computed ─
  isActive: boolean;
  isCompleted: boolean;
}

// ─── Mappers ────────────────────────────────────────────────────────────────

const parseDate = (s: string | null | undefined): Date | null =>
  s ? new Date(s) : null;

export function cycleFromApi(api: CycleApi): Cycle {
  const startDate = new Date(api.startDate);
  const endDate = new Date(api.endDate);
  const completedAt = parseDate(api.completedAt);
  const now = Date.now();
  const isActive =
    completedAt === null &&
    startDate.getTime() <= now &&
    endDate.getTime() >= now;
  return {
    id: api.id,
    tenantId: api.tenantId,
    projectId: api.projectId,
    name: api.name,
    startDate,
    endDate,
    ownedById: api.ownedById,
    description: api.description,
    progressSnapshot: api.progressSnapshot,
    version: api.version,
    timezone: api.timezone,
    completedAt,
    createdAt: new Date(api.createdAt),
    updatedAt: new Date(api.updatedAt),
    primaryGoalId: api.primaryGoalId ?? null,
    isActive,
    isCompleted: completedAt !== null,
  };
}

// ─── UI helpers ─────────────────────────────────────────────────────────────

/** Подпись «12 апр – 18 апр». */
export function cycleDateRangeLabel(cycle: Cycle): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  return `${fmt(cycle.startDate)} – ${fmt(cycle.endDate)}`;
}

/**
 * Извлекает done/total/doneRate из `progressSnapshot`, если совпадает форма
 * (backend ещё в development).
 */
export interface CycleProgressView {
  done: number;
  total: number;
  doneRate: number;
}

export function readCycleProgress(snapshot: unknown): CycleProgressView | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const s = snapshot as Record<string, unknown>;
  const done = typeof s.done === 'number' ? s.done : null;
  const total = typeof s.total === 'number' ? s.total : null;
  if (done === null || total === null) return null;
  const doneRate =
    typeof s.doneRate === 'number'
      ? s.doneRate
      : total > 0
        ? done / total
        : 0;
  return { done, total, doneRate };
}
