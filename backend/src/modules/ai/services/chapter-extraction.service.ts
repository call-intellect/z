import { Inject, Injectable, Logger } from '@nestjs/common';

import { LlmRouterService } from './llm-router.service';
import {
  type ChapterDraft,
  CHAPTERS_TASK_TYPE,
  ChaptersArraySchema,
  buildChaptersPrompt,
} from './prompts/chapters';
import type { DialogTurn } from './prompts/common';

export interface ExtractChaptersInput {
  meetingId: string;
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
 * НЕ пишет в БД — это ответственность caller'а (`chapters.worker`).
 */
@Injectable()
export class ChapterExtractionService {
  private readonly logger = new Logger(ChapterExtractionService.name);
  private static readonly MAX_RETRIES = 3;

  constructor(@Inject(LlmRouterService) private readonly router: LlmRouterService) {}

  async extractChapters(input: ExtractChaptersInput): Promise<ChapterDraft[]> {
    const prompt = buildChaptersPrompt({
      meeting: input.meeting,
      dialog: input.dialog,
    });

    let lastError: unknown = null;
    for (let attempt = 0; attempt < ChapterExtractionService.MAX_RETRIES; attempt++) {
      const userMessage =
        attempt === 0
          ? prompt.user
          : `${prompt.user}\n\nПопытка ${attempt + 1}: предыдущий ответ не был валидным JSON-массивом глав. Верни ТОЛЬКО JSON-массив без markdown.`;
      const result = await this.router.call({
        taskType: CHAPTERS_TASK_TYPE,
        systemPrompt: prompt.system,
        userMessage,
        meetingId: input.meetingId,
        ...(input.userId !== undefined ? { userId: input.userId } : {}),
        ...(input.jobId !== undefined && input.jobId !== null
          ? { jobId: input.jobId }
          : {}),
        responseFormat: 'json',
      });
      const parsed = parseJsonChapters(result.text);
      if (!parsed.success) {
        lastError = parsed.error;
        this.logger.warn(
          { meetingId: input.meetingId, attempt, modelUsed: result.modelUsed },
          'extractChapters: invalid JSON, ретрай',
        );
        continue;
      }
      const validated = ChaptersArraySchema.safeParse(parsed.data);
      if (!validated.success) {
        lastError = validated.error;
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
