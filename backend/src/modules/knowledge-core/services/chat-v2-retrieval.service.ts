import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

import { KnowledgeEmbeddingService } from './embedding.service';

/**
 * ChatV2RetrievalService — retrieval-слой Фазы 6 (chat v2).
 *
 * Под scope-фильтром собирает множество кандидатных blockId'ов, ранжирует их
 * по cosine-сходству с query (если есть embedding), и расширяет 1-hop через
 * `IdeaBlockLink` (active links).
 *
 * Возвращает плоский массив blockId'ов (отсортированных по score), а
 * саму выгрузку имён/evidence/entities делает уже ChatV2Service.
 *
 * Все SQL — через `$queryRawUnsafe` с массивом параметров (никогда не
 * интерполируем пользовательский ввод напрямую) — по образцу
 * search.service.ts.
 */
export type ChatV2Scope = 'org' | 'meeting' | 'card' | 'theme' | 'entity';

export interface RetrievalInput {
  tenantId: string;
  scope: ChatV2Scope;
  /**
   * scopeId обязателен для meeting/card/theme/entity. Для org игнорируется.
   */
  scopeId: string | null;
  query: string;
  limit: number;
  graphHops: number;
  /**
   * SBA α-5 dialog-layer — temporal queries («что мы знали тогда»).
   * Если задан — фильтруем pool блоков по `IdeaBlock.createdAt <= validAt`
   * (берём только то, что существовало на момент Х).
   * NULL = `now()` (без temporal-фильтра).
   */
  validAt?: Date | null;
}

export interface RankedBlockId {
  blockId: string;
  /** combined cosine + small bm25 (если cosine невозможен — только BM25). */
  score: number;
  /** True, если блок добавлен 1-hop graph-расширением (а не самим retrieval). */
  fromGraph: boolean;
}

/**
 * Сырая запись cosine-ранжирования.
 */
interface RankedRow {
  id: string;
  score: string | number | null;
}

@Injectable()
export class ChatV2RetrievalService {
  private readonly logger = new Logger(ChatV2RetrievalService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(KnowledgeEmbeddingService)
    private readonly embeddings: KnowledgeEmbeddingService,
    // Agents v2 Фаза A1 — Optional, чтобы legacy-тесты без metrics-DI
    // (например, chat-v2-retrieval-temporal.spec.ts) продолжали работать.
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  /**
   * Agents v2 Фаза A1 (2026-05-30) — bi-temporal фильтр на edges.
   * Активен только при `cfg.knowledgeCore.biTemporalEdgesEnabled === true`.
   * Возвращает Prisma `where`-фрагмент `{ AND: [...] }` или пустой объект.
   */
  private temporalEdgeWhere(validAt: Date | null | undefined): {
    AND?: Array<{
      OR: Array<
        | { validFrom: null }
        | { validFrom: { lte: Date } }
        | { validUntil: null }
        | { validUntil: { gt: Date } }
      >;
    }>;
  } {
    if (!this.isBiTemporalEnabled()) return {};
    const at = validAt ?? new Date();
    return {
      AND: [
        {
          OR: [
            { validFrom: null },
            { validFrom: { lte: at } },
          ],
        },
        {
          OR: [
            { validUntil: null },
            { validUntil: { gt: at } },
          ],
        },
      ],
    };
  }

  private isBiTemporalEnabled(): boolean {
    try {
      return this.cfg.knowledgeCore.biTemporalEdgesEnabled === true;
    } catch {
      return false;
    }
  }

  /**
   * Главный entry-point. Возвращает blockId'ы в порядке убывания релевантности.
   */
  async fetchCandidates(input: RetrievalInput): Promise<RankedBlockId[]> {
    let qvec: number[] | null = null;
    try {
      qvec = await this.embeddings.embedQuery(input.query);
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'chat-v2 retrieval: embedQuery упал — будет ранжирование по BM25/recency',
      );
    }

    // 1) Собираем pool кандидатов в зависимости от scope.
    let poolBlockIds = await this.collectPool(input);
    if (poolBlockIds.length === 0) return [];

    // SBA α-5 dialog-layer — temporal-фильтр: оставляем только блоки,
    // существовавшие на момент `validAt`. NULL/undefined = `now()` (no-op).
    if (input.validAt) {
      poolBlockIds = await this.filterByValidAt(
        input.tenantId,
        poolBlockIds,
        input.validAt,
      );
      if (poolBlockIds.length === 0) return [];
    }

    // 2) Ранжируем по cosine (если есть qvec) или возвращаем top по recency.
    const ranked = await this.rankByCosineOrRecency({
      tenantId: input.tenantId,
      blockIds: poolBlockIds,
      qvec,
      query: input.query,
      limit: input.limit,
    });
    if (ranked.length === 0) return [];

    // 3) 1-hop graph expansion (по IdeaBlockLink, status='active').
    const graphAdded =
      input.graphHops > 0
        ? await this.expandViaGraph({
            tenantId: input.tenantId,
            seedBlockIds: ranked.map((r) => r.blockId),
            knownIds: new Set(ranked.map((r) => r.blockId)),
            extraLimit: input.graphHops * 5,
            validAt: input.validAt ?? null,
          })
        : [];

    return [...ranked, ...graphAdded];
  }

  /**
   * SBA α-5 dialog-layer — temporal-фильтр пула блоков.
   * Оставляет только блоки, у которых `createdAt <= validAt` (т.е.
   * существовавшие на момент Х). Возвращает отфильтрованный массив id'ов.
   */
  private async filterByValidAt(
    tenantId: string,
    blockIds: string[],
    validAt: Date,
  ): Promise<string[]> {
    if (blockIds.length === 0) return [];
    const rows = await this.prisma.ideaBlock.findMany({
      where: {
        id: { in: blockIds },
        tenantId,
        status: 'canonical',
        createdAt: { lte: validAt },
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  // ─────────────────────────── pool по scope ───────────────────────────

  private async collectPool(input: RetrievalInput): Promise<string[]> {
    const { tenantId, scope, scopeId } = input;
    if (scope === 'org') {
      // Для org pool — все canonical-блоки тенанта. Дальше rankByCosineOrRecency
      // обрежет до limit'а через ORDER BY embedding<->qvec.
      const rows = await this.prisma.ideaBlock.findMany({
        where: { tenantId, status: 'canonical' },
        select: { id: true },
        // Лимит pool'а: 5000 — защита от org с десятками тысяч блоков.
        // Дальнейший ранжирующий SQL уже идёт по этому подмножеству.
        take: 5000,
      });
      return rows.map((r) => r.id);
    }

    if (!scopeId) {
      this.logger.warn(
        { scope, scopeId },
        'chat-v2 retrieval: scopeId обязателен для не-org scope',
      );
      return [];
    }

    if (scope === 'meeting') {
      return this.poolByMeeting(tenantId, scopeId);
    }
    if (scope === 'card') {
      return this.poolByCard(tenantId, scopeId);
    }
    if (scope === 'theme') {
      return this.poolByTheme(tenantId, scopeId);
    }
    if (scope === 'entity') {
      return this.poolByEntity(tenantId, scopeId);
    }
    const _exhaustive: never = scope;
    throw new Error(`chat-v2 retrieval: unknown scope ${String(_exhaustive)}`);
  }

  /**
   * Meeting scope: blockId'ы через RawEvent(sourceType='meeting',
   * sourceExternalId=meetingId) → IdeaBlockEvidence.rawEventId → blockId.
   * Только canonical, фильтр tenantId.
   */
  private async poolByMeeting(
    tenantId: string,
    meetingId: string,
  ): Promise<string[]> {
    const rawEvents = await this.prisma.rawEvent.findMany({
      where: {
        tenantId,
        sourceType: 'meeting',
        sourceExternalId: meetingId,
      },
      select: { id: true },
    });
    if (rawEvents.length === 0) return [];
    const evRows = await this.prisma.ideaBlockEvidence.findMany({
      where: {
        rawEventId: { in: rawEvents.map((r) => r.id) },
        block: { status: 'canonical', tenantId },
      },
      select: { blockId: true },
      take: 1000,
    });
    return uniqueIds(evRows.map((e) => e.blockId));
  }

  /**
   * Card scope: blockId'ы по двум путям.
   *  1) meetings карточки (Meeting.cardId=cardId, deletedAt=null) →
   *     RawEvent(sourceExternalId IN meetingIds) → IdeaBlockEvidence → blockId.
   *  2) entities карточки (Card.entityId, Card.relatedEntityIds) →
   *     IdeaBlockEntity.entityId → blockId.
   */
  private async poolByCard(
    tenantId: string,
    cardId: string,
  ): Promise<string[]> {
    const card = await this.prisma.card.findUnique({
      where: { id: cardId },
      select: {
        id: true,
        tenantId: true,
        deletedAt: true,
        entityId: true,
        relatedEntityIds: true,
      },
    });
    if (!card || card.deletedAt !== null || card.tenantId !== tenantId) {
      return [];
    }

    const meetingIds = (
      await this.prisma.meeting.findMany({
        where: { cardId, deletedAt: null, tenantId },
        select: { id: true },
      })
    ).map((m) => m.id);

    const blockIdSet = new Set<string>();

    if (meetingIds.length > 0) {
      const evRows = await this.prisma.ideaBlockEvidence.findMany({
        where: {
          rawEvent: {
            tenantId,
            sourceType: 'meeting',
            sourceExternalId: { in: meetingIds },
          },
          block: { status: 'canonical', tenantId },
        },
        select: { blockId: true },
        take: 1000,
      });
      for (const r of evRows) blockIdSet.add(r.blockId);
    }

    const candidateEntityIds = [
      ...(card.entityId ? [card.entityId] : []),
      ...card.relatedEntityIds,
    ];
    if (candidateEntityIds.length > 0) {
      const entRows = await this.prisma.ideaBlockEntity.findMany({
        where: {
          entityId: { in: candidateEntityIds },
          block: { status: 'canonical', tenantId },
        },
        select: { blockId: true },
        take: 1000,
      });
      for (const r of entRows) blockIdSet.add(r.blockId);
    }

    return [...blockIdSet];
  }

  /**
   * Theme scope: ThemeIdeaBlock.themeId=themeId → blockId.
   * Фильтр tenantId через theme.tenantId.
   */
  private async poolByTheme(
    tenantId: string,
    themeId: string,
  ): Promise<string[]> {
    const rows = await this.prisma.themeIdeaBlock.findMany({
      where: {
        themeId,
        theme: { tenantId, status: 'active' },
        block: { status: 'canonical', tenantId },
      },
      select: { blockId: true },
      take: 1000,
    });
    return uniqueIds(rows.map((r) => r.blockId));
  }

  /**
   * Entity scope: IdeaBlockEntity.entityId=entityId → blockId.
   * Фильтр tenantId через block.tenantId.
   */
  private async poolByEntity(
    tenantId: string,
    entityId: string,
  ): Promise<string[]> {
    // Проверим, что Entity принадлежит тенанту.
    const ent = await this.prisma.entity.findUnique({
      where: { id: entityId },
      select: { id: true, tenantId: true },
    });
    if (!ent || ent.tenantId !== tenantId) return [];

    const rows = await this.prisma.ideaBlockEntity.findMany({
      where: {
        entityId,
        block: { status: 'canonical', tenantId },
      },
      select: { blockId: true },
      take: 1000,
    });
    return uniqueIds(rows.map((r) => r.blockId));
  }

  // ─────────────────────────── ранжирование ───────────────────────────

  /**
   * Ранжирование подмножества blockIds.
   * Если qvec есть — `1 - (embedding <=> qvec)` cosine similarity.
   * Если qvec нет — сортируем по `updatedAt DESC` (recency) как fallback.
   * Возвращает ровно top-`limit`.
   */
  private async rankByCosineOrRecency(args: {
    tenantId: string;
    blockIds: string[];
    qvec: number[] | null;
    query: string;
    limit: number;
  }): Promise<RankedBlockId[]> {
    const { tenantId, blockIds, qvec, limit } = args;
    if (blockIds.length === 0) return [];

    if (qvec) {
      // Параметры — массивом, тенант и blockIds через unnest.
      const params: unknown[] = [];
      const pushParam = (v: unknown): string => {
        params.push(v);
        return `$${params.length}`;
      };
      const pTenant = pushParam(tenantId);
      const pIds = pushParam(blockIds);
      const pVec = pushParam(toVectorLiteral(qvec));
      const pLimit = pushParam(limit);
      const sql = `
        SELECT b.id,
               (1 - (b.embedding <=> ${pVec}::vector(1536))) AS score
        FROM "IdeaBlock" b
        WHERE b."tenantId" = ${pTenant}
          AND b.status = 'canonical'
          AND b.id = ANY(${pIds}::text[])
          AND b.embedding IS NOT NULL
        ORDER BY b.embedding <=> ${pVec}::vector(1536)
        LIMIT ${pLimit}
      `;
      const rows = await this.prisma.$queryRawUnsafe<RankedRow[]>(sql, ...params);
      return rows.map((r) => ({
        blockId: r.id,
        score: toFiniteNumber(r.score) ?? 0,
        fromGraph: false,
      }));
    }

    // Fallback: recency-only.
    const rows = await this.prisma.ideaBlock.findMany({
      where: {
        tenantId,
        status: 'canonical',
        id: { in: blockIds },
      },
      select: { id: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => ({
      blockId: r.id,
      score: 0,
      fromGraph: false,
    }));
  }

  // ─────────────────────────── graph expansion ───────────────────────────

  /**
   * Добавляем блоки-соседи через `IdeaBlockLink` (any direction, status='active').
   * Учитываем все типы связей — для chat'а полезны и `causes`, и `develops`,
   * и `shares_topic`, и `shares_entity`. Лимит — `extraLimit` всего.
   */
  private async expandViaGraph(args: {
    tenantId: string;
    seedBlockIds: string[];
    knownIds: Set<string>;
    extraLimit: number;
    validAt: Date | null;
  }): Promise<RankedBlockId[]> {
    const { tenantId, seedBlockIds, knownIds, extraLimit, validAt } = args;
    if (seedBlockIds.length === 0 || extraLimit <= 0) return [];

    // Agents v2 Фаза A1 — bi-temporal-фильтр edges. Активен только при
    // BI_TEMPORAL_EDGES_ENABLED=true; иначе where остаётся без AND-блока,
    // поведение совпадает с до-A1.
    const temporalWhere = this.temporalEdgeWhere(validAt);

    const linksFrom = await this.prisma.ideaBlockLink.findMany({
      where: {
        tenantId,
        status: 'active',
        fromBlockId: { in: seedBlockIds },
        ...temporalWhere,
      },
      select: { toBlockId: true, confidence: true },
      orderBy: { confidence: 'desc' },
      take: extraLimit * 3,
    });
    const linksTo = await this.prisma.ideaBlockLink.findMany({
      where: {
        tenantId,
        status: 'active',
        toBlockId: { in: seedBlockIds },
        ...temporalWhere,
      },
      select: { fromBlockId: true, confidence: true },
      orderBy: { confidence: 'desc' },
      take: extraLimit * 3,
    });

    // Метрика: считаем фактический объём passed/filtered_out.
    // Для passed — это число возвращённых строк; для filtered_out — оценка
    // через explainCount (тяжело). Здесь best-effort: считаем только passed,
    // filtered_out оставлен на отдельный snapshot-cron.
    if (this.isBiTemporalEnabled() && this.metrics) {
      const passed = linksFrom.length + linksTo.length;
      for (let i = 0; i < passed; i++) {
        this.metrics.incTemporalFilterHit({ result: 'passed' });
      }
    }

    const candidates = new Map<string, number>();
    for (const l of linksFrom) {
      if (!knownIds.has(l.toBlockId)) {
        const conf = toFiniteNumber(l.confidence) ?? 0;
        const prev = candidates.get(l.toBlockId);
        if (prev === undefined || conf > prev) {
          candidates.set(l.toBlockId, conf);
        }
      }
    }
    for (const l of linksTo) {
      if (!knownIds.has(l.fromBlockId)) {
        const conf = toFiniteNumber(l.confidence) ?? 0;
        const prev = candidates.get(l.fromBlockId);
        if (prev === undefined || conf > prev) {
          candidates.set(l.fromBlockId, conf);
        }
      }
    }
    if (candidates.size === 0) return [];

    // Топ-N по confidence.
    const sorted = [...candidates.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, extraLimit);

    // Берём блоки только canonical и в нужном тенанте. + temporal-фильтр
    // (если validAt задан) — graph-expansion тоже не должен возвращать
    // блоки из будущего относительно момента запроса.
    const blockIds = sorted.map(([id]) => id);
    const canonical = await this.prisma.ideaBlock.findMany({
      where: {
        id: { in: blockIds },
        tenantId,
        status: 'canonical',
        ...(validAt ? { createdAt: { lte: validAt } } : {}),
      },
      select: { id: true },
    });
    const valid = new Set(canonical.map((b) => b.id));

    return sorted
      .filter(([id]) => valid.has(id))
      .map(([id, conf]) => ({
        blockId: id,
        // Граф-блок получает сниженный score (под top-K cosine они стоят ниже).
        score: -1 + conf * 0.001,
        fromGraph: true,
      }));
  }
}

// ─────────────────────────── helpers ───────────────────────────

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`;
}

function toFiniteNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === 'object' && v !== null && 'toString' in v) {
    const n = Number((v as { toString: () => string }).toString());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
