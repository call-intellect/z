import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CoreQueueService } from '../../core-queue/core-queue.service';

/**
 * Cron-шедулер для entity-resolver: раз в 5 минут проходит по активным Org'ам
 * и enqueue'ит job'ы в `core.entity-resolver` для тех Entity, у которых нашёлся
 * хотя бы один кандидат на merge с cosine > `ENTITY_MERGE_THRESHOLD`.
 *
 * Сам merge выполняет `EntityResolverWorker` (concurrency=1) — благодаря
 * jobId=`entity_resolver_<entityId>` повторный enqueue не порождает дубль.
 *
 * NB: Cron-выражение из декоратора фиксировано (`*\/5 * * * *`) — соответствует
 * дефолту `ENTITY_RESOLVER_CRON`. ENV-значение используется только для логов
 * («ожидаемая частота»). Если потребуется иной интервал — переписать на
 * `SchedulerRegistry` вручную.
 *
 * Лимит на тик: 50 пар по всем Org'ам, чтобы не перегружать LLM-арбитра
 * (он тяжёлый и стоит денег).
 */
@Injectable()
export class EntityResolverCronService {
  private readonly logger = new Logger(EntityResolverCronService.name);
  private static readonly TICK_LIMIT = 50;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(CoreQueueService) private readonly coreQueue: CoreQueueService,
  ) {}

  /**
   * Каждые 5 минут. Если Org'ов нет / кандидатов нет — тик завершается
   * почти мгновенно.
   */
  @Cron('*/5 * * * *')
  async sweep(): Promise<void> {
    try {
      const enqueued = await this.scanAndEnqueue();
      if (enqueued > 0) {
        this.logger.debug(
          { enqueued },
          'entity-resolver-cron: enqueue завершён',
        );
      }
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'entity-resolver-cron: непойманная ошибка — повтор через 5 мин',
      );
    }
  }

  /**
   * Внутренний метод (publish для тестов / админ-эндпоинтов).
   * Возвращает число enqueue'ов.
   */
  async scanAndEnqueue(): Promise<number> {
    const threshold = this.cfg.knowledgeCore.entityMergeThreshold;
    // Активные Org'и: те, в которых есть хотя бы один membership owner/admin.
    const orgs = await this.prisma.org.findMany({
      where: {
        deletedAt: null,
        memberships: {
          some: { role: { in: ['owner', 'admin'] } },
        },
      },
      select: { id: true },
    });
    if (orgs.length === 0) return 0;

    let enqueued = 0;
    for (const org of orgs) {
      if (enqueued >= EntityResolverCronService.TICK_LIMIT) break;
      const remaining = EntityResolverCronService.TICK_LIMIT - enqueued;
      const ids = await this.findCandidatePairs(org.id, threshold, remaining);
      for (const id of ids) {
        try {
          await this.coreQueue.enqueueEntityResolver(id);
          enqueued++;
        } catch (err) {
          this.logger.warn(
            {
              entityId: id,
              err: err instanceof Error ? err.message : String(err),
            },
            'entity-resolver-cron: enqueue упал — пропускаем',
          );
        }
        if (enqueued >= EntityResolverCronService.TICK_LIMIT) break;
      }
    }
    return enqueued;
  }

  /**
   * Находим до `limit` Entity-id, у которых есть хотя бы один кандидат на
   * merge: пара (a, b) с одинаковым type, a.id < b.id (антидубль),
   * mergedIntoId IS NULL у обоих, cosine(a.embedding, b.embedding) > threshold.
   *
   * Возвращаем именно `a.id` — он попадёт в job, worker сам подгрузит
   * candidates через `findCandidates`.
   */
  private async findCandidatePairs(
    tenantId: string,
    threshold: number,
    limit: number,
  ): Promise<string[]> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ a_id: string }>>(
      `
      SELECT DISTINCT a.id AS a_id
      FROM "Entity" a
      JOIN "Entity" b
        ON a."tenantId" = b."tenantId"
       AND a.type = b.type
       AND a.id < b.id
      WHERE a."tenantId" = $1
        AND a."mergedIntoId" IS NULL
        AND b."mergedIntoId" IS NULL
        AND a.embedding IS NOT NULL
        AND b.embedding IS NOT NULL
        AND (1 - (a.embedding <=> b.embedding)) > $2
      LIMIT $3
      `,
      tenantId,
      threshold,
      limit,
    );
    return rows.map((r) => r.a_id);
  }
}
