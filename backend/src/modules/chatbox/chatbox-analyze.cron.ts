import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AdminSettingsService } from '../admin/settings/admin-settings.service';

import { ChatboxAnalyzeQueueService } from './queue/chatbox-analyze.queue.service';

/** Сколько pending-сессий забираем за один проход sweeper'а. */
const SWEEP_BATCH = 200;

/**
 * Cron-sweeper анализа закрытых сессий ChatBox (ТЗ 2026-06-05, Фаза 5).
 *
 * Каждые 5 минут добирает закрытые сессии (`endedAt != null`) со статусом
 * `pending` и ставит на них job анализа через ChatboxAnalyzeQueueService.
 * Дедуп по jobId схлопнёт повторы (сессия уже в очереди). Подстраховка на
 * случай, если producer (webhook/синк) не поставил job сразу.
 *
 * Kill-switch `chatbox.enabled` (admin settings) глушит проход. Тело обёрнуто
 * в try/catch — cron не должен падать.
 */
@Injectable()
export class ChatboxAnalyzeCron {
  private readonly logger = new Logger(ChatboxAnalyzeCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ChatboxAnalyzeQueueService)
    private readonly queue: ChatboxAnalyzeQueueService,
    @Inject(AdminSettingsService)
    private readonly adminSettings: AdminSettingsService,
    // Gauge pending-сессий (Ф3). @Optional — тесты крона без метрик не падают.
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async sweep(): Promise<void> {
    try {
      const enabled =
        (await this.adminSettings.get<boolean>('chatbox.enabled', true)) ?? true;
      if (!enabled) {
        this.logger.debug('analyze-sweep: chatbox.enabled=false — пропуск');
        return;
      }

      // Гейт по per-integration тумблеру: анализируем ТОЛЬКО орги, где
      // analysisEnabled=true. Пока выключено — синк зеркалит чаты, но LLM
      // (summary + мост в knowledge-core) не дёргаем.
      const enabledIntegrations = await this.prisma.chatboxIntegration.findMany({
        where: { analysisEnabled: true },
        select: { tenantId: true },
      });
      const enabledTenantIds = enabledIntegrations.map((i) => i.tenantId);
      if (enabledTenantIds.length === 0) {
        this.logger.debug('analyze-sweep: нет интеграций с включённым анализом — пропуск');
        return;
      }

      const sessions = await this.prisma.chatboxChatSession.findMany({
        where: {
          analysisStatus: 'pending',
          endedAt: { not: null },
          tenantId: { in: enabledTenantIds },
        },
        select: { id: true, tenantId: true },
        take: SWEEP_BATCH,
        orderBy: { endedAt: 'asc' },
      });

      let enqueued = 0;
      for (const { id, tenantId } of sessions) {
        try {
          await this.queue.enqueue(tenantId, id);
          enqueued += 1;
        } catch (err) {
          this.logger.warn(
            {
              tenantId,
              sessionId: id,
              err: err instanceof Error ? err.message : String(err),
            },
            'analyze-sweep: не удалось поставить job — пропуск',
          );
        }
      }

      // Gauge pending-сессий (Ф3): системный总 по всем org (включая те, где
      // анализ выключен — они копятся и не убывают → алёрт «копим, но не
      // анализируем»). Отдельный лёгкий count, т.к. выборка выше ограничена
      // SWEEP_BATCH и только enabled-тенантами.
      try {
        const totalPending = await this.prisma.chatboxChatSession.count({
          where: { analysisStatus: 'pending', endedAt: { not: null } },
        });
        this.metrics?.setChatboxPendingSessions(totalPending);
      } catch (gaugeErr) {
        this.logger.warn(
          { err: gaugeErr instanceof Error ? gaugeErr.message : String(gaugeErr) },
          'analyze-sweep: не удалось обновить gauge pending-сессий',
        );
      }

      this.logger.log(
        `analyze-sweep: pending=${sessions.length} enqueued=${enqueued}`,
      );
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'analyze-sweep: глобальная ошибка прохода',
      );
    }
  }
}
