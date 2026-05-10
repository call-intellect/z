import { Inject, Injectable, Logger } from '@nestjs/common';

import { LlmRouterService } from './llm-router.service';
import type { DialogTurn } from './prompts/common';
import {
  type TaskExtracted,
  TASKS_STRUCTURED_TASK_TYPE,
  TasksExtractedArraySchema,
  buildTasksStructuredPrompt,
} from './prompts/tasks-structured';

export interface ExtractTasksInput {
  meetingId: string;
  /** tenantId: Org встречи. */
  tenantId: string | null;
  meeting: { id: string; type: string; title: string };
  dialog: DialogTurn[];
  jobId?: string | null;
  userId?: string;
  /**
   * Минимальный confidence: ниже — отбрасываем. Дефолт 0.5.
   */
  minConfidence?: number;
}

/**
 * Извлекает action items со структурой `Task` (с привязкой к фрагменту,
 * цитатой и confidence).
 *
 * НЕ пишет в БД — это `tasks-extract.worker`.
 */
@Injectable()
export class TaskExtractionService {
  private readonly logger = new Logger(TaskExtractionService.name);
  private static readonly MAX_RETRIES = 3;
  private static readonly DEFAULT_MIN_CONFIDENCE = 0.5;

  constructor(@Inject(LlmRouterService) private readonly router: LlmRouterService) {}

  async extractTasks(input: ExtractTasksInput): Promise<TaskExtracted[]> {
    const prompt = buildTasksStructuredPrompt({
      meeting: input.meeting,
      dialog: input.dialog,
    });
    const minConfidence =
      input.minConfidence ?? TaskExtractionService.DEFAULT_MIN_CONFIDENCE;

    let lastError: unknown = null;
    for (let attempt = 0; attempt < TaskExtractionService.MAX_RETRIES; attempt++) {
      const userMessage =
        attempt === 0
          ? prompt.user
          : `${prompt.user}\n\nПопытка ${attempt + 1}: предыдущий ответ не был валидным JSON-массивом задач. Верни ТОЛЬКО JSON-массив без markdown.`;
      const result = await this.router.call({
        taskType: TASKS_STRUCTURED_TASK_TYPE,
        systemPrompt: prompt.system,
        userMessage,
        tenantId: input.tenantId,
        meetingId: input.meetingId,
        ...(input.userId !== undefined ? { userId: input.userId } : {}),
        ...(input.jobId !== undefined && input.jobId !== null
          ? { jobId: input.jobId }
          : {}),
        responseFormat: { type: 'json_object' },
        sourceRef: { type: 'meeting', id: input.meetingId },
      });
      const parsed = parseJsonTasks(result.text);
      if (!parsed.success) {
        lastError = parsed.error;
        this.logger.warn(
          { meetingId: input.meetingId, attempt, modelUsed: result.modelUsed },
          'extractTasks: invalid JSON, ретрай',
        );
        continue;
      }
      const validated = TasksExtractedArraySchema.safeParse(parsed.data);
      if (!validated.success) {
        lastError = validated.error;
        this.logger.warn(
          { meetingId: input.meetingId, attempt, issues: validated.error.issues.length },
          'extractTasks: schema mismatch, ретрай',
        );
        continue;
      }
      return validated.data.filter((t) => t.confidence >= minConfidence);
    }
    throw new Error(
      `extractTasks: не удалось извлечь после ${TaskExtractionService.MAX_RETRIES} попыток: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
  }
}

function parseJsonTasks(
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
