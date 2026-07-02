import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CoreQueueService } from '../../core-queue/core-queue.service';
import { EntityResolutionService } from '../services/entity-resolution.service';

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
 *
 * Б14 [K6]: поиск кандидатов — НЕ self-join Entity×Entity с vector-предикатом
 * в WHERE (O(n²) seq-scan каждые 5 минут), а пер-сущностный LATERAL top-1
 * через HNSW (`ORDER BY embedding <=> ... LIMIT 1`) с окном по `updatedAt`
 * (сканируем только недавно изменённые сущности — у них и мог появиться/
 * сдвинуться кандидат).
 *
 * Б29 [K6]: уже-судёные distinct-пары исключаются через negative-cache
 * (`EntityResolutionService.isEntityPairDistinct`) ДО enqueue — иначе арбитр
 * перепроверял бы те же «разные» пары каждые 5 минут (раннавей-расход LLM).
 */
@Injectable()
export class EntityResolverCronService {
  private readonly logger = new Logger(EntityResolverCronService.name);
  private static readonly TICK_LIMIT = 50;
  /**
   * Окно «недавно изменённых» сущностей (Б14): сканируем только Entity,
   * обновлённые за последние N дней. Дубли возникают на новых/обновлённых
   * сущностях; статичные старые уже прошли арбитра (или попали в negative-cache).
   */
  private static readonly LOOKBACK_DAYS = 7;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(CoreQueueService) private readonly coreQueue: CoreQueueService,
    @Inject(EntityResolutionService)
    private readonly resolution: EntityResolutionService,
  ) {}

  @Cron('*/5 * * * *')
  async sweep(): Promise<void> {
    try {
      const enqueued = await this.scanAndEnqueue();
      if (enqueued > 0) {
        this.logger.debug({ enqueued }, 'entity-resolver-cron: enqueue завершён');
      }
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'entity-resolver-cron: непойманная ошибка — повтор через 5 мин',
      );
    }
  }

  async scanAndEnqueue(): Promise<number> {
    const threshold = this.cfg.knowledgeCore.entityMergeThreshold;
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
      // Б14: пары (a, b)-кандидаты через LATERAL top-1 HNSW + окно updatedAt.
      const pairs = await this.findCandidatePairs(org.id, threshold, remaining);
      // Уникализируем по a.id: одного a.id достаточно — worker сам подгрузит
      // всех его кандидатов через findCandidates. Но negative-cache проверяем
      // по КОНКРЕТНОЙ паре (a, b), которую нашёл LATERAL.
      const seenAId = new Set<string>();
      for (const pair of pairs) {
        if (enqueued >= EntityResolverCronService.TICK_LIMIT) break;
        // Б29: пара уже судилась арбитром и признана distinct → не enqueue
        // (иначе перепроверка каждые 5 минут = раннавей-расход LLM).
        const isDistinct = await this.resolution.isEntityPairDistinct(
          pair.aId,
          pair.bId,
        );
        if (isDistinct) continue;
        if (seenAId.has(pair.aId)) continue;
        seenAId.add(pair.aId);
        try {
          await this.coreQueue.enqueueEntityResolver(pair.aId);
          enqueued++;
        } catch (err) {
          this.logger.warn(
            {
              entityId: pair.aId,
              err: err instanceof Error ? err.message : String(err),
            },
            'entity-resolver-cron: enqueue упал — пропускаем',
          );
        }
      }
    }
    return enqueued;
  }

  /**
   * Б14 [K6] — находим до `limit` пар-кандидатов (a, b) на merge БЕЗ
   * self-join'а Entity×Entity (он давал O(n²) seq-scan каждые 5 минут).
   *
   * Подход: окно по `updatedAt` (только недавно изменённые сущности) +
   * пер-сущностный LATERAL top-1 через HNSW-индекс. Для каждой «внешней»
   * сущности `a` ищем её ОДНОГО ближайшего соседа `b` того же tenant/type
   * (`ORDER BY embedding <=> a.embedding LIMIT 1`) с cosine > threshold и
   * a.id < b.id (антидубль). Это использует HNSW (быстрый KNN) вместо
   * полного декартова произведения.
   *
   * Возвращаем пары (a.id, b.id): `a.id` попадёт в job (worker сам подгрузит
   * всех кандидатов), а `b.id` нужен cron'у для проверки negative-cache (Б29).
   */
  private async findCandidatePairs(
    tenantId: string,
    threshold: number,
    limit: number,
  ): Promise<Array<{ aId: string; bId: string }>> {
    const since = new Date(
      Date.now() -
        EntityResolverCronService.LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    );
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ a_id: string; b_id: string }>
    >(
      `
      SELECT a.id AS a_id, nb.id AS b_id
      FROM "Entity" a
      CROSS JOIN LATERAL (
        SELECT b.id, b.embedding <=> a.embedding AS distance
        FROM "Entity" b
        WHERE b."tenantId" = a."tenantId"
          AND b.type = a.type
          AND b.type <> 'person'
          AND b.id <> a.id
          AND b."mergedIntoId" IS NULL
          AND b.embedding IS NOT NULL
        ORDER BY b.embedding <=> a.embedding
        LIMIT 1
      ) nb
      WHERE a."tenantId" = $1
        AND a.type <> 'person'
        AND a."mergedIntoId" IS NULL
        AND a.embedding IS NOT NULL
        AND a."updatedAt" >= $2
        AND a.id < nb.id
        AND (1 - nb.distance) > $3
      LIMIT $4
      `,
      tenantId,
      since,
      threshold,
      limit,
    );
    return rows.map((r) => ({ aId: r.a_id, bId: r.b_id }));
  }
}
