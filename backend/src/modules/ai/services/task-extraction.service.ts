import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';

import { LlmRouterService } from './llm-router.service';
import type { DialogTurn } from './prompts/common';
import type { AiParticipantContext } from './prompts/participant-context';
import {
  type TaskExtracted,
  TASKS_STRUCTURED_TASK_TYPE,
  TasksExtractedArraySchema,
  TasksStructuredResponseSchema,
  buildTasksStructuredJsonSchema,
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
  /**
   * ТЗ 2026-05-25 hard-participant-identification — список участников встречи
   * с userId/fullName. Если непустой, LLM получит блок «Участники этой встречи»
   * и сможет вернуть `assigneeUserId` для каждой задачи.
   */
  participants?: readonly AiParticipantContext[];
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

  constructor(
    @Inject(LlmRouterService) private readonly router: LlmRouterService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  async extractTasks(input: ExtractTasksInput): Promise<TaskExtracted[]> {
    const participants = input.participants ?? [];
    const prompt = buildTasksStructuredPrompt({
      meeting: input.meeting,
      dialog: input.dialog,
      ...(participants.length > 0 ? { participants } : {}),
    });
    // ТЗ 2026-05-25 hard-participant-identification (gap закрыт):
    // JSON Schema собирается динамически — когда передан непустой список
    // participants, в схему включается поле `assigneeUserId` (nullable string).
    // На strict-провайдерах (OpenAI/DeepSeek) LLM теперь может вернуть это
    // поле через `json_schema strict`. Без participants — поведение
    // идентично прежнему (legacy schema без поля).
    const responseSchema = buildTasksStructuredJsonSchema(
      participants.length > 0 ? participants : null,
    );
    const minConfidence =
      input.minConfidence ?? TaskExtractionService.DEFAULT_MIN_CONFIDENCE;

    let lastError: unknown = null;
    for (let attempt = 0; attempt < TaskExtractionService.MAX_RETRIES; attempt++) {
      const userMessage =
        attempt === 0
          ? prompt.user
          : `${prompt.user}\n\nПопытка ${attempt + 1}: предыдущий ответ не был валидным JSON. Верни ТОЛЬКО JSON-объект {"tasks":[...]} без markdown.`;
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
        // T7-F6: strict JSON Schema. Wrapper `{ tasks: [...] }` нужен потому,
        // что DeepSeek/OpenAI strict требуют object на верхнем уровне.
        // Если провайдер не поддерживает (Ollama / KIE) — LlmRouter перейдёт
        // на следующего.
        responseFormat: {
          type: 'json_schema',
          name: 'tasks_structured_response',
          strict: true,
          schema: responseSchema,
        },
        sourceRef: { type: 'meeting', id: input.meetingId },
      });
      const parsed = parseJsonTasks(result.text);
      if (!parsed.success) {
        lastError = parsed.error;
        this.metrics?.incPromptInvalidResponse({
          taskType: TASKS_STRUCTURED_TASK_TYPE,
          model: result.modelUsed,
          reason: 'json_parse',
        });
        this.logger.warn(
          { meetingId: input.meetingId, attempt, modelUsed: result.modelUsed },
          'extractTasks: invalid JSON, ретрай',
        );
        continue;
      }
      // T7-F6: гибко принимаем и { tasks: [...] } (новый формат), и голый
      // массив (legacy, если провайдер игнорирует schema).
      const wrappedResult = TasksStructuredResponseSchema.safeParse(parsed.data);
      const validated = wrappedResult.success
        ? { success: true as const, data: wrappedResult.data.tasks }
        : TasksExtractedArraySchema.safeParse(parsed.data);
      if (!validated.success) {
        lastError = validated.error;
        this.metrics?.incPromptInvalidResponse({
          taskType: TASKS_STRUCTURED_TASK_TYPE,
          model: result.modelUsed,
          reason: 'schema',
        });
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
