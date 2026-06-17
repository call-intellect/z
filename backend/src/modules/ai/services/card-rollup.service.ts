import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { pickPrimarySummary } from '../utils/pick-primary-summary';

import { LlmRouterService } from './llm-router.service';
import {
  CARD_ROLLUP_MAX_RECENT_MEETINGS,
  type CardRollupMeetingDigest,
  buildCardRollupSystemPrompt,
  buildCardRollupUserMessage,
} from './prompts/card-rollup';

@Injectable()
export class CardRollupService {
  private readonly logger = new Logger(CardRollupService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  async rollupCard(cardId: string): Promise<{
    skipped: boolean;
    reason?: string;
    summaryLength?: number;
  }> {
    const card = await this.prisma.card.findUnique({ where: { id: cardId } });
    if (!card) {
      this.logger.warn({ cardId }, 'card-rollup: карточка не найдена');
      this.metrics?.incCardRollupRun({ status: 'skipped' });
      return { skipped: true, reason: 'card_not_found' };
    }
    if (card.deletedAt !== null) {
      this.logger.debug({ cardId }, 'card-rollup: карточка удалена — пропуск');
      this.metrics?.incCardRollupRun({ status: 'skipped' });
      return { skipped: true, reason: 'card_deleted' };
    }

    const meetings = await this.prisma.meeting.findMany({
      where: {
        cardId,
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      take: CARD_ROLLUP_MAX_RECENT_MEETINGS,
      include: {
        aiResult: {
          select: { summaryFast: true, summary: true },
        },
      },
    });

    const eligible = meetings
      .filter((m) => (m.aiResult ? pickPrimarySummary(m.aiResult).length > 0 : false))
      .reverse();

    if (eligible.length === 0) {
      await this.prisma.card.update({
        where: { id: cardId },
        data: { summaryCache: null, summaryUpdatedAt: new Date() },
      });
      this.logger.log({ cardId }, 'card-rollup: нет встреч с saммари — кэш очищен');
      this.metrics?.incCardRollupRun({ status: 'skipped' });
      return { skipped: true, reason: 'no_summaries' };
    }

    const digests: CardRollupMeetingDigest[] = eligible.map((m, idx) => ({
      index: idx + 1,
      date: m.createdAt.toISOString().slice(0, 10),
      type: String(m.type),
      title: m.title,
      summary: m.aiResult ? pickPrimarySummary(m.aiResult) : '',
    }));

    const systemPrompt = buildCardRollupSystemPrompt(card.kind);
    const userMessage = buildCardRollupUserMessage({
      cardName: card.name,
      cardKind: card.kind,
      contactName: card.contactName,
      contactEmail: card.contactEmail,
      meetings: digests,
    });

    const result = await this.llm.call({
      taskType: 'card-rollup',
      systemPrompt,
      userMessage,
      tenantId: card.tenantId,
      userId: card.ownerId,
      sourceRef: { type: 'card', id: cardId },
    });

    const text = result.text.trim();
    await this.prisma.card.update({
      where: { id: cardId },
      data: {
        summaryCache: text || null,
        summaryUpdatedAt: new Date(),
      },
    });

    this.logger.log(
      {
        cardId,
        meetings: eligible.length,
        model: result.modelUsed,
        chars: text.length,
      },
      'card-rollup: готов',
    );
    this.metrics?.incCardRollupRun({ status: 'success' });
    return { skipped: false, summaryLength: text.length };
  }
}
