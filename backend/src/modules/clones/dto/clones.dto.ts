import { z } from 'zod';

/**
 * SBA γ-1 — DTO модуля Clones (Clone API).
 *
 * Эндпоинты:
 *   POST /api/v1/clones/persons/:personId/ask — ответ от клона конкретного сотрудника.
 *   POST /api/v1/clones/roles/:roleId/ask     — ответ от клона роли (агрегат).
 */

export const AskCloneBodySchema = z.object({
  question: z
    .string({ error: 'Вопрос обязателен' })
    .trim()
    .min(3, 'Слишком короткий вопрос')
    .max(2_000, 'Слишком длинный вопрос'),
  /** Опционально: продолжить существующий диалог ChatV2Conversation. */
  conversationId: z.string().min(1).max(64).optional(),
  /**
   * Раздел 7 (Р4) — спросить КОНКРЕТНУЮ версию клона роли (в т.ч. бывшего
   * носителя, статус frozen). Не задано → текущий active носитель.
   */
  roleVersion: z.coerce.number().int().min(1).optional(),
});
export type AskCloneBody = z.infer<typeof AskCloneBodySchema>;

/**
 * POST /api/v1/clones/skill-traits/:traitId/mark-misleading — body.
 * Phase F.8: заменяет `@Body() body: { reason?: string }` (untyped) на Zod-DTO.
 */
export const MarkTraitMisleadingBodySchema = z
  .object({
    reason: z.string().trim().max(2_000).optional(),
  })
  .strict();
export type MarkTraitMisleadingBody = z.infer<typeof MarkTraitMisleadingBodySchema>;

export interface CloneCitationDto {
  blockId: string;
  meetingId?: string;
  meetingTitle?: string;
  startMs?: number;
  endMs?: number;
  snippet?: string;
}

export interface AskCloneResponseDto {
  conversationId: string;
  messageId: string;
  text: string;
  citations: CloneCitationDto[];
  mode: 'clone_style';
  /** Если true — носитель спрашивает своего же клона (для UI). */
  isOwner: boolean;
  /**
   * Фаза 1 «clone reliability hardening» — клон отказался отвечать
   * (программный анти-deepfake). По умолчанию undefined ≈ false.
   */
  refused?: boolean;
  /**
   * Машинно-читаемая причина отказа клона отвечать.
   * Текущие значения: `'topic_starved'` — в контексте недостаточно
   * рассуждений по теме вопроса. Поле опциональное — null/undefined,
   * когда клон ответил нормально.
   */
  refusalReason?: string | null;
}

/**
 * SBA γ-1 — DTO навыкового профиля (для manager / admin / self).
 */
export interface SkillTraitDto {
  id: string;
  category: string;
  statement: string;
  confidence: 'low' | 'medium' | 'high';
  observationCount: number;
  sourceBlockIds: string[];
  firstObservedAt: string;
  lastConfirmedAt: string;
  /**
   * pending_verification (Ф3(D)) добавлен для совместимости типов с Prisma-enum;
   * read-эндпоинты профиля фильтруют `status='active'`, поэтому на практике в
   * DTO попадают только active-черты.
   */
  status:
    | 'active'
    | 'superseded_by'
    | 'archived'
    | 'misleading'
    | 'pending_verification';
}

export interface SkillProfileDto {
  profileId: string;
  personId: string;
  personName: string;
  status: 'active' | 'archived' | 'paused_relationship';
  buildVersion: number;
  lastBuildAt: string | null;
  /** true — недостаточно reasoning-блоков для построения профиля. */
  isEmpty: boolean;
  /** true — у запрашивающего есть право пометить trait как misleading. */
  canMarkMisleading: boolean;
  /** true — текущий пользователь — носитель профиля. */
  isSelf: boolean;
  traits: SkillTraitDto[];
  /** Persona snapshots history (timeline по version). */
  personaSnapshots: Array<{
    id: string;
    version: number;
    snapshotAt: string;
    builtFromTraitsCount: number;
    /** Clones=Roles Ф2 — добавлен pending_rebuild; Раздел 7 — `frozen` (бывший носитель, read-only). */
    status: 'active' | 'superseded' | 'pending_rebuild' | 'frozen';
  }>;
}

export interface RoleSkillProfileDto {
  roleId: string;
  roleName: string;
  /** Топ-5 общих эмерджентных черт для роли. */
  topTraits: Array<{ category: string; statement: string; observationCount: number }>;
  /** Сотрудники на роли с активным SkillProfile. */
  people: Array<{
    personId: string;
    personName: string;
    activeTraitsCount: number;
    profileBuildVersion: number;
  }>;
  /** True — есть active role-persona (можно «попробовать клона роли»). */
  hasRolePersona: boolean;
}

// ─────────────── Clones=Roles Ф4 — /clones list & history ───────────────

/**
 * Clones=Roles Ф4 — query-params для `GET /api/v1/clones`.
 * Возвращает paginated список текущих active ролевых клонов Org.
 *
 * Filters:
 *   - `status` — фильтр по `ExecutablePersona.status`. По умолчанию active.
 *   - `q` — поиск подстрокой по `Role.name` (case-insensitive).
 *   - `confidenceMin` — минимальный confidence клона (0..1).
 *     Confidence считается как `min(1, builtFromTraitsCount / 10)` —
 *     эвристика «10 traits = полный confidence», совпадает с UI Ф4.
 *   - `page`, `pageSize` — 1-based pagination, pageSize default 20, max 100.
 */
export const ClonesListQuerySchema = z.object({
  status: z
    .enum(['active', 'superseded', 'pending_rebuild', 'frozen'])
    .optional()
    .default('active'),
  q: z.string().trim().min(1).max(200).optional(),
  confidenceMin: z.coerce.number().min(0).max(1).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});
export type ClonesListQuery = z.infer<typeof ClonesListQuerySchema>;

/**
 * Clones=Roles Ф4 — карточка клона роли для `/clones` UI.
 * Поля сгруппированы по UX-блокам страницы.
 */
export interface CloneListItemDto {
  /** ExecutablePersona.id текущей active версии. */
  personaId: string;
  /** Role.id — ссылка `/roles/:id/clone`. */
  roleId: string;
  /** Role.name. */
  roleName: string;
  /** Department.name (если у роли есть отдел) — для группировок/фильтров. */
  departmentName: string | null;
  /** Department.id — для будущих фильтров по департаменту. */
  departmentId: string | null;
  /** Версия клона роли (ExecutablePersona.roleVersion). 1, если backfill не прошёл. */
  version: number;
  /** Публичное имя клона «Клон Маркетолога v2» (ExecutablePersona.publicName). */
  publicName: string;
  /**
   * ExecutablePersona.status — active/superseded/pending_rebuild/frozen.
   * Clones=Roles Ф2 (2026-05-25) — добавлен `pending_rebuild`: после смены
   * носителя роли создаётся новая версия без personaPrompt; следующий
   * `executable-persona-build` его дозаполнит и переключит на `active`.
   * Раздел 7 (2026-06-16) — `frozen`: снимок бывшего носителя должности
   * (read-only, доступен для вопросов навсегда, не активен).
   */
  status: 'active' | 'superseded' | 'pending_rebuild' | 'frozen';
  /** Текущий носитель роли (Person.id + name) или null. */
  currentBearer: { personId: string; personName: string } | null;
  /** confidence клона — эвристика min(1, builtFromTraitsCount / 10), 0..1. */
  confidence: number;
  /** Количество SkillTrait.id, попавших в snapshot. */
  traitsCount: number;
  /** ISO дата последнего snapshot (ExecutablePersona.snapshotAt). */
  lastBuildAt: string;
}

export interface ClonesListResponseDto {
  items: CloneListItemDto[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Clones=Roles Ф4 — одна версия из истории клона роли
 * (`GET /api/v1/clones/:roleId/history`).
 */
export interface CloneVersionDto {
  personaId: string;
  roleId: string;
  version: number;
  publicName: string;
  /**
   * ExecutablePersona.status — active/superseded/pending_rebuild/frozen
   * (Clones=Roles Ф2 + Раздел 7, см. CloneListItemDto.status).
   */
  status: 'active' | 'superseded' | 'pending_rebuild' | 'frozen';
  /** Носитель роли в эту версию (если был зафиксирован). */
  bearer: { personId: string; personName: string } | null;
  /** Старт периода — snapshotAt этой версии. */
  validFrom: string;
  /**
   * Конец периода — snapshotAt следующей версии или null, если эта версия
   * сейчас активна. UI отображает «по сейчас».
   */
  validUntil: string | null;
  confidence: number;
  traitsCount: number;
}

export interface CloneHistoryResponseDto {
  roleId: string;
  roleName: string;
  versions: CloneVersionDto[];
}

// ─────────────── TZ clone-method Э0.1 — журнал запросов к клонам ───────────────

/**
 * TZ clone-method Э0.1 — query-params `GET /api/v1/clones/query-log`
 * (owner/admin Org, guard OrgAdminGuard). Журнал «кто и что спрашивал у
 * клонов» с признаком grounded/отказ.
 *
 *   - `cloneTargetId` — фильтр по конкретному клону (personId/roleId);
 *   - `limit` — default 50, max 200;
 *   - `offset` — default 0.
 */
export const CloneQueryLogQuerySchema = z.object({
  cloneTargetId: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});
export type CloneQueryLogQuery = z.infer<typeof CloneQueryLogQuerySchema>;

/** TZ clone-method Э0.1 — одна запись журнала запросов к клону. */
export interface CloneQueryLogItemDto {
  id: string;
  /** person | role — какой клон спрашивали. */
  cloneScope: 'person' | 'role';
  /** personId (scope=person) или roleId (scope=role). */
  cloneTargetId: string;
  /** User.id спросившего. */
  userId: string;
  /** Первые 200 символов вопроса. */
  questionPreview: string;
  /** true — ответ опёрся на наблюдения; false — отказ или ответ без опоры. */
  answeredGrounded: boolean;
  /** 'topic_starved' | 'ungrounded' | null. */
  refusalReason: string | null;
  /** ISO-дата запроса. */
  createdAt: string;
}

export interface CloneQueryLogListResponseDto {
  items: CloneQueryLogItemDto[];
  total: number;
}

// ─────────────── ТЗ 2026-05-25 §9.4.7 (Фаза 7) — «Новый диалог» ───────────────

/**
 * Ответ эндпоинта `POST /api/v1/clones/persons/:personId/conversations` и
 * `POST /api/v1/clones/roles/:roleId/conversations` — создаёт пустой
 * ChatV2Conversation с `mode='clone_style'`, `scope='clone'`,
 * `scopeRefId=personId|roleId`. Возвращает её id, чтобы UI сразу открыл
 * пустой диалог с боковой панелью истории.
 */
export interface CreateCloneConversationResponseDto {
  conversationId: string;
}

// ─────────────── Раздел 7 §7.5 — «Совет бывших» (ask-all-formers) ───────────────

/** Раздел 7 §7.5 — тело запроса «спросить всех бывших носителей должности». */
export const AskAllFormersBodySchema = z.object({
  question: z
    .string({ error: 'Вопрос обязателен' })
    .trim()
    .min(3, 'Слишком короткий вопрос')
    .max(2_000, 'Слишком длинный вопрос'),
});
export type AskAllFormersBody = z.infer<typeof AskAllFormersBodySchema>;

/** Один ответ версии клона в «совете бывших». */
export interface AskAllFormersAnswerDto {
  personaId: string;
  /** roleVersion (1, 2, 3…). */
  version: number;
  /** «Клон <Должность> v<N>» (без ФИО носителя). */
  publicName: string;
  status: 'active' | 'frozen';
  /** Полный ответ клона этой версии или null при ошибке (квота/недоступна). */
  response: AskCloneResponseDto | null;
  /** Текст ошибки, если версия не ответила — иначе null. */
  error: string | null;
}

/**
 * Раздел 7 §7.5 — «совет бывших»: один вопрос → ответы всех версий клона роли
 * (текущая active + замороженные бывшие) рядом для сравнения. ФИО не выводим.
 */
export interface AskAllFormersResponseDto {
  roleId: string;
  roleName: string;
  question: string;
  answers: AskAllFormersAnswerDto[];
}
