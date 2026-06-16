import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../../common/prisma/prisma.service';
import { AdminSettingsService } from '../admin/settings/admin-settings.service';

import { BitrixIngestService } from './bitrix-ingest.service';
import { BitrixAnalyzeQueueService } from './queue/bitrix-analyze.queue.service';

/** Сколько pending-сессий забираем за один проход sweeper'а. */
const SWEEP_BATCH = 200;

/**
 * Cron-sweeper анализа закрытых сессий-суток Bitrix-диалогов
 * (ТЗ 2026-06-17-bitrix24-source-sync, Ф4). По образцу `ChatboxAnalyzeCron`.
 *
 * **Раз в сутки в 00:00** добирает закрытые сессии (`endedAt != null`,
 * `analysisStatus='pending'`) и ставит на них job анализа. «Закрываем день» —
 * ключевая механика: каждый синк нарезает сквозной диалог на сессии-сутки,
 * крон ночью анализирует завершённые. Дедуп по jobId схлопнёт повторы.
 *
 * Kill-switch `bitrix.enabled` (admin settings) + per-integration
 * `analysisEnabled` глушат проход (синк зеркалит диалоги, но LLM не дёргаем).
 * Тело в try/catch — cron не должен падать.
 */
@Injectable()
export class BitrixAnalyzeCron {
  private readonly logger = new Logger(BitrixAnalyzeCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BitrixAnalyzeQueueService)
    private readonly queue: BitrixAnalyzeQueueService,
    @Inject(AdminSettingsService)
    private readonly adminSettings: AdminSettingsService,
    @Inject(BitrixIngestService)
    private readonly ingest: BitrixIngestService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async sweep(): Promise<void> {
    try {
      const enabled =
        (await this.adminSettings.get<boolean>('bitrix.enabled', true)) ?? true;
      if (!enabled) {
        this.logger.debug('bitrix analyze-sweep: bitrix.enabled=false — пропуск');
        return;
      }

      // Гейт по per-integration тумблеру: анализируем ТОЛЬКО орги, где
      // analysisEnabled=true (и интеграция подключена). Пока выключено — синк
      // зеркалит диалоги, но LLM (rollup + мост в knowledge-core) не дёргаем.
      const enabledIntegrations = await this.prisma.bitrixIntegration.findMany({
        where: { analysisEnabled: true, status: 'connected' },
        select: { tenantId: true },
      });
      const enabledTenantIds = [
        ...new Set(
          enabledIntegrations
            .map((i) => i.tenantId)
            .filter((t): t is string => t !== null),
        ),
      ];
      if (enabledTenantIds.length === 0) {
        this.logger.debug(
          'bitrix analyze-sweep: нет интеграций с включённым анализом — пропуск',
        );
        return;
      }

      const sessions = await this.prisma.bitrixDialogSession.findMany({
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
            'bitrix analyze-sweep: не удалось поставить job — пропуск',
          );
        }
      }

      // Ф4b — посуточный CRM-дайджест за закрытые дни (по enabled-тенантам).
      // Best-effort: ошибка одного тенанта не валит проход.
      let crmDays = 0;
      for (const tenantId of enabledTenantIds) {
        try {
          const { daysDigested } = await this.ingest.ingestCrmDigests(tenantId);
          crmDays += daysDigested;
        } catch (err) {
          this.logger.warn(
            {
              tenantId,
              err: err instanceof Error ? err.message : String(err),
            },
            'bitrix analyze-sweep: CRM-дайджест упал — пропуск',
          );
        }
      }

      this.logger.debug(
        `bitrix analyze-sweep: pending=${sessions.length} enqueued=${enqueued} crmDigestDays=${crmDays}`,
      );
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'bitrix analyze-sweep: глобальная ошибка прохода',
      );
    }
  }
}
