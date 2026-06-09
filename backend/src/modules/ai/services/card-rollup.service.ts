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

/**
 * Бизнес-сервис генерации rollup-саммари по карточке.
 *
 * Дёргается из `card-rollup.worker` (после ai_ready встречи в карточке)
 * или вручную из endpoint'а на странице карточки.
 *
 * Алгоритм:
 *   1. Загрузить карточку (если deletedAt — выходим).
 *   2. Загрузить до 20 последних встреч карточки с `aiResult.summary`.
 *   3. Пропустить встречи без summary (ai ещё не отработал) — иначе модель
 *      получит «пустое саммари» и галюцинирует.
 *   4. Если живых встреч 0 — пишем `summaryCache=null` (нечего показывать).
 *   5. Иначе — LLM-вызов и запись в `Card.summaryCache` + `summaryUpdatedAt`.
 */
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
        // Р6: каноническая сводка = summaryFast ?? summaryV2 ?? summary —
        // тянем все три поля, иначе pickPrimarySummary молча упадёт на legacy.
        aiResult: {
          select: { summaryFast: true, summaryV2: true, summary: true },
        },
      },
    });

    // Берём только встречи с непустой канонической сводкой, переворачиваем —
    // от старых к новым.
    const eligible = meetings
      .filter((m) => (m.aiResult ? pickPrimarySummary(m.aiResult).length > 0 : false))
      .reverse();

    if (eligible.length === 0) {
      // Снимаем устаревший кэш — лучше пусто, чем «не про эту карточку».
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
