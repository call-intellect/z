import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CoreQueueService } from '../../core-queue/core-queue.service';

/**
 * SBA β-2 — KnowledgeCloneRebuildCron.
 *
 * Раз в N часов (по умолчанию `0 *\/6 * * *` — каждые 6 часов) обходит
 * всех сотрудников всех Org, у кого:
 *   - `Person.relationship='employee'` AND deletedAt IS NULL;
 *   - `lastProfileBuildAt` отсутствует ИЛИ старше 6 часов;
 *   - у Person есть активность за последнюю неделю (хотя бы 1 канонический
 *     IdeaBlock через IdeaBlockEntity).
 *
 * И ставит `RebuildKnowledgeProfileJob` через `CoreQueueService` с
 * нулевым delay (cron сам по себе уже разнесён по времени; дополнительный
 * debounce не нужен).
 *
 * NB: cron расписание читается из конфига при старте через `@Cron(...)`,
 * который требует литерала. Здесь мы используем дефолт `0 *\/6 * * *`; для
 * runtime-настройки нужно отключить cron и активировать через ENV-флаг
 * (см. paths `ENABLE_KNOWLEDGE_CLONE_CRON` в будущем).
 */
@Injectable()
export class KnowledgeCloneRebuildCron {
  private readonly logger = new Logger(KnowledgeCloneRebuildCron.name);
  /** Минимальный интервал между rebuild'ами одного Person'а — 6 часов. */
  private static readonly MIN_REBUILD_INTERVAL_MS = 6 * 60 * 60 * 1000;
  /** Окно «есть свежая активность» — 7 дней. */
  private static readonly FRESH_ACTIVITY_DAYS = 7;
  /** Лимит Person'ов за один проход (защита от взрыва LLM-нагрузки). */
  private static readonly MAX_PERSONS_PER_SWEEP = 200;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CoreQueueService) private readonly coreQueue: CoreQueueService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  @Cron('0 */6 * * *')
  async sweep(): Promise<void> {
    try {
      const summary = await this.runOnce();
      this.logger.debug(
        summary,
        'knowledge-clone-rebuild.cron: проход завершён',
      );
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'knowledge-clone-rebuild.cron: непойманная ошибка — повтор по расписанию',
      );
    }
  }

  /** Public — для возможного админ-эндпоинта / ручного запуска. */
  async runOnce(): Promise<{
    orgsScanned: number;
    personsEnqueued: number;
    enqueueFailures: number;
  }> {
    // Используем ENV для прогона минимального интервала — для тестов можно
    // понизить; пока завязано на cfg.knowledgeClone (не используется здесь
    // напрямую, но оставляем DI на месте на будущее).
    void this.cfg;

    const orgs = await this.prisma.org.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });

    let personsEnqueued = 0;
    let enqueueFailures = 0;

    const cutoff = new Date(
      Date.now() - KnowledgeCloneRebuildCron.MIN_REBUILD_INTERVAL_MS,
    );
    const freshSince = new Date(
      Date.now() -
        KnowledgeCloneRebuildCron.FRESH_ACTIVITY_DAYS * 24 * 60 * 60 * 1000,
    );

    for (const org of orgs) {
      const candidates = await this.prisma.person.findMany({
        where: {
          tenantId: org.id,
          relationship: 'employee',
          deletedAt: null,
          // Person.entityId — обязательно, иначе нечего находить в Слое 2.
          entityId: { not: null },
          OR: [
            { lastProfileBuildAt: null },
            { lastProfileBuildAt: { lt: cutoff } },
          ],
        },
        select: { id: true, entityId: true },
        take: KnowledgeCloneRebuildCron.MAX_PERSONS_PER_SWEEP,
      });
      if (candidates.length === 0) continue;

      const entityIds = candidates
        .map((c) => c.entityId)
        .filter((id): id is string => typeof id === 'string');
      if (entityIds.length === 0) continue;

      // Кого из candidates трогали свежие блоки за неделю.
      const freshMentions = await this.prisma.ideaBlockEntity.findMany({
        where: {
          entityId: { in: entityIds },
          role: { in: ['subject', 'mentioned'] },
          block: {
            tenantId: org.id,
            status: 'canonical',
            createdAt: { gte: freshSince },
          },
        },
        select: { entityId: true },
      });
      const freshEntities = new Set(freshMentions.map((m) => m.entityId));

      for (const cand of candidates) {
        if (!cand.entityId || !freshEntities.has(cand.entityId)) continue;
        try {
          await this.coreQueue.enqueueRebuildKnowledgeProfile({
            tenantId: org.id,
            personId: cand.id,
            reason: 'knowledge-clone.cron',
            delayMs: 0,
          });
          personsEnqueued++;
        } catch (err) {
          enqueueFailures++;
          this.logger.warn(
            {
              personId: cand.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'knowledge-clone-rebuild.cron: enqueue упал — пропускаю',
          );
        }
      }
    }

    return {
      orgsScanned: orgs.length,
      personsEnqueued,
      enqueueFailures,
    };
  }
}
