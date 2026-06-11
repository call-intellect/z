/**
 * Доменная модель персонального брифа «Твой день» (DomainModel слой).
 *
 * ТЗ 2026-06-11 mobile-cora-exec-manager, Ф0. Маппит ApiDto
 * (`src/api/me/daily-brief.api.ts`) → UI-friendly модель + считает на ФРОНТЕ
 * позитивную рамку (Р4): «держишь слово N из M», «под рукой сегодня».
 *
 * Принцип Р4: overdue-обещания — это «под угрозой / перенести», НЕ красный
 * список «проваленных обещаний». Здесь только данные; формулировки запрета —
 * в компоненте.
 */

import type {
  BriefInsightCoOccurrenceApi,
  BriefItemApi,
  BriefKnowsWhoApi,
  DailyBriefApi,
} from '@/api/me/daily-brief.api';

export type BriefItemKind = string;

export interface BriefItemDomain {
  kind: BriefItemKind;
  title: string;
  /** Срок (Date) или null, если без срока. */
  dueDate: Date | null;
  overdue: boolean;
  counterpartyName: string | null;
}

export interface BriefKnowsWhoDomain {
  blockId: string;
  blockerText: string;
  expertPersonId: string;
  expertName: string;
  confidence: number;
}

export interface BriefInsightCoOccurrenceDomain {
  statement: string;
  colleaguesCount: number;
  escalated: boolean;
}

/**
 * Позитивная рамка обещаний (Р4) — считается на фронте из `myPromises`.
 *   - `total` — всего обещаний на сегодня (срок ≤ сегодня).
 *   - `kept` — те, что НЕ overdue (держишь слово).
 *   - `atRisk` — overdue: подаются как «под угрозой / перенести», не вина.
 */
export interface PromiseKeepingDomain {
  total: number;
  kept: number;
  atRisk: number;
}

export interface DailyBriefDomain {
  id: string | null;
  dateLocal: string;
  myTasks: BriefItemDomain[];
  myPromises: BriefItemDomain[];
  myBlockers: BriefItemDomain[];
  promisedToMe: BriefItemDomain[];
  hint: string;
  knowsWho: BriefKnowsWhoDomain | null;
  insightCoOccurrence: BriefInsightCoOccurrenceDomain | null;
  counts: {
    tasks: number;
    promises: number;
    blockers: number;
    promisedToMe: number;
  };
  deliveredAt: Date | null;
  openedAt: Date | null;

  // ── производные (считаются на фронте, Р4) ──
  /** «Держишь слово N из M». */
  promiseKeeping: PromiseKeepingDomain;
  /** «Под рукой сегодня» = задачи + обещания на сегодня (НЕ overdue). */
  onDeckToday: BriefItemDomain[];
  /** Просроченное мягким блоком сверху («под угрозой / перенести»). */
  atRiskItems: BriefItemDomain[];
  /** true — нет ни одного пункта и нет хинта (cold-start empty-state). */
  isEmpty: boolean;
}

function mapItem(api: BriefItemApi): BriefItemDomain {
  return {
    kind: api.kind,
    title: api.title,
    dueDate: api.dueDateIso ? new Date(api.dueDateIso) : null,
    overdue: api.overdue,
    counterpartyName: api.counterpartyName,
  };
}

function mapKnowsWho(api: BriefKnowsWhoApi | null): BriefKnowsWhoDomain | null {
  if (!api) return null;
  return {
    blockId: api.blockId,
    blockerText: api.blockerText,
    expertPersonId: api.expertPersonId,
    expertName: api.expertName,
    confidence: api.confidence,
  };
}

function mapInsight(
  api: BriefInsightCoOccurrenceApi | null | undefined,
): BriefInsightCoOccurrenceDomain | null {
  if (!api) return null;
  return {
    statement: api.statement,
    colleaguesCount: api.colleaguesCount,
    escalated: api.escalated,
  };
}

export function mapDailyBrief(api: DailyBriefApi): DailyBriefDomain {
  const myTasks = api.myTasks.map(mapItem);
  const myPromises = api.myPromises.map(mapItem);
  const myBlockers = api.myBlockers.map(mapItem);
  const promisedToMe = api.promisedToMe.map(mapItem);

  // Р4 — позитивная рамка обещаний. kept = НЕ overdue, atRisk = overdue.
  const promisesKept = myPromises.filter((p) => !p.overdue).length;
  const promisesAtRisk = myPromises.length - promisesKept;

  // «Под рукой сегодня» — задачи + обещания, которые ещё не просрочены.
  const onDeckToday = [...myTasks, ...myPromises].filter((i) => !i.overdue);
  // Просроченное — мягкий блок «под угрозой / перенести» (задачи + обещания).
  const atRiskItems = [...myTasks, ...myPromises].filter((i) => i.overdue);

  const isEmpty =
    myTasks.length === 0 &&
    myPromises.length === 0 &&
    myBlockers.length === 0 &&
    promisedToMe.length === 0 &&
    api.hint.trim().length === 0;

  return {
    id: api.id,
    dateLocal: api.dateLocal,
    myTasks,
    myPromises,
    myBlockers,
    promisedToMe,
    hint: api.hint,
    knowsWho: mapKnowsWho(api.knowsWho),
    insightCoOccurrence: mapInsight(api.insightCoOccurrence),
    counts: api.counts,
    deliveredAt: api.deliveredAt ? new Date(api.deliveredAt) : null,
    openedAt: api.openedAt ? new Date(api.openedAt) : null,
    promiseKeeping: {
      total: myPromises.length,
      kept: promisesKept,
      atRisk: promisesAtRisk,
    },
    onDeckToday,
    atRiskItems,
    isEmpty,
  };
}
