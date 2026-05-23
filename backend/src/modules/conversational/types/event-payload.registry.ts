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
    conversationId: z.string().min(1),
    messageId: z.string().min(1),
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

const registry = new Map<string, z.ZodTypeAny>([
  ['probe.question', ProbeQuestionPayloadSchema],
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
