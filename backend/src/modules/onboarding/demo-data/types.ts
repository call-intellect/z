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
