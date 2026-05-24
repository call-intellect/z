import { z } from 'zod';

import type { LlmTool } from '../llm.types';

/**
 * Один turn диалога после merge.worker. Используется как input для всех промптов.
 */
export interface DialogTurn {
  speaker: string;
  text: string;
  startSec: number;
  endSec: number;
}

/**
 * Сообщение из in-meeting чата (DataChannel LiveKit, сохранённое в БД).
 * Подмешивается в промпт опционально (см. `INCLUDE_ROOM_CHAT_IN_AI`).
 *
 * Источник — `MeetingRoomMessage` (см. ТЗ `meeting-room-chat`).
 */
export interface RoomChatMessage {
  /** ISO timestamp отправки. */
  sentAt: string;
  /** Имя автора на момент отправки (денормализовано). */
  authorName: string;
  /** Текст сообщения. */
  content: string;
}

/**
 * Контекст встречи для промпта. Передаётся в `buildPrompt(input)`.
 * Все опциональные поля — потому что для теста удобно мокать минимально.
 */
export interface PromptInput {
  meeting: {
    id: string;
    title: string;
    type: string;
    startedAt?: Date | null;
    endedAt?: Date | null;
    customPrompt?: string | null;
  };
  dialog: DialogTurn[];
  /**
   * Опциональный блок чата встречи. Если присутствует — `turnsToText`
   * допишет блок «Чат встречи» в конец user-сообщения; если отсутствует —
   * никаких упоминаний нет (промпт идентичен историческому).
   */
  roomChat?: RoomChatMessage[];
}

export interface PromptOutput {
  system: string;
  user: string;
}

/**
 * Превращает диалог в текст для user-сообщения.
 * Формат: `[mm:ss-mm:ss] Speaker: text`.
 *
 * Если передан непустой `roomChat` — после диалога добавляется блок
 * «Чат встречи» с сообщениями в формате `[HH:MM] @authorName: content`.
 * Это даёт LLM дополнительный контекст: ссылки, ID, имена в Slack/TG,
 * договорённости, оставшиеся только в чате.
 */
export function turnsToText(
  dialog: DialogTurn[],
  roomChat?: readonly RoomChatMessage[],
): string {
  const dialogText = dialog
    .map((t) => `[${formatTime(t.startSec)}-${formatTime(t.endSec)}] ${t.speaker}: ${t.text}`)
    .join('\n');
  if (!roomChat || roomChat.length === 0) return dialogText;
  const chatText = roomChat
    .map((m) => `[${formatChatTime(m.sentAt)}] @${m.authorName}: ${m.content}`)
    .join('\n');
  return `${dialogText}\n\nЧат встречи:\n${chatText}`;
}

/**
 * Форматирует ISO timestamp сообщения чата в `HH:MM` (UTC).
 * UTC выбран осознанно: разные участники могут быть в разных таймзонах,
 * а тайминги транскрипта — относительные. Здесь нам важен порядок и
 * идентификация момента, а не локальное время.
 *
 * Экспортируется, чтобы custom-prompt в `analyze.worker` форматировал
 * блок чата идентично `turnsToText`.
 */
export function formatChatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

function formatTime(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${pad2(m)}:${pad2(s)}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Превращает Zod-схему в Anthropic tool. Ручная конвертация —
 * `zod-to-json-schema` не используем, чтобы держать минимум зависимостей и
 * иметь полный контроль над схемой (Anthropic требует строгий объект).
 *
 * Принимает массив пар [field, type-spec], потому что Zod typeguard'ы
 * непрозрачны. Спецификацию пишем вручную.
 */
export function buildExtractTool(
  toolName: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
): LlmTool {
  return {
    name: toolName,
    description,
    input_schema: {
      type: 'object',
      properties,
      required,
      additionalProperties: false,
    },
  };
}

/**
 * Хэлпер для повторных полей.
 */
export const fieldString = { type: 'string' as const };
export const fieldNullableString = { type: ['string', 'null'] as const };
export const fieldStringArray = {
  type: 'array' as const,
  items: { type: 'string' as const },
};
export const fieldEnum = (values: readonly string[]) =>
  ({ type: 'string' as const, enum: [...values] }) as const;
export const fieldNullableEnum = (values: readonly string[]) =>
  ({ type: ['string', 'null'] as const, enum: [...values, null] }) as const;

/**
 * Базовый wrap для system-промпта с инструкциями про tool-use.
 */
export function withToolInstructions(systemBody: string, toolName: string): string {
  return `${systemBody}\n\nВызови инструмент \`${toolName}\` с заполненными полями. Не возвращай свободный текст.`;
}

/**
 * Системная заметка для LLM о том, что в user-сообщении может присутствовать
 * блок «Чат встречи» — переписка из in-meeting текстового чата участников.
 * Подмешивается в system только если в `PromptInput.roomChat` есть сообщения.
 */
export const ROOM_CHAT_SYSTEM_NOTE = `В user-сообщении после блока «Диалог» может идти блок «Чат встречи» — это переписка участников в текстовом чате во время встречи.
Формат строк чата: \`[HH:MM] @{authorName}: {content}\` (время — UTC).

Используй этот блок как дополнительный источник:
  - решений и договорённостей, которые остались только в чате;
  - ссылок (URL) на документы, репозитории, доски — участники часто кидают их именно туда;
  - технических деталей (ID, IP, имена сервисов), которые сложно произнести вслух;
  - имён, ников в Slack/Telegram/etc, упомянутых в чате.

Если ссылаешься на сообщение из чата — цитируй явно: «в чате [HH:MM] @{authorName}: "{content}"».
Не дублируй информацию: если что-то уже было сказано в транскрипте, не повторяй её отдельно из чата.`;

/**
 * Дописывает `ROOM_CHAT_SYSTEM_NOTE` к system, если в input есть непустой
 * `roomChat`. No-op для встреч без чата — system промпт остаётся идентичным
 * историческому. Пользоваться так:
 *
 *     system: withRoomChatNote(SUMMARY_SYSTEM, input.roomChat),
 */
export function withRoomChatNote(
  systemBody: string,
  roomChat?: readonly RoomChatMessage[],
): string {
  if (!roomChat || roomChat.length === 0) return systemBody;
  return `${systemBody}\n\n${ROOM_CHAT_SYSTEM_NOTE}`;
}

// ─────────────────── общие Zod-схемы (used by tasks/follow-up) ─────────────

export const TaskItemSchema = z
  .object({
    title: z.string(),
    assignee: z.string().nullable(),
    dueDate: z.string().nullable(),
    // Wave 3 / Tracker Phase 3 part B — расширенные поля для
    // meeting-extract-actions. Все опциональные/nullable — обратная
    // совместимость с legacy `tasks`-агентом (старые модели ничего не
    // возвращают для этих полей; zod пропустит без ошибки благодаря
    // `.optional()`).
    suggestedAssigneeHint: z.string().nullable().optional(),
    suggestedDueDate: z.string().nullable().optional(),
    suggestedPriority: z
      .enum(['urgent', 'high', 'medium', 'low'])
      .nullable()
      .optional(),
    // Wave 3 — НЕ ограничиваем .min/.max строго: defensive против
    // галлюцинаций LLM, который может вернуть 1.0001 или -0.05. Caller
    // обязан clamp'ить в [0,1] перед сохранением в БД (Decimal(4,3)).
    confidence: z.number().optional(),
    sourceQuote: z.string().optional(),
  })
  .strict();
export type TaskItem = z.infer<typeof TaskItemSchema>;

export const TasksSchema = z
  .object({
    tasks: z.array(TaskItemSchema),
  })
  .strict();

export const FollowUpSchema = z
  .object({
    subject: z.string(),
    body: z.string(),
  })
  .strict();
