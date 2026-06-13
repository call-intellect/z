import { z } from 'zod';

/**
 * DTO модуля ActivityFeed (Wave 2 Поток D, 2026-05-24).
 *
 * Sub-ТЗ: plans/tz/2026-05-23-activity-feeds.md
 *
 * Единая модель ActivityFeedItem — живой поток событий от агентов и системы.
 * 6+1 типов лент: probe_question | insight | decision | task | idea |
 * conflict | knowledge_change.
 *
 * Все user-facing строки на русском.
 *
 * NOTE (по дизайну): значения enum-ов (feedType, sourceType, status и т.д.)
 * хранятся в БД как `String`, а не Postgres ENUM — это сознательное решение
 * sub-ТЗ §"Модель данных". Sub-ТЗ требует возможности добавлять новые типы
 * лент / агенты без миграции. DTO нормализует whitelist на границе API.
 */

// ─────────────────────────── Enum-like whitelists ───────────────────────────

export const FeedTypeSchema = z.enum([
  'probe_question',
  'insight',
  'decision',
  'task',
  'idea',
  'conflict',
  'knowledge_change',
  'recognition',
  // Редизайн Ф8.6 «Лента Коры» (2026-06-13) — типы единой ленты-новостей.
  // Часть из них читается ВИРТУАЛЬНО из source-таблиц (idea/insight/decision/
  // conflict/blocker/open_question), часть — событийные (probe_question/
  // recognition/task). См. CoraFeedService.
  'blocker',
  'open_question',
  // `activity` — собирательный тип «кто что сделал»: объединяет событийные
  // recognition + task в одну дорожку. Отдельного значения в БД не получает —
  // CoraFeedService разворачивает его в feedType IN (recognition, task) при
  // виртуальном чтении ActivityFeedItem.
  'activity',
]);
export type FeedTypeDto = z.infer<typeof FeedTypeSchema>;

export const FeedSourceTypeSchema = z.enum(['ai_agent', 'system', 'user']);
export type FeedSourceTypeDto = z.infer<typeof FeedSourceTypeSchema>;

export const FeedSeveritySchema = z.enum(['critical', 'high', 'normal', 'low']);
export type FeedSeverityDto = z.infer<typeof FeedSeveritySchema>;

export const FeedStatusSchema = z.enum([
  'emitted',
  'delivered',
  'seen',
  'responded',
  'actioned',
  'dismissed',
  'expired',
]);
export type FeedStatusDto = z.infer<typeof FeedStatusSchema>;

export const FeedVisibilitySchema = z.enum([
  'public_org',
  'team',
  'role',
  'private',
]);
export type FeedVisibilityDto = z.infer<typeof FeedVisibilitySchema>;

export const FeedChannelSchema = z.enum([
  'in_app',
  'telegram',
  'email',
  'mobile_push',
]);
export type FeedChannelDto = z.infer<typeof FeedChannelSchema>;

export const FeedReactionSchema = z.enum(['thanks', 'vote']);
export type FeedReactionDto = z.infer<typeof FeedReactionSchema>;

export const FeedIconTypeSchema = z.enum([
  'question',
  'bulb',
  'check',
  'warning',
  'flame',
  'thumbs',
]);
export type FeedIconTypeDto = z.infer<typeof FeedIconTypeSchema>;

export const FeedDigestModeSchema = z.enum([
  'realtime',
  'daily_digest',
  'weekly_digest',
  'off',
]);
export type FeedDigestModeDto = z.infer<typeof FeedDigestModeSchema>;

// ─────────────────────────── Filters / Query ────────────────────────────────

export const ListFeedQuerySchema = z.object({
  feedType: FeedTypeSchema.optional(),
  severity: FeedSeveritySchema.optional(),
  status: FeedStatusSchema.optional(),
  teamId: z.string().min(1).max(60).optional(),
  projectId: z.string().min(1).max(60).optional(),
  goalId: z.string().min(1).max(60).optional(),
  sourceAgentName: z.string().min(1).max(120).optional(),
  /**
   * Фильтр «кому адресовано» (`ActivityFeedItem.targetUserId`).
   *
   * Используется для секций вида «вопросы AI этому человеку» на карточке
   * сотрудника (Pulse §3.0.1 ActivityFeed реестр; `PersonPulseClient`).
   *
   * Visibility-фильтр `scopedToMe` НЕ отключается этим параметром —
   * `viewedUserId` работает поверх (служит дополнительным WHERE-условием
   * `targetUserId = viewedUserId`).
   */
  viewedUserId: z.string().min(1).max(60).optional(),
  /** Окно публикации `from` (ISO 8601). */
  emittedFrom: z.string().datetime().optional(),
  /** Окно публикации `to` (ISO 8601). */
  emittedTo: z.string().datetime().optional(),
  /** Только записи, видимые мне (по visibility/targetUserId). По умолчанию `true`. */
  scopedToMe: z.coerce.boolean().default(true),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListFeedQuery = z.infer<typeof ListFeedQuerySchema>;

// ─────────────────────────── POST bodies ───────────────────────────────────

export const ReactBodySchema = z.object({
  reaction: FeedReactionSchema,
});
export type ReactBody = z.infer<typeof ReactBodySchema>;

export const RespondBodySchema = z.object({
  /** Опциональный комментарий / результат действия пользователя. */
  note: z.string().max(2_000).optional(),
});
export type RespondBody = z.infer<typeof RespondBodySchema>;

// ─────────────────────────── Subscriptions ──────────────────────────────────

export const SubscriptionFiltersSchema = z.object({
  teamIds: z.array(z.string().min(1).max(60)).max(100).optional(),
  projectIds: z.array(z.string().min(1).max(60)).max(100).optional(),
  goalIds: z.array(z.string().min(1).max(60)).max(100).optional(),
  severities: z.array(FeedSeveritySchema).optional(),
  sourceAgents: z.array(z.string().min(1).max(120)).max(20).optional(),
});
export type SubscriptionFiltersDto = z.infer<typeof SubscriptionFiltersSchema>;

export const UpsertSubscriptionBodySchema = z.object({
  feedType: FeedTypeSchema,
  filters: SubscriptionFiltersSchema.default({}),
  digestMode: FeedDigestModeSchema.default('realtime'),
  channels: z.array(FeedChannelSchema).min(1).default(['in_app']),
});
export type UpsertSubscriptionBody = z.infer<typeof UpsertSubscriptionBodySchema>;

export const PatchSubscriptionBodySchema = z.object({
  filters: SubscriptionFiltersSchema.optional(),
  digestMode: FeedDigestModeSchema.optional(),
  channels: z.array(FeedChannelSchema).min(1).optional(),
});
export type PatchSubscriptionBody = z.infer<typeof PatchSubscriptionBodySchema>;

// ─────────────────────────── Response shapes ───────────────────────────────

/**
 * Карточка ленты для UI. JSON-структура `reactions` нормализуется
 * сервисом: голые id-массивы выставляются как пустые `[]`, чтобы фронт мог
 * считать `count` без дополнительных проверок.
 */
export interface FeedItemDto {
  id: string;
  tenantId: string;
  feedType: FeedTypeDto;
  sourceType: FeedSourceTypeDto;
  sourceAgentName: string | null;
  sourceUserId: string | null;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  title: string;
  summary: string | null;
  iconType: FeedIconTypeDto | null;
  severity: FeedSeverityDto;
  status: FeedStatusDto;
  visibility: FeedVisibilityDto;
  visibilityScope: {
    teamIds?: string[];
    roleIds?: string[];
    userIds?: string[];
  } | null;
  targetUserId: string | null;
  targetChannel: FeedChannelDto | null;
  teamId: string | null;
  projectId: string | null;
  goalId: string | null;
  reactions: {
    thanks: string[];
    votes: string[];
  };
  expiresAt: string | null;
  emittedAt: string;
  deliveredAt: string | null;
  seenAt: string | null;
  respondedAt: string | null;
  actionedAt: string | null;
}

export interface ListFeedResponseDto {
  items: FeedItemDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface FeedSubscriptionDto {
  id: string;
  userId: string;
  feedType: FeedTypeDto;
  filters: SubscriptionFiltersDto;
  digestMode: FeedDigestModeDto;
  channels: FeedChannelDto[];
  createdAt: string;
  updatedAt: string;
}

// ─────────────────────────── «Лента Коры» (Редизайн Ф8.6) ───────────────────
//
// Единая лента-новости с переключателем типов. Гибрид: реестровые типы
// (idea / insight / decision / conflict / blocker / open_question) читаются
// ВИРТУАЛЬНО из source-таблиц; событийные (probe_question / recognition / task,
// собранные под `activity`) — из ActivityFeedItem. См. CoraFeedService.

/**
 * Тип в контексте «Ленты Коры». Помимо всех FeedTypeDto добавляет `'all'` —
 * собирательный фильтр «все типы».
 */
export const CoraFeedTypeSchema = z.enum([
  'all',
  'idea',
  'insight',
  'decision',
  'conflict',
  'blocker',
  'activity',
  'probe_question',
  'open_question',
]);
export type CoraFeedTypeDto = z.infer<typeof CoraFeedTypeSchema>;

/** Список конкретных (не `all`) типов, по которым строятся counters. */
export const CORA_FEED_TYPES = [
  'idea',
  'insight',
  'decision',
  'conflict',
  'blocker',
  'activity',
  'probe_question',
  'open_question',
] as const satisfies readonly Exclude<CoraFeedTypeDto, 'all'>[];

/**
 * Severity карточки ленты Коры. Упрощённая (3 уровня) проекция исходных
 * severity'ей источников — управляет цветом/иконкой и сортировкой
 * (risk > warn > info).
 */
export const CoraSeveritySchema = z.enum(['info', 'warn', 'risk']);
export type CoraSeverityDto = z.infer<typeof CoraSeveritySchema>;

/**
 * Окно выборки: число дней (строкой, чтобы один query-параметр принимал и
 * число, и `all`) либо `all` — без ограничения по дате.
 */
export const CoraWindowSchema = z
  .union([z.literal('all'), z.coerce.number().int().min(1).max(3650)])
  .default(30);
export type CoraWindowDto = z.infer<typeof CoraWindowSchema>;

export const CoraFeedQuerySchema = z.object({
  type: CoraFeedTypeSchema.default('all'),
  window: CoraWindowSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type CoraFeedQuery = z.infer<typeof CoraFeedQuerySchema>;

/**
 * Единая карточка «Ленты Коры». Несёт АНАЛИЗ (не сырой факт): `analysis` —
 * человекочитаемая выжимка (N упоминаний / % доведения / daysOpen / тренд),
 * `severity` управляет цветом и сортировкой. `payload` — type-specific
 * дополнительные поля (для conflict — две версии; для open_question —
 * askedByManager и т.п.).
 */
export interface CoraFeedItemDto {
  id: string;
  type: Exclude<CoraFeedTypeDto, 'all'>;
  title: string;
  analysis?: string;
  severity: CoraSeverityDto;
  sourceRef?: {
    meetingId?: string;
    cite?: string;
  };
  createdAt: string;
  unread: boolean;
  payload?: Record<string, unknown>;
}

export interface CoraFeedResponseDto {
  items: CoraFeedItemDto[];
  /** Сколько записей каждого конкретного типа за окно (для бейджей переключателя). */
  counters: Record<Exclude<CoraFeedTypeDto, 'all'>, number>;
  /** Сколько всего непрочитанных (createdAt > курсор) в ОТФИЛЬТРОВАННОЙ выдаче. */
  unreadCount: number;
}

export interface CoraSeenResponseDto {
  ok: true;
  lastSeenAt: string;
}
