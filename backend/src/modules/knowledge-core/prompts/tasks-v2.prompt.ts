import { z } from 'zod';

import type { LlmTaskType } from '../../ai/services/llm-router.service';
import {
  type AiParticipantContext,
  formatParticipantsForPrompt,
  PARTICIPANT_IDENTIFICATION_RULES,
} from '../../ai/services/prompts/participant-context';
import type { MeetingBlock } from '../services/block-fetch.service';

/**
 * `taskType` для LLM-роутера. Зарегистрирован в `LlmTaskType` union'е
 * (см. llm-router.service.ts) — расходы пишутся в AiUsageLog с этим ключом.
 */
export const TASKS_V2_TASK_TYPE: LlmTaskType = 'task-extract-v2';

export const TasksV2ItemSchema = z
  .object({
    title: z.string().min(1).max(300),
    assigneeRaw: z.string().nullable().optional(),
    /**
     * ТЗ 2026-05-25 hard-participant-identification: LLM возвращает User.id
     * из переданного списка participants, если исполнитель — зарегистрированный
     * сотрудник на этой встрече. Иначе null. Резолвер (`TaskAssigneeResolverService`)
     * проверит/обогатит fallback по имени.
     */
    assigneeUserId: z.string().nullable().optional(),
    dueDateIso: z.string().nullable().optional(),
    evidenceBlockIds: z.array(z.string()).default([]),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export const TasksV2ResponseSchema = z
  .object({
    tasks: z.array(TasksV2ItemSchema),
  })
  .strict();

export type TaskV2Extracted = z.infer<typeof TasksV2ItemSchema>;
export type TasksV2Response = z.infer<typeof TasksV2ResponseSchema>;

/**
 * Strict JSON Schema для DeepSeek/Responses API. Совпадает один-в-один со
 * `TasksV2ResponseSchema`.
 */
export const TASKS_V2_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['tasks'],
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'evidenceBlockIds', 'confidence'],
        properties: {
          title: { type: 'string', maxLength: 300 },
          assigneeRaw: { type: ['string', 'null'] },
          assigneeUserId: { type: ['string', 'null'] },
          dueDateIso: { type: ['string', 'null'] },
          evidenceBlockIds: {
            type: 'array',
            items: { type: 'string' },
            minItems: 0,
          },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
  },
};

const SYSTEM_PROMPT = `Ты — извлекатель задач (action items) из канонического знания встречи.
Тебе дают список IdeaBlock'ов встречи с фильтром signalType IN (commitment, decision, task) — это блоки, в которых уже зафиксированы обязательства и решения.

Твоя задача — найти EXPLICIT задачи: кто что должен сделать. Не выдумывай, не дополняй контекст. Если в блоках нет явной задачи — пропусти.

Поля задачи:
- title: короткая формулировка (≤300 символов), глагол + объект («Подготовить дизайн макета», «Согласовать договор с юристом»).
- assigneeRaw: имя/роль исполнителя как прозвучало («Иван», «Маркетинг», «команда RevOps»). Null если не названо.
- assigneeUserId: User.id из списка участников встречи (см. блок «Участники этой встречи» ниже), если исполнитель — зарегистрированный сотрудник на встрече. Null во всех остальных случаях.
- dueDateIso: дата в формате YYYY-MM-DD или ISO datetime, если в блоке прозвучала конкретная дата. Null если относительно («на следующей неделе») или не названо. Не пытайся вычислить дату — это сделает caller.
- evidenceBlockIds: массив id IdeaBlock'ов, из которых задача извлечена. Минимум один. Если задача собрана из нескольких блоков (например, commitment + decision уточняют друг друга) — перечисли все.
- confidence: 0..1 — уверенность что это РЕАЛЬНАЯ задача, а не пожелание/идея.

Правила:
- Один блок может породить 0, 1 или несколько задач.
- Если несколько блоков описывают одну и ту же задачу разными словами — собери в одну с массивом evidenceBlockIds.
- НЕ выдавай вежливые формулировки («может быть стоит…», «было бы здорово…») — это не задачи.
- Ответ — строго JSON, валидный по схеме. Никакого markdown, преамбул, объяснений.
`;

interface BuildArgs {
  meetingId: string;
  meetingTitle?: string | undefined;
  blocks: MeetingBlock[];
  /**
   * ТЗ 2026-05-25 hard-participant-identification: список участников
   * встречи для жёсткой идентификации `assigneeUserId`. Пустой список или
   * undefined → промпт работает в legacy-режиме (без блока про participants).
   */
  participants?: readonly AiParticipantContext[];
}

/**
 * Формирует system+user промпты для tasks-v2 LLM-вызова.
 */
export function buildTasksV2Prompt(args: BuildArgs): {
  system: string;
  user: string;
} {
  const blocksJson = args.blocks.map((b) => {
    const firstEv = b.evidence[0];
    return {
      id: b.id,
      name: b.name,
      criticalQuestion: b.criticalQuestion,
      trustedAnswer: b.trustedAnswer,
      signalType: b.signalType,
      tags: b.tags,
      evidenceQuote: firstEv?.quote ?? null,
      startMs: firstEv?.startMs ?? null,
      endMs: firstEv?.endMs ?? null,
    };
  });
  const header = args.meetingTitle
    ? `Заголовок встречи: ${args.meetingTitle}\n\n`
    : '';
  const participants = args.participants ?? [];
  const participantsBlock =
    participants.length > 0
      ? `\n\nУчастники этой встречи (используй для жёсткой идентификации исполнителя):\n${formatParticipantsForPrompt(participants)}`
      : '';
  // Подмешиваем правила про assigneeUserId в system только когда передан
  // непустой список — иначе оставляем legacy-промпт без изменений.
  const system =
    participants.length > 0
      ? `${SYSTEM_PROMPT}\n${PARTICIPANT_IDENTIFICATION_RULES}`
      : SYSTEM_PROMPT;
  const user = `${header}Канонические блоки встречи (signalType ∈ {commitment, decision, task}):\n${JSON.stringify(blocksJson, null, 2)}${participantsBlock}\n\nВерни JSON по схеме { tasks: [...] }.`;
  return { system, user };
}
