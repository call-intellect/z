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
}

export interface PromptOutput {
  system: string;
  user: string;
}

/**
 * Превращает диалог в текст для user-сообщения.
 * Формат: `[mm:ss-mm:ss] Speaker: text`.
 */
export function turnsToText(dialog: DialogTurn[]): string {
  return dialog
    .map((t) => `[${formatTime(t.startSec)}-${formatTime(t.endSec)}] ${t.speaker}: ${t.text}`)
    .join('\n');
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

// ─────────────────── общие Zod-схемы (used by tasks/follow-up) ─────────────

export const TaskItemSchema = z
  .object({
    title: z.string(),
    assignee: z.string().nullable(),
    dueDate: z.string().nullable(),
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
