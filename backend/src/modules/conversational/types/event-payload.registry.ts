import { z } from 'zod';

/**
 * Schema-registry для `Notification.payload` per-`eventType`.
 *
 * Каждый потребитель (probe-agent в β-5, curation в α-4, etc.) регистрирует
 * свою схему через `registerEventPayloadSchema(eventType, schema)` или
 * добавляет её сюда. `ConversationalService.sendNotification` валидирует
 * входной payload по этой схеме перед вставкой в БД.
 *
 * Если eventType не зарегистрирован — допускается любой JSON-объект
 * (либеральный режим). Это позволяет потребителям подключаться к слою
 * α-1 без обязательного обновления registry.
 */

const ProbeQuestionPayloadSchema = z
  .object({
    question: z.string().min(1).max(4_000),
    context: z.string().max(8_000).optional(),
    /** Опц. список валидных вариантов ответа (для closed-form probe'ов). */
    options: z.array(z.string().min(1).max(200)).max(20).optional(),
    /** Опц. источник probe'а (для атрибуции в UI). */
    askedBy: z.string().max(100).optional(),
  })
  .strict();

// Probe Фаза 3 — батч-дайджест отложенных probe (queued_digest → ProbeDigestCron).
const ProbeDigestPayloadSchema = z
  .object({
    items: z
      .array(
        z.object({
          question: z.string().min(1).max(400),
          objectTitle: z.string().max(200).optional(),
          probeEventId: z.string(),
        }),
      )
      .min(1)
      .max(20),
    total: z.number().int().nonnegative(),
    /** Человеческий собранный текст (его рендерят каналы и кабинет). */
    summary: z.string().max(4_000).optional(),
  })
  .strict();

// Probe Фаза 6 — видимое следствие: подтверждение «ваш ответ записан».
const ProbeAnswerAckPayloadSchema = z
  .object({
    text: z.string().min(1).max(400),
    objectTitle: z.string().max(200).optional(),
    probeEventId: z.string().optional(),
    /** Дубль text для generic-рендера (кабинет читает payload.summary). */
    summary: z.string().max(400).optional(),
  })
  .strict();

const CurationPendingPayloadSchema = z
  .object({
    resourceType: z.string().min(1),
    resourceId: z.string().min(1),
    summary: z.string().min(1).max(2_000),
    confidence: z.number().min(0).max(1).optional(),
    actionUrl: z.string().max(2_000).optional(),
  })
  .strict();

const SystemMessagePayloadSchema = z
  .object({
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(8_000),
    severity: z.enum(['info', 'warning', 'error']).default('info'),
    actionUrl: z.string().max(2_000).optional(),
  })
  .strict();

/**
 * SBA α-6 — payload для probe-events от специалистов Слоя 3.
 *
 * `specialistName` — стабильный идентификатор специалиста ('3-4-project-customer'
 *  и т.п. согласно RouterService.SPECIALIST).
 * `reason` — машинно-читаемый код причины (`card.missing_owner`,
 *  `card.missing_deadline`, `card.merge_suggestion`, `card.outdated_summary`, ...);
 *  фронт мапит код в локализованный заголовок.
 * `message` — человекочитаемое описание на русском (готово к показу). 2000 char limit.
 * `suggestedActions` — короткие подсказки действий («назначить ответственного»,
 *  «добавить дедлайн»). UI рендерит их как кнопки/quick-replies.
 * `cardId` / `blockIds` — контекстные ID, чтобы UI мог сразу открыть карточку.
 *
 * Используется до появления ProbeService в β-5. После — ProbeService будет
 * валидировать тот же payload, но возьмёт ответственность за выбор канала.
 */
const SpecialistProbePayloadSchema = z
  .object({
    specialistName: z.string().min(1).max(80),
    reason: z.string().min(1).max(80),
    message: z.string().min(1).max(2_000),
    suggestedActions: z.array(z.string().min(1).max(200)).max(5).optional(),
    cardId: z.string().max(80).optional(),
    blockIds: z.array(z.string().min(1).max(80)).max(20).optional(),
    actionUrl: z.string().max(2_000).optional(),
  })
  .strict();

/**
 * SBA α-5: payload для outbound chat-ответа. Используется
 * `ConversationalService.sendChatReply` при отправке assistant-сообщения
 * обратно пользователю через тот же канал, что и вопрос.
 *
 * `text` — сжатый snippet ответа (для каналов с ограничением длины —
 * Telegram 4096, email — без ограничения). `citationsCount` — справочно
 * для каналов, где не отрисовываются inline-цитаты. Полный текст +
 * citations доступны через `GET /api/v1/chat-v2/conversations/:id`.
 */
const ChatAnswerPayloadSchema = z
  .object({
    // C-1 (2026-06-12): допускаем '' — confirm/quota/error-ответы моста
    // помощника не имеют ConciergeMessage/conversation (раньше Zod молча
    // ронял отправку → тишина в канале). Мост подставляет синтетические
    // значения, но защита в глубину — схема тоже не должна бросать.
    conversationId: z.string(),
    messageId: z.string(),
    text: z.string().min(1).max(16_000),
    citationsCount: z.number().int().min(0).default(0),
    /** Опц. mode ответа (factual/synthetic/clone_style) — для UI-индикатора. */
    mode: z.enum(['factual', 'synthetic', 'clone_style']).optional(),
    /** Опц. подсказка про противоречия (uncertaintyNote). */
    uncertaintyNote: z.string().max(2_000).optional(),
  })
  .strict();

/** Открытый payload «всё, что не нашли» — допускаем любой объект. */
const LiberalPayloadSchema = z.record(z.string(), z.unknown());

/**
 * SBA β-5 — payload для closing-loop уведомлений автора и поддержавших идеи
 * при изменении её статуса (`idea.status_changed`). См. sub-ТЗ §7.
 */
const IdeaStatusChangedPayloadSchema = z
  .object({
    ideaId: z.string().min(1),
    statement: z.string().min(1).max(4_000),
    oldStatus: z.string().min(1).max(40),
    newStatus: z.string().min(1).max(40),
    reason: z.string().max(4_000).nullable().optional(),
    /** Готовый title из `idea-status-summarize` (LLM). Опционально. */
    title: z.string().max(200).optional(),
    /** Готовый body из `idea-status-summarize` (LLM). Опционально. */
    body: z.string().max(2_000).optional(),
    actionUrl: z.string().max(2_000).optional(),
  })
  .strict();

/**
 * SBA β-8 — payload для morning/evening checkin prompt'а.
 *
 * `kind` ∈ 'checkin' (используется CheckinResponseHandler в фильтре).
 * `checkInKind` ∈ 'morning'|'evening' (что мы спрашиваем).
 * `personId` / `dateLocal` — нужны handler'у, чтобы upsert'нуть DailyCheckIn
 *   без повторной загрузки контекста.
 * `question` — готовый текст вопроса (короткий, для отображения в канале).
 */
const CheckinPromptPayloadSchema = z
  .object({
    kind: z.literal('checkin'),
    checkInKind: z.enum(['morning', 'evening']),
    personId: z.string().min(1).max(80),
    dateLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    question: z.string().min(1).max(2_000),
    actionUrl: z.string().max(2_000).optional(),
  })
  .strict();

/**
 * SBA δ-2 — ProactiveWatcher.
 *
 * Payload отправляемого `Notification(eventType='proactive.notification')`.
 * Recipient — userId, выбранный в правиле (assignee/owner/manager и т.п.).
 *
 * `ruleType` / `severity` — фасет правила (decision_no_owner / insight_no_mitigation /
 * ... × low|medium|high). `proactiveNotificationId` — FK на ProactiveNotification
 * (для UI dismiss action). `title` / `body` — текст от LLM `proactive-message-craft`.
 * `actionUrl` — куда отправить пользователя по клику (карточка, страница списка).
 */
const ProactiveNotificationPayloadSchema = z
  .object({
    proactiveNotificationId: z.string().min(1).max(80),
    ruleType: z.string().min(1).max(60),
    severity: z.enum(['low', 'medium', 'high']),
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(4_000),
    actionUrl: z.string().max(2_000).optional(),
  })
  .strict();

/**
 * T8 (2026-05-24) — @-упоминание пользователя в комментарии задачи.
 *
 * Payload отправляемого `Notification(eventType='issue.mention')`. Recipient —
 * userId упомянутого. Каналы по умолчанию (in_app, telegram_bot, max_bot) —
 * заданы политикой ниже; вызывающий может передать `preferredChannelKinds`.
 *
 * `snippet` — обрезанный текст комментария (до 200 символов), для предпросмотра
 * в push/inbox без открытия задачи. Полный текст доступен через
 * `GET /api/v1/issues/:issueId/comments`.
 */
const IssueMentionPayloadSchema = z
  .object({
    issueId: z.string().min(1).max(80),
    commentId: z.string().min(1).max(80),
    byUserId: z.string().min(1).max(80),
    snippet: z.string().min(1).max(500),
    /** Опц. — для UI бейджа «упомянул @user в TKR-123». */
    issueIdentifier: z.string().max(40).optional(),
    issueTitle: z.string().max(500).optional(),
  })
  .strict();

/**
 * SBA β-8.1 — недельная сводка операционного директора.
 *
 * Payload `Notification(eventType='operations.weekly_digest')`. Recipient —
 * userId роли coo/owner Org'а. `digestId` ссылается на
 * `WeeklyOperationsDigest.id` (для drill-down из канала на страницу
 * `/dashboard/operations/weekly`).
 */
const OperationsWeeklyDigestPayloadSchema = z
  .object({
    digestId: z.string().min(1).max(80),
    weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    weekEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(4_000),
    actionUrl: z.string().max(2_000).optional(),
  })
  .strict();

/**
 * ТЗ coo-orphan-agents Ф8 — ежедневная сводка операционного директора.
 * Payload Notification(eventType='operations.daily_digest'). Recipient — userId
 * роли coo/owner. digestId → DailyOperationsDigest.id (drill-down
 * `/dashboard/operations/daily?date=`).
 */
const OperationsDailyDigestPayloadSchema = z
  .object({
    digestId: z.string().min(1).max(80),
    dateLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(4_000),
    actionUrl: z.string().max(2_000).optional(),
  })
  .strict();

/**
 * Goals OKR v2 Фаза 4 — еженедельный пульс целей.
 *
 * Payload `Notification(eventType='goals.pulse')`. Recipient — userId роли
 * owner/coo Org'а. `digestId` ссылается на `WeeklyGoalsPulseDigest.id`,
 * `isoWeek` — `YYYY-WXX` (drill-down на `/goals`).
 */
const GoalsPulsePayloadSchema = z
  .object({
    digestId: z.string().min(1).max(80),
    isoWeek: z.string().regex(/^\d{4}-W\d{2}$/),
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(4_000),
    actionUrl: z.string().max(2_000).optional(),
  })
  .strict();

/**
 * TZ-1 Фаза 5 (daily-value-engine) — месячная витрина value-recap.
 *
 * Payload `Notification(eventType='operations.monthly_recap')`. Recipient —
 * userId роли owner/coo Org'а. `snapshotId` ссылается на
 * `ValueRecapSnapshot.id` (drill-down на `/dashboard/operations/value-recap`),
 * `periodYm` — `YYYY-MM`. `body` — human-readable narrative (только твёрдые
 * данные, без выдуманных рублей — Р6).
 */
const OperationsMonthlyRecapPayloadSchema = z
  .object({
    snapshotId: z.string().min(1).max(80),
    periodYm: z.string().regex(/^\d{4}-\d{2}$/),
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(4_000),
    actionUrl: z.string().max(2_000).optional(),
  })
  .strict();

/**
 * ТЗ 2026-05-26 (clone-access-grant-admin-api) §5 — payload уведомления
 * `clone.access_granted`. Отправляется получателю гранта (`grantedToUserId`)
 * один раз, при успешном POST `/api/v1/admin/clones/access-grants`.
 *
 * `cloneLabel` — публичное имя клона ('Клон Маркетолога v3' или Person.name),
 * чтобы канал мог отрисовать карточку без дозапроса. `grantedByName` — имя
 * админа, выдавшего грант (для контекста: «Алексей выдал тебе доступ к ...»).
 *
 * Не отправляется при revoke/extend — это admin-операции, пользователь
 * остаётся в неведении (см. §5.1).
 */
const CloneAccessGrantedPayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    body: z
      .object({
        cloneType: z.enum(['person', 'role']),
        cloneRefId: z.string().min(1).max(80),
        cloneLabel: z.string().min(1).max(200),
        grantedByUserId: z.string().min(1).max(80),
        grantedByName: z.string().min(1).max(200),
        grantedAt: z.string().datetime(),
        expiresAt: z.string().datetime().nullable(),
      })
      .strict(),
  })
  .strict();

/**
 * ТЗ 2026-05-29 telegram-self-initiated-checkins §Backend.11 — payload
 * подтверждения от бота для самоинициированного плана/отчёта. После
 * успешного `processSelfInitiated` бот отвечает «✅ Принял утренний план...».
 *
 * Поля для шаблона `formatCheckinAck`:
 *   - `kind` — какой чек-ин (для выбора шаблона);
 *   - `wasReplace` — true если запись на (person, date, kind) уже была;
 *   - `plansCount` / `donesCount` / `blockersCount` — сводка для текста;
 *   - `lowParserConfidence` — fallback-шаблон «не уверен в разборке».
 */
const CheckinAckPayloadSchema = z
  .object({
    kind: z.enum(['morning', 'evening']),
    wasReplace: z.boolean(),
    plansCount: z.number().int().min(0),
    donesCount: z.number().int().min(0),
    blockersCount: z.number().int().min(0),
    lowParserConfidence: z.boolean(),
  })
  .strict();

/**
 * Ф1 «Стоп-молчание» (ТЗ 2026-06-11 assistant-channels) — подтверждение
 * приёма свободной заметки (free_note). Отправляется
 * `ConversationalFreeNoteBridge` после успешного `ingestFreeNote`, чтобы
 * человек в канале (Telegram/MAX/кабинет) видел: заметка не потерялась.
 * `text` — готовая строка для рендера («Записал в память Коры 🧠»).
 */
const NoteAckPayloadSchema = z
  .object({
    text: z.string().min(1).max(500),
  })
  .strict();

/**
 * Calendar MVP (2026-05-25) — payload `event.reminder` для напоминания
 * о событии календаря. Доставляется через ConversationalService.sendNotification
 * по каналу telegram_bot / push / email.
 *
 * `eventId` / `eventTitle` / `startAtIso` — нужны клиенту канала для
 * рендеринга карточки. `offsetMin` — за сколько минут до начала это напоминание
 * (для текста «через 15 минут начнётся ...»). `location` — опц. (для UI).
 * `actionUrl` — куда отправить по клику (страница события в /me/calendar).
 */
const EventReminderPayloadSchema = z
  .object({
    eventId: z.string().min(1).max(80),
    eventTitle: z.string().min(1).max(300),
    startAtIso: z.string().min(1).max(40),
    offsetMin: z.number().int().min(0).max(60 * 24 * 7),
    location: z.string().max(300).nullable().optional(),
    actionUrl: z.string().max(2_000).optional(),
  })
  .strict();

/**
 * Action Center B3 (2026-06-02) — payload повторяющегося напоминания о
 * pending-подтверждениях. Доставляется `PendingActionsReminderCron` в
 * Telegram. Текст детерминированный (без LLM): `lines` — готовые строки
 * сводки, `actionUrl` — ссылка на /actions.
 *
 *   - `total` — общее число pending-элементов пользователя;
 *   - `bySource` — разбивка по источникам (curation/conflict/intake/probe);
 *   - `urgentCount` — сколько из показанных элементов помечены как срочные;
 *   - `lines` — до 5 готовых строк заголовков (RU, с пометкой срочного);
 *   - `actionUrl` — deep-link на страницу действий.
 *
 * Фактическая доставка идёт через `system.message` (его уже умеет
 * рендерить Telegram-адаптер); этот eventType зарегистрирован для
 * валидации payload и единообразия registry.
 */
const ActionsReminderPayloadSchema = z
  .object({
    total: z.number().int().min(0),
    bySource: z
      .object({
        curation: z.number().int().min(0),
        conflict: z.number().int().min(0),
        intake: z.number().int().min(0),
        probe: z.number().int().min(0),
      })
      .strict(),
    urgentCount: z.number().int().min(0),
    actionUrl: z.string().max(2_000),
    lines: z.array(z.string().min(1).max(500)).max(20),
  })
  .strict();

/**
 * ТЗ 2026-06-04 (meeting-identity) Фаза 3.3 — приглашение на встречу.
 *
 * Payload `Notification(eventType='meeting.invite')`. Recipient — userId
 * приглашённого сотрудника. `joinUrl` — персональная ссылка `/m/:id?inv=…`
 * (несёт inviteToken, переход проставляет identity). `meetingTitle` —
 * название встречи, `hostName` — кто пригласил. Каналы — telegram_bot
 * (приоритет) → email_smtp → in_app (каскад в sendNotification).
 */
const MeetingInvitePayloadSchema = z
  .object({
    joinUrl: z.string().min(1).max(2_000),
    meetingTitle: z.string().min(1).max(500),
    hostName: z.string().min(1).max(200),
  })
  .strict();

/**
 * ТЗ 2026-06-09 support-desk (Р-6) — дублирование сотруднику поддержки.
 *
 * `support.ticket_created` — новое обращение клиента; `support.ticket_reply` —
 * клиент ответил в своём тикете. Recipient — userId сотрудника-члена группы
 * контура. `ticketId`/`ticketNumber` — для drill-down на тикет в деске,
 * `subject` — тема (для предпросмотра), `snippet` — обрезок текста (для
 * `ticket_reply`). Текст клиента передаётся как ДАННЫЕ (не инструкция).
 */
const SupportTicketEventPayloadSchema = z
  .object({
    ticketId: z.string().min(1).max(80),
    ticketNumber: z.string().min(1).max(40),
    subject: z.string().min(1).max(300),
    snippet: z.string().max(2_000).optional(),
    actionUrl: z.string().max(2_000).optional(),
  })
  .strict();

const registry = new Map<string, z.ZodTypeAny>([
  ['probe.question', ProbeQuestionPayloadSchema],
  // Probe Фаза 3 — батч-дайджест отложенных probe.
  ['probe.digest', ProbeDigestPayloadSchema],
  // Probe Фаза 6 — видимое следствие ответа («ваш ответ записан»).
  ['probe.answer_acknowledged', ProbeAnswerAckPayloadSchema],
  ['curation.pending', CurationPendingPayloadSchema],
  ['system.message', SystemMessagePayloadSchema],
  ['chat.answer', ChatAnswerPayloadSchema],
  // SBA α-6 — probe-event от специалиста Слоя 3 (см. §5.4 зонтичного).
  ['specialist.probe', SpecialistProbePayloadSchema],
  // SBA β-5 — closing-loop уведомления supporter'ам идей.
  ['idea.status_changed', IdeaStatusChangedPayloadSchema],
  // SBA β-8 — morning/evening checkin prompt.
  ['checkin.prompt', CheckinPromptPayloadSchema],
  // SBA δ-2 — ProactiveWatcher (инициативное сообщение).
  ['proactive.notification', ProactiveNotificationPayloadSchema],
  // SBA β-8.1 — недельная сводка операционного директора.
  ['operations.weekly_digest', OperationsWeeklyDigestPayloadSchema],
  // ТЗ coo-orphan-agents Ф8 — ежедневная сводка COO.
  ['operations.daily_digest', OperationsDailyDigestPayloadSchema],
  // Goals OKR v2 Фаза 4 — еженедельный пульс целей.
  ['goals.pulse', GoalsPulsePayloadSchema],
  // TZ-1 Фаза 5 (daily-value-engine) — месячная витрина value-recap.
  ['operations.monthly_recap', OperationsMonthlyRecapPayloadSchema],
  // T8 (2026-05-24) — @-упоминание в комментарии задачи трекера.
  ['issue.mention', IssueMentionPayloadSchema],
  // Calendar MVP (2026-05-25) — напоминание о событии календаря.
  ['event.reminder', EventReminderPayloadSchema],
  // ТЗ 2026-05-26 — уведомление о выдаче гранта на клона.
  ['clone.access_granted', CloneAccessGrantedPayloadSchema],
  // ТЗ 2026-05-29 telegram-self-initiated-checkins — подтверждение сохранения
  // самоинициированного плана/отчёта в чек-ин.
  ['checkin.ack', CheckinAckPayloadSchema],
  // Ф1 «Стоп-молчание» (ТЗ 2026-06-11 assistant-channels) — подтверждение
  // приёма свободной заметки (free_note).
  ['note.ack', NoteAckPayloadSchema],
  // Action Center B3 — повторяющееся напоминание о pending-подтверждениях.
  ['actions.reminder', ActionsReminderPayloadSchema],
  // ТЗ 2026-06-04 (meeting-identity) Фаза 3.3 — приглашение на встречу.
  ['meeting.invite', MeetingInvitePayloadSchema],
  // ТЗ 2026-06-09 support-desk (Р-6) — дублирование сотруднику поддержки.
  ['support.ticket_created', SupportTicketEventPayloadSchema],
  ['support.ticket_reply', SupportTicketEventPayloadSchema],
]);

/** Регистрация дополнительной схемы извне (например, в `onModuleInit` потребителя). */
export function registerEventPayloadSchema(
  eventType: string,
  schema: z.ZodTypeAny,
): void {
  registry.set(eventType, schema);
}

/**
 * Валидация payload по схеме. Возвращает валидированный объект (с дефолтами).
 * При неуспехе — выбрасывает `z.ZodError`, который выше в стэке будет
 * превращён в HTTP 400 / job-error.
 */
export function validateEventPayload(
  eventType: string,
  payload: unknown,
): Record<string, unknown> {
  const schema = registry.get(eventType) ?? LiberalPayloadSchema;
  const parsed = schema.parse(payload);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `validateEventPayload: схема для eventType=${eventType} должна возвращать объект`,
    );
  }
  return parsed as Record<string, unknown>;
}
