/**
 * Общие типы и интерфейсы для модулей демо-данных «ТехноСтрим».
 * Каждый модуль экспортирует seed-функцию с сигнатурой SeedFn.
 */
import type { PrismaClient } from '@prisma/client';

export interface SeedContext {
  prisma: PrismaClient;
  tenantId: string;
  ownerUserId: string;
}

/** ID-карта: ключ — логическое имя, значение — cuid из БД. */
export interface IdMap {
  // Org-structure
  departments: Record<string, string>;
  roles: Record<string, string>;
  persons: Record<string, string>;

  // Tracker
  projects: Record<string, string>;
  boards: Record<string, string>;
  states: Record<string, string>;
  cycles: Record<string, string>;
  labels: Record<string, string>;
  issues: Record<string, string>;

  // Meetings
  meetings: Record<string, string>;

  // Knowledge graph
  ideaBlocks: Record<string, string>;
  entities: Record<string, string>;
  themes: Record<string, string>;

  // Goals & Clones
  goals: Record<string, string>;
  skillProfiles: Record<string, string>;

  // Polish
  cards: Record<string, string>;
  processes: Record<string, string>;

  // ── 2026-05-31 Demo Content Expansion ──
  users: Record<string, string>;
  processTemplates: Record<string, string>;
  regulations: Record<string, string>;
  ideas: Record<string, string>;
  ideaClusters: Record<string, string>;
  events: Record<string, string>;
  documents: Record<string, string>;
  referralLinkId: string | null;
  referrals: Record<string, string>;
  feedbackMessages: Record<string, string>;
  feedbackTopics: Record<string, string>;
  experiments: Record<string, string>;
  vendors: Record<string, string>;
  probeEvents: Record<string, string>;

  pulseSnapshotIds: {
    knowledgeRisks: string[];
    recurringTopics: string[];
    personGoalContributions: string[];
    promiseNetwork: string | null;
    knowledgeVelocity: string | null;
    personEngagements: string[];
    forecasts: string[];
    frictionReports: string[];
    helpfulnessTraits: string[];
    helpfulnessSpotlights: string[];
    socialContributions: string[];
    contributions: string[];
  };
}

export function createEmptyIdMap(): IdMap {
  return {
    departments: {},
    roles: {},
    persons: {},
    projects: {},
    boards: {},
    states: {},
    cycles: {},
    labels: {},
    issues: {},
    meetings: {},
    ideaBlocks: {},
    entities: {},
    themes: {},
    goals: {},
    skillProfiles: {},
    cards: {},
    processes: {},
    users: {},
    processTemplates: {},
    regulations: {},
    ideas: {},
    ideaClusters: {},
    events: {},
    documents: {},
    referralLinkId: null,
    referrals: {},
    feedbackMessages: {},
    feedbackTopics: {},
    experiments: {},
    vendors: {},
    probeEvents: {},
    pulseSnapshotIds: {
      knowledgeRisks: [],
      recurringTopics: [],
      personGoalContributions: [],
      promiseNetwork: null,
      knowledgeVelocity: null,
      personEngagements: [],
      forecasts: [],
      frictionReports: [],
      helpfulnessTraits: [],
      helpfulnessSpotlights: [],
      socialContributions: [],
      contributions: [],
    },
  };
}

export type SeedFn = (ctx: SeedContext, ids: IdMap) => Promise<void>;

/** Хелпер: дата N дней назад от today. */
export function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(10, 0, 0, 0);
  return d;
}

/** Хелпер: конкретная дата. */
export function at(dateStr: string, hours = 10): Date {
  const d = new Date(dateStr);
  d.setHours(hours, 0, 0, 0);
  return d;
}

/** Дата в YYYY-MM-DD формате. */
export function localDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Генератор ULID-подобных ID для Meeting (Meeting.id не имеет @default). */
export function demoId(prefix: string, n: number): string {
  return `demo-${prefix}-${String(n).padStart(4, '0')}`;
}

/** Non-null assertion для id-мапы (noUncheckedIndexedAccess). */
export function req(val: string | undefined, label: string): string {
  if (!val) throw new Error(`Demo seed: missing required id "${label}"`);
  return val;
}

/** Понедельник недели (UTC-aware) для даты d. Возвращает 00:00:00.000Z в локальной TZ дня. */
export function mondayOf(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const dow = (x.getDay() + 6) % 7; // Monday=0..Sunday=6
  x.setDate(x.getDate() - dow);
  return x;
}

/**
 * Детерминированный псевдо-«рандом» 0..1 по строковому ключу.
 * Используется вместо Math.random() — повторный seed даёт тот же кабинет.
 */
export function hashFloat(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100_000) / 100_000;
}
