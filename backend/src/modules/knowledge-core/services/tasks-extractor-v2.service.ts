import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  LlmRouterService,
  maxDataClass,
} from '../../ai/services/llm-router.service';
import {
  buildTasksV2Prompt,
  TASKS_V2_JSON_SCHEMA,
  TASKS_V2_TASK_TYPE,
  TasksV2ResponseSchema,
  type TaskV2Extracted,
} from '../prompts/tasks-v2.prompt';

import type { MeetingBlock } from './block-fetch.service';

/**
 * SignalType, по которым отбираем блоки для tasks-v2. Только эти три типа
 * семантически могут породить задачу: commitment (явное обязательство),
 * decision (принятое решение, требующее действия), task (если LLM сразу
 * пометил блок как задачу — редкий случай).
 *
 * Совпадает с SIGNAL_TYPE_VALUES из prompts/block-ingest.prompt.ts, но
 * берём только подмножество. SignalType enum 'task' может не существовать
 * в схеме — фильтр работает по includes на уровне TS.
 */
const TASK_SIGNAL_TYPES = ['commitment', 'decision'] as const;

const MIN_CONFIDENCE = 0.5;
const MAX_RETRIES = 3;

export interface TasksExtractorV2Input {
  meetingId: string;
  meetingTitle?: string;
  tenantId: string;
  blocks: MeetingBlock[];
  jobId?: string | null;
  userId?: string | null;
}

export interface TasksExtractorV2Result {
  tasks: TaskV2Extracted[];
  modelUsed: string;
  blocksConsidered: number;
}

/**
 * TasksExtractorV2Service (Фаза 5) — извлекает explicit-задачи из канонических
 * IdeaBlock'ов встречи через LLM-вызов `task-extract-v2`.
 *
 * Не пишет в БД — это ответственность `meeting-analyze-v2.worker`.
 */
@Injectable()
export class TasksExtractorV2Service {
  private readonly logger = new Logger(TasksExtractorV2Service.name);

  constructor(
    @Inject(LlmRouterService) private readonly router: LlmRouterService,
  ) {}

  async extract(input: TasksExtractorV2Input): Promise<TasksExtractorV2Result> {
    const candidateBlocks = input.blocks.filter((b) =>
      (TASK_SIGNAL_TYPES as readonly string[]).includes(b.signalType),
    );
    if (candidateBlocks.length === 0) {
      return { tasks: [], modelUsed: 'n/a', blocksConsidered: 0 };
    }

    const prompt = buildTasksV2Prompt({
      meetingId: input.meetingId,
      meetingTitle: input.meetingTitle,
      blocks: candidateBlocks,
    });
    const validBlockIds = new Set(candidateBlocks.map((b) => b.id));

    let lastError: unknown = null;
    let modelUsed = 'unknown';
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const userMessage =
        attempt === 0
          ? prompt.user
          : `${prompt.user}\n\nПопытка ${attempt + 1}: предыдущий ответ не был валидным JSON по схеме. Верни ТОЛЬКО JSON-объект {tasks: [...]}.`;
      const result = await this.router.call({
        taskType: TASKS_V2_TASK_TYPE,
        systemPrompt: prompt.system,
        userMessage,
        tenantId: input.tenantId,
        meetingId: input.meetingId,
        ...(input.userId ? { userId: input.userId } : {}),
        ...(input.jobId ? { jobId: input.jobId } : {}),
        responseFormat: {
          type: 'json_schema',
          name: 'tasks_v2',
          schema: TASKS_V2_JSON_SCHEMA,
          strict: true,
        },
        sourceRef: { type: 'meeting', id: input.meetingId },
        // Фаза 11: dataClass = max по входным блокам (commitment/decision).
        dataClass: maxDataClass(candidateBlocks.map((b) => b.dataClass)),
      });
      modelUsed = result.modelUsed;
      const parsed = parseJsonObject(result.text);
      if (!parsed.success) {
        lastError = parsed.error;
        this.logger.warn(
          { meetingId: input.meetingId, attempt, modelUsed },
          'tasks-extractor-v2: invalid JSON, ретрай',
        );
        continue;
      }
      const validated = TasksV2ResponseSchema.safeParse(parsed.data);
      if (!validated.success) {
        lastError = validated.error;
        this.logger.warn(
          {
            meetingId: input.meetingId,
            attempt,
            issues: validated.error.issues.length,
          },
          'tasks-extractor-v2: schema mismatch, ретрай',
        );
        continue;
      }
      const accepted = validated.data.tasks
        .filter((t) => t.confidence >= MIN_CONFIDENCE)
        .map((t) => ({
          ...t,
          // Защита: отфильтровать blockId, не входящие в исходный набор
          // (LLM любит выдумывать). Если все ссылки выпали — задача всё равно
          // принимается (в Task.evidenceBlockIds попадёт пустой массив).
          evidenceBlockIds: t.evidenceBlockIds.filter((id) => validBlockIds.has(id)),
        }));
      return {
        tasks: accepted,
        modelUsed,
        blocksConsidered: candidateBlocks.length,
      };
    }
    throw new Error(
      `tasks-extractor-v2: не удалось извлечь после ${MAX_RETRIES} попыток: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
  }
}

function parseJsonObject(
  raw: string,
): { success: true; data: unknown } | { success: false; error: Error } {
  const stripped = stripCodeFence(raw);
  try {
    return { success: true, data: JSON.parse(stripped) };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/u.exec(trimmed);
  if (fence && typeof fence[1] === 'string') return fence[1];
  return trimmed;
}
