import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';

import { LlmRouterService } from './llm-router.service';
import {
  CHAPTERS_JSON_SCHEMA,
  type ChapterDraft,
  CHAPTERS_TASK_TYPE,
  ChaptersArraySchema,
  ChaptersResponseSchema,
  buildChaptersPrompt,
} from './prompts/chapters';
import { applyInputGuards, type DialogTurn } from './prompts/common';

export interface ExtractChaptersInput {
  meetingId: string;
  /** tenantId: Org встречи. Извлекается caller'ом из meeting.tenantId. */
  tenantId: string | null;
  meeting: { id: string; type: string; title: string };
  dialog: DialogTurn[];
  jobId?: string | null;
  userId?: string;
}

/**
 * Извлекает главы (`MeetingChapter[]`) из диалога через LlmRouter.
 *
 * Для каждой главы возвращает `startMs/endMs/title/summary/order`.
 * До 3 попыток на парсинг — если LLM вернул невалидный JSON.
 *
 * T7-F6: использует `responseFormat: { type: 'json_schema', strict: true }`
 * с обёрткой `{ chapters: [...] }`. Если результат — голый массив (legacy
 * провайдер, который ответил без обёртки) — гибко принимаем оба варианта.
 *
 * НЕ пишет в БД — это ответственность caller'а (`chapters.worker`).
 */
@Injectable()
export class ChapterExtractionService {
  private readonly logger = new Logger(ChapterExtractionService.name);
  private static readonly MAX_RETRIES = 3;

  constructor(
    @Inject(LlmRouterService) private readonly router: LlmRouterService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  async extractChapters(input: ExtractChaptersInput): Promise<ChapterDraft[]> {
    const prompt = buildChaptersPrompt({
      meeting: input.meeting,
      dialog: input.dialog,
    });
    // A2-AI: вход — сырой транскрипт встречи. Оборачиваем user в маркеры
    // данных + ASR-нота. Сервис без TypedConfigService — глобальный kill-switch
    // здесь не гейтит (enabled по умолчанию true). Делаем один раз ДО цикла,
    // чтобы маркеры обрамляли только транскрипт, а ретрай-добавка шла снаружи.
    const guarded = applyInputGuards(prompt.system, prompt.user, {
      injection: true,
      asr: true,
    });

    let lastError: unknown = null;
    for (let attempt = 0; attempt < ChapterExtractionService.MAX_RETRIES; attempt++) {
      const userMessage =
        attempt === 0
          ? guarded.user
          : `${guarded.user}\n\nПопытка ${attempt + 1}: предыдущий ответ не был валидным JSON. Верни ТОЛЬКО JSON-объект {"chapters":[...]} без markdown.`;
      const result = await this.router.call({
        taskType: CHAPTERS_TASK_TYPE,
        systemPrompt: guarded.system,
        userMessage,
        tenantId: input.tenantId,
        meetingId: input.meetingId,
        ...(input.userId !== undefined ? { userId: input.userId } : {}),
        ...(input.jobId !== undefined && input.jobId !== null
          ? { jobId: input.jobId }
          : {}),
        // T7-F6: strict JSON Schema. Если провайдер не поддерживает
        // (Ollama / KIE / GRSAI) — LlmRouter перейдёт на следующего.
        responseFormat: {
          type: 'json_schema',
          name: 'chapters_response',
          strict: true,
          schema: CHAPTERS_JSON_SCHEMA,
        },
        sourceRef: { type: 'meeting', id: input.meetingId },
      });
      const parsed = parseJsonChapters(result.text);
      if (!parsed.success) {
        lastError = parsed.error;
        this.metrics?.incPromptInvalidResponse({
          taskType: CHAPTERS_TASK_TYPE,
          model: result.modelUsed,
          reason: 'json_parse',
        });
        this.logger.warn(
          { meetingId: input.meetingId, attempt, modelUsed: result.modelUsed },
          'extractChapters: invalid JSON, ретрай',
        );
        continue;
      }
      // T7-F6: гибко принимаем и { chapters: [...] } (новый формат), и голый
      // массив (legacy, если провайдер проигнорировал schema).
      const wrappedResult = ChaptersResponseSchema.safeParse(parsed.data);
      const validated = wrappedResult.success
        ? { success: true as const, data: wrappedResult.data.chapters }
        : ChaptersArraySchema.safeParse(parsed.data);
      if (!validated.success) {
        lastError = validated.error;
        this.metrics?.incPromptInvalidResponse({
          taskType: CHAPTERS_TASK_TYPE,
          model: result.modelUsed,
          reason: 'schema',
        });
        this.logger.warn(
          { meetingId: input.meetingId, attempt, issues: validated.error.issues.length },
          'extractChapters: schema mismatch, ретрай',
        );
        continue;
      }
      return [...validated.data]
        .sort((a, b) => a.order - b.order)
        .map((c, i) => ({ ...c, order: i }));
    }
    throw new Error(
      `extractChapters: не удалось извлечь после ${ChapterExtractionService.MAX_RETRIES} попыток: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
  }
}

function parseJsonChapters(
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
  // ```json ... ``` или ``` ... ```.
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/u.exec(trimmed);
  if (fence && typeof fence[1] === 'string') return fence[1];
  return trimmed;
}
