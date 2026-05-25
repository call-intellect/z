import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { MeetingType } from '@prisma/client';

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
  buildSummaryV2Prompt,
  SUMMARY_V2_TASK_TYPE,
} from '../prompts/summary-v2.prompt';

import type { MeetingBlock } from './block-fetch.service';

export interface SummaryExtractorV2Input {
  meetingId: string;
  meetingTitle?: string;
  meetingType: MeetingType;
  tenantId: string;
  blocks: MeetingBlock[];
  jobId?: string | null;
  userId?: string | null;
}

export interface SummaryExtractorV2Result {
  /** Сгенерированный markdown. null если блоков не было. */
  markdown: string | null;
  modelUsed: string;
}

/**
 * SummaryExtractorV2Service (Фаза 5) — генерирует итоговую сводку встречи
 * в markdown поверх канонических IdeaBlock'ов через один LLM-вызов
 * `summary-v2`. Выбирает system-промпт по типу встречи (9 типов).
 *
 * Не пишет в БД — это `meeting-analyze-v2.worker`.
 *
 * @deprecated С 2026-05-25 заменён на объединённый `MeetingReportFastWorker`
 * (`meeting-report-fast.worker.ts`) — один LLM-вызов на главы+задачи+резюме+
 * quality_score поверх СЫРОГО транскрипта (см. ТЗ
 * `plans/tz/2026-05-25-meeting-report-split-from-block-ingest.md`, Фаза 6).
 * Сервис продолжает работать параллельно для A/B-сравнения ещё 2 недели;
 * пользовательский UI уже приоритезирует `AiResult.summaryFast`.
 */
@Injectable()
export class SummaryExtractorV2Service {
  private readonly logger = new Logger(SummaryExtractorV2Service.name);

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
    input: SummaryExtractorV2Input,
  ): Promise<SummaryExtractorV2Result> {
    if (input.blocks.length === 0) {
      return { markdown: null, modelUsed: 'n/a' };
    }
    const prompt = buildSummaryV2Prompt({
      meetingType: input.meetingType,
      meetingTitle: input.meetingTitle,
      blocks: input.blocks,
    });
    // ТЗ 2026-05-24 §4 (F1.2) — обернуть user (блоки встречи) в маркеры.
    const guardOn = this.isPromptInjectionGuardEnabled();
    const result = await this.router.call({
      taskType: SUMMARY_V2_TASK_TYPE,
      systemPrompt: guardOn ? withInjectionGuard(prompt.system) : prompt.system,
      userMessage: guardOn ? wrapUserData(prompt.user) : prompt.user,
      tenantId: input.tenantId,
      meetingId: input.meetingId,
      ...(input.userId ? { userId: input.userId } : {}),
      ...(input.jobId ? { jobId: input.jobId } : {}),
      // Markdown — обычный текст, не json.
      responseFormat: { type: 'text' },
      sourceRef: { type: 'meeting', id: input.meetingId },
      // Фаза 11: dataClass = max по входным блокам.
      dataClass: maxDataClass(input.blocks.map((b) => b.dataClass)),
      // ТЗ 2026-05-25 LLM-architecture §10.4 Find 1 — markdown-резюме встречи
      // (несколько разделов) + thinking-токены DeepSeek-Pro (primary
      // deepseek-v4-pro). Дефолт 4096 на Pro даёт обрезание.
      maxTokens: 8_000,
    });
    const markdown = result.text.trim();
    if (markdown.length === 0) {
      this.logger.warn(
        { meetingId: input.meetingId, modelUsed: result.modelUsed },
        'summary-extractor-v2: модель вернула пустой ответ',
      );
      return { markdown: null, modelUsed: result.modelUsed };
    }
    return { markdown, modelUsed: result.modelUsed };
  }
}
