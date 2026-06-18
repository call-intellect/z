import { z } from 'zod';

import type { KnowsWhoExpert } from '../services/knows-who.service';
import type {
  BriefItem,
  BriefKnowsWhoHint,
  PersonalDailyBriefPayload,
} from '../services/personal-daily-brief.synth';

export const DailyBriefQuerySchema = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'date должен быть YYYY-MM-DD')
      .optional(),
  })
  .strict();

export type DailyBriefQuery = z.infer<typeof DailyBriefQuerySchema>;

export interface DailyBriefItemDto {
  kind: BriefItem['kind'];
  title: string;
  dueDateIso: string | null;
  overdue: boolean;
  counterpartyName: string | null;
}

export interface DailyBriefKnowsWhoDto {
  blockId: string;
  blockerText: string;
  expertPersonId: string;
  expertName: string;
  confidence: number;
}

export interface DailyBriefDto {
  id: string | null;
  dateLocal: string;
  myTasks: DailyBriefItemDto[];
  myPromises: DailyBriefItemDto[];
  myBlockers: DailyBriefItemDto[];
  promisedToMe: DailyBriefItemDto[];
  hint: string;
  knowsWho: DailyBriefKnowsWhoDto | null;
  counts: {
    tasks: number;
    promises: number;
    blockers: number;
    promisedToMe: number;
  };
  deliveredAt: string | null;
  openedAt: string | null;
}

function mapItem(i: BriefItem): DailyBriefItemDto {
  return {
    kind: i.kind,
    title: i.title,
    dueDateIso: i.dueDateIso,
    overdue: i.overdue,
    counterpartyName: i.counterpartyName ?? null,
  };
}

function mapKnowsWho(k: BriefKnowsWhoHint | null): DailyBriefKnowsWhoDto | null {
  if (!k) return null;
  return {
    blockId: k.blockId,
    blockerText: k.blockerText,
    expertPersonId: k.expertPersonId,
    expertName: k.expertName,
    confidence: k.confidence,
  };
}

export function toDailyBriefDto(args: {
  id: string | null;
  payload: PersonalDailyBriefPayload;
  deliveredAt: string | null;
  openedAt: string | null;
}): DailyBriefDto {
  const p = args.payload;
  return {
    id: args.id,
    dateLocal: p.dateLocal,
    myTasks: p.myTasks.map(mapItem),
    myPromises: p.myPromises.map(mapItem),
    myBlockers: p.myBlockers.map(mapItem),
    promisedToMe: p.promisedToMe.map(mapItem),
    hint: p.hint,
    knowsWho: mapKnowsWho(p.knowsWho),
    counts: p.counts,
    deliveredAt: args.deliveredAt,
    openedAt: args.openedAt,
  };
}

export function emptyDailyBriefDto(dateLocal: string): DailyBriefDto {
  return {
    id: null,
    dateLocal,
    myTasks: [],
    myPromises: [],
    myBlockers: [],
    promisedToMe: [],
    hint: '',
    knowsWho: null,
    counts: { tasks: 0, promises: 0, blockers: 0, promisedToMe: 0 },
    deliveredAt: null,
    openedAt: null,
  };
}

export const KnowsWhoQuerySchema = z
  .object({
    blockId: z.string().min(1).max(80).optional(),
    q: z.string().min(1).max(500).optional(),
    limit: z.coerce.number().int().min(1).max(10).optional().default(3),
  })
  .strict()
  .refine((v) => Boolean(v.blockId) || Boolean(v.q), {
    message: 'Нужен либо blockId, либо q',
  });

export type KnowsWhoQuery = z.infer<typeof KnowsWhoQuerySchema>;

export interface KnowsWhoExpertDto {
  personId: string;
  name: string;
  confidence: number;
  topCategories: string[];
}

export interface KnowsWhoListDto {
  experts: KnowsWhoExpertDto[];
}

export function toKnowsWhoListDto(experts: KnowsWhoExpert[]): KnowsWhoListDto {
  return {
    experts: experts.map((e) => ({
      personId: e.personId,
      name: e.name,
      confidence: e.confidence,
      topCategories: e.topCategories,
    })),
  };
}
