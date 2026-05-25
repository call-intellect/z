import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import {
  LlmRouterService,
  maxDataClass,
} from '../../ai/services/llm-router.service';
import {
  withInjectionGuard,
  wrapUserData,
} from '../../ai/services/prompts/common';
import {
  buildChaptersV2Prompt,
  CHAPTERS_V2_JSON_SCHEMA,
  CHAPTERS_V2_TASK_TYPE,
  ChaptersV2ResponseSchema,
  type ChapterV2Extracted,
} from '../prompts/chapters-v2.prompt';

import type { MeetingBlock } from './block-fetch.service';

const MAX_RETRIES = 3;

export interface ChaptersExtractorV2Input {
  meetingId: string;
  meetingTitle?: string;
  tenantId: string;
  blocks: MeetingBlock[];
  jobId?: string | null;
  userId?: string | null;
}

export interface ChaptersExtractorV2Result {
  chapters: ChapterV2Extracted[];
  modelUsed: string;
  blocksConsidered: number;
}

/**
 * ChaptersExtractorV2Service (Фаза 5) — нарезает канонические IdeaBlock'и
 * встречи на главы по таймкодам и тематической связности через один LLM-вызов
 * `chapter-extract-v2`.
 *
 * Не пишет в БД — это `meeting-analyze-v2.worker`.
 *
 * @deprecated С 2026-05-25 заменён на объединённый `MeetingReportFastWorker`
 * (`meeting-report-fast.worker.ts`) — один LLM-вызов на главы+задачи+резюме+
 * quality_score (см. ТЗ
 * `plans/tz/2026-05-25-meeting-report-split-from-block-ingest.md`, Фаза 6).
 * Сервис продолжает работать параллельно для A/B-сравнения ещё 2 недели;
 * пользовательский UI уже приоритезирует `MeetingChapter.extractorVersion='fast'`.
 */
@Injectable()
export class ChaptersExtractorV2Service {
  private readonly logger = new Logger(ChaptersExtractorV2Service.name);

  constructor(
    @Inject(LlmRouterService) private readonly router: LlmRouterService,
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg?: TypedConfigService,
  ) {}

  /**
   * ТЗ 2026-05-24 §4 (F1.2) — мастер-флаг защиты от prompt-injection.
   */
  private isPromptInjectionGuardEnabled(): boolean {
    try {
      return this.cfg?.aiFeatures.promptInjectionGuardEnabled !== false;
    } catch {
      return true;
    }
  }

  async extract(
    input: ChaptersExtractorV2Input,
  ): Promise<ChaptersExtractorV2Result> {
    if (input.blocks.length === 0) {
      return { chapters: [], modelUsed: 'n/a', blocksConsidered: 0 };
    }

    const prompt = buildChaptersV2Prompt({
      meetingId: input.meetingId,
      meetingTitle: input.meetingTitle,
      blocks: input.blocks,
    });
    const validBlockIds = new Set(input.blocks.map((b) => b.id));

    // ТЗ 2026-05-24 §4 (F1.2) — обернуть user (блоки) в маркеры; retry-suffix
    // (системное сообщение оркестратора) остаётся СНАРУЖИ маркеров.
    const guardOn = this.isPromptInjectionGuardEnabled();
    const guardedSystem = guardOn ? withInjectionGuard(prompt.system) : prompt.system;
    const wrappedUserBase = guardOn ? wrapUserData(prompt.user) : prompt.user;
    let lastError: unknown = null;
    let modelUsed = 'unknown';
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const userMessage =
        attempt === 0
          ? wrappedUserBase
          : `${wrappedUserBase}\n\nПопытка ${attempt + 1}: предыдущий ответ не был валидным JSON по схеме. Верни ТОЛЬКО JSON-объект {chapters: [...]}.`;
      const result = await this.router.call({
        taskType: CHAPTERS_V2_TASK_TYPE,
        systemPrompt: guardedSystem,
        userMessage,
        tenantId: input.tenantId,
        meetingId: input.meetingId,
        ...(input.userId ? { userId: input.userId } : {}),
        ...(input.jobId ? { jobId: input.jobId } : {}),
        responseFormat: {
          type: 'json_schema',
          name: 'chapters_v2',
          schema: CHAPTERS_V2_JSON_SCHEMA,
          strict: true,
        },
        sourceRef: { type: 'meeting', id: input.meetingId },
        // Фаза 11: dataClass = max по входным блокам.
        dataClass: maxDataClass(input.blocks.map((b) => b.dataClass)),
      });
      modelUsed = result.modelUsed;
      const parsed = parseJsonObject(result.text);
      if (!parsed.success) {
        lastError = parsed.error;
        this.logger.warn(
          { meetingId: input.meetingId, attempt, modelUsed },
          'chapters-extractor-v2: invalid JSON, ретрай',
        );
        continue;
      }
      const validated = ChaptersV2ResponseSchema.safeParse(parsed.data);
      if (!validated.success) {
        lastError = validated.error;
        this.logger.warn(
          {
            meetingId: input.meetingId,
            attempt,
            issues: validated.error.issues.length,
          },
          'chapters-extractor-v2: schema mismatch, ретрай',
        );
        continue;
      }
      // Сортируем по startMs (LLM уже должен — но защищаемся) +
      // фильтруем чужие blockId.
      const sorted = [...validated.data.chapters]
        .map((c) => ({
          ...c,
          evidenceBlockIds: c.evidenceBlockIds.filter((id) =>
            validBlockIds.has(id),
          ),
        }))
        .filter((c) => c.endMs >= c.startMs)
        .sort((a, b) => a.startMs - b.startMs);
      return {
        chapters: sorted,
        modelUsed,
        blocksConsidered: input.blocks.length,
      };
    }
    throw new Error(
      `chapters-extractor-v2: не удалось извлечь после ${MAX_RETRIES} попыток: ${
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
