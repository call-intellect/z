import { Inject, Injectable, Logger } from '@nestjs/common';
import type { MeetingType } from '@prisma/client';

import { LlmRouterService } from '../../ai/services/llm-router.service';
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
 */
@Injectable()
export class SummaryExtractorV2Service {
  private readonly logger = new Logger(SummaryExtractorV2Service.name);

  constructor(
    @Inject(LlmRouterService) private readonly router: LlmRouterService,
  ) {}

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
    const result = await this.router.call({
      taskType: SUMMARY_V2_TASK_TYPE,
      systemPrompt: prompt.system,
      userMessage: prompt.user,
      tenantId: input.tenantId,
      meetingId: input.meetingId,
      ...(input.userId ? { userId: input.userId } : {}),
      ...(input.jobId ? { jobId: input.jobId } : {}),
      // Markdown — обычный текст, не json.
      responseFormat: { type: 'text' },
      sourceRef: { type: 'meeting', id: input.meetingId },
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
