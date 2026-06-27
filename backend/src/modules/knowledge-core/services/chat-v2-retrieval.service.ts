import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { buildVectorLiteral } from '../../embeddings/services/vector-literal.util';

import { KnowledgeEmbeddingService } from './embedding.service';
import { ACTIVE_LINK_FILTER } from './link-read-filter';

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
  /** Ф4 — Prisma-фрагмент доступа (buildAccessWhere). Применяется к pool-запросам.
   *  undefined/{} = без фильтра (off/shadow). Только при enforce передаётся непустой. */
  accessWhere?: Record<string, unknown>;
  /** Support-desk Ф2 — закрытый контур (support): ПОЗИТИВНЫЙ pre-filter,
   *  безусловный — независим от KNOWLEDGE_ACCESS_ENFORCEMENT (R-INV-1).
   *  Если задан — пул ретрива ограничивается блоками, у которых есть
   *  `IdeaBlockAccess` в этой группе (`blockAccess.some.groupId`), ДО
   *  ранжирования. undefined = поведение byte-identical сегодняшнему. */
  contourGroupId?: string;
  /** Query Understanding Волна 1 (Ф3 consume) — структурные recall-safe фильтры.
   *  Ф2 только переносит эти поля; SQL-фильтрацию реализует Ф3. */
  dateFrom?: Date | null;
  dateTo?: Date | null;
  signalTypes?: string[];
  entityIds?: string[];
  themeBranches?: string[];
  bitemporalActiveOnly?: boolean;
}

export interface RankedBlockId {
  blockId: string;
  /** combined cosine + small bm25 (если cosine невозможен — только BM25). */
  score: number;
  /** True, если блок добавлен 1-hop graph-расширением (а не самим retrieval). */
  fromGraph: boolean;
}

/**
 * Query Understanding Волна 1 (Ф3) — аргументы для построения структурных
 * предикатов recall-safe фильтра. Все значения регистрируются через
 * `pushParam` (никогда не интерполируем напрямую).
 */
export interface StructuralFilterArgs {
  /** `$N`-ссылка уже зарегистрированного параметра tenantId — для подзапроса
   *  themeBranch (Theme.tenantId). */
  tenantParamRef: string;
  dateFrom?: Date | null;
  dateTo?: Date | null;
  signalTypes?: string[];
  entityIds?: string[];
  themeBranches?: string[];
  bitemporalActiveOnly?: boolean;
}

/**
 * Строит массив SQL-предикатов структурного фильтра (recall-safe).
 *
 * Каждый параметр регистрируется через `pushParam` (возвращает `$N`).
 * Предикаты добавляются в фиксированном порядке: bitemporalActiveOnly →
 * signalTypes → entityIds → date → themeBranches. Пустые/отсутствующие оси
 * не дают предиката. Возвращаемый массив склеивается в общий WHERE через
 * `join(' AND ')`.
 *
 * Донор предикатов — `search.service.ts` `runHybridQuery` (:203-240), плюс
 * новый themeBranch через `ThemeIdeaBlock` + `Theme.branch`. Алиас блока — `b`.
 */
export function buildStructuralPredicates(
  args: StructuralFilterArgs,
  pushParam: (v: unknown) => string,
): string[] {
  const predicates: string[] = [];

  // bi-temporal «активные сейчас» — учитывает legacy-блоки (validUntil NULL =
  // действующий факт). Параметра не требует.
  if (args.bitemporalActiveOnly) {
    predicates.push('b."validUntil" IS NULL');
  }

  // тип сигнала — по одному pushParam на значение.
  if (args.signalTypes && args.signalTypes.length > 0) {
    const placeholders = args.signalTypes.map((s) => pushParam(s)).join(',');
    predicates.push(`b."signalType"::text IN (${placeholders})`);
  }

  // сущности — EXISTS по IdeaBlockEntity.
  if (args.entityIds && args.entityIds.length > 0) {
    const placeholders = args.entityIds.map((e) => pushParam(e)).join(',');
    predicates.push(
      `EXISTS (SELECT 1 FROM "IdeaBlockEntity" be WHERE be."blockId" = b.id AND be."entityId" IN (${placeholders}))`,
    );
  }

  // дата (Р5) — по IdeaBlockEvidence.sourceTimestamp; хотя бы одна граница
  // присутствует, когда этот предикат строится.
  if (args.dateFrom || args.dateTo) {
    const parts: string[] = [];
    if (args.dateFrom) {
      parts.push(`ev."sourceTimestamp" >= ${pushParam(args.dateFrom)}`);
    }
    if (args.dateTo) {
      parts.push(`ev."sourceTimestamp" <= ${pushParam(args.dateTo)}`);
    }
    predicates.push(
      `EXISTS (SELECT 1 FROM "IdeaBlockEvidence" ev WHERE ev."blockId" = b.id AND ${parts.join(' AND ')})`,
    );
  }

  // тема/отдел (НОВОЕ) — через ThemeIdeaBlock + Theme.branch, в рамках tenant.
  if (args.themeBranches && args.themeBranches.length > 0) {
    const placeholders = args.themeBranches.map((t) => pushParam(t)).join(',');
    predicates.push(
      `EXISTS (SELECT 1 FROM "ThemeIdeaBlock" tib JOIN "Theme" t ON t.id = tib."themeId" ` +
        `WHERE tib."blockId" = b.id AND t."tenantId" = ${args.tenantParamRef} ` +
        `AND t."branch"::text IN (${placeholders}))`,
    );
  }

  return predicates;
}

/**
 * Query Understanding Волна 1 (Ф3) — есть ли хотя бы один структурный фильтр.
 * true → ветка `rankByStructuralFilter` (recall-safe полный скан);
 * false → текущий `rankByCosineOrRecency` без регрессии (R9).
 */
export function hasStructuralFilter(input: RetrievalInput): boolean {
  return (
    !!input.dateFrom ||
    !!input.dateTo ||
    (input.signalTypes?.length ?? 0) > 0 ||
    (input.entityIds?.length ?? 0) > 0 ||
    (input.themeBranches?.length ?? 0) > 0 ||
    !!input.bitemporalActiveOnly
  );
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

    // Класс G2 — guard pgvector-литерала query-вектора (та же ветка деградации,
    // что и embed-failure выше). Все downstream-точки (collectPool HNSW,
    // rankByCosineOrRecency, rankByStructuralFilter) формируют литерал из этого
    // же `qvec` через `if (qvec)`; занулив его при reject, мы единым местом
    // переводим весь read-путь на recency/recall-safe fallback, не валя оператор
    // `<=>` (смена модели → другая размерность; битый вектор → NaN/Infinity).
    if (qvec) {
      const expectedDim = this.cfg.ai?.embeddings?.dimensions ?? 1536;
      const guard = buildVectorLiteral(qvec, expectedDim);
      if (guard.literal === null) {
        this.logger.warn(
          { reason: guard.rejectReason, actualDim: qvec.length, expectedDim },
          'chat-v2 retrieval: query-вектор отвергнут guard-ом — ранжирование по recency/BM25 (cosine пропущен)',
        );
        qvec = null;
      }
    }

    // 1) Собираем pool кандидатов в зависимости от scope.
    // Б26 [K3] — qvec прокидываем в pool: org-scope при наличии вектора берёт
    // детерминированный HNSW-срез (ORDER BY embedding <=> qvec), а не случайные
    // 5000. Остальные scope сортируются детерминированно перед take (см.
    // collectPool).
    let poolBlockIds = await this.collectPool(input, qvec);
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

    // 2) Ранжируем.
    const structural = hasStructuralFilter(input);
    let ranked: RankedBlockId[];
    if (structural) {
      // Query Understanding Волна 1 (Ф3) — recall-safe фильтрованный ретрив:
      // точный полный скан по WHERE-фильтрованному множеству, combined-score
      // ORDER BY (НЕ HNSW `ORDER BY embedding <=> qvec LIMIT`). Жёсткий
      // pre-filter на HNSW роняет recall — полный скан нет.
      ranked = await this.rankByStructuralFilter({
        tenantId: input.tenantId,
        blockIds: poolBlockIds,
        qvec,
        filters: {
          dateFrom: input.dateFrom,
          dateTo: input.dateTo,
          signalTypes: input.signalTypes,
          entityIds: input.entityIds,
          themeBranches: input.themeBranches,
          bitemporalActiveOnly: input.bitemporalActiveOnly,
        },
        limit: input.limit,
      });
    } else {
      ranked = await this.rankByCosineOrRecency({
        tenantId: input.tenantId,
        blockIds: poolBlockIds,
        qvec,
        query: input.query,
        limit: input.limit,
      });
    }
    if (ranked.length === 0) return [];

    // 3) 1-hop graph expansion (по IdeaBlockLink, status='active').
    // При структурном фильтре граф ПРОПУСКАЕМ: фильтр задаёт точное множество
    // ответа, а 1-hop-соседи вне фильтра вернули бы тихие типовые/временные
    // ошибки (совпавшие соседи и так уже в pool).
    const graphAdded =
      !structural && input.graphHops > 0
        ? await this.expandViaGraph({
            tenantId: input.tenantId,
            seedBlockIds: ranked.map((r) => r.blockId),
            knownIds: new Set(ranked.map((r) => r.blockId)),
            extraLimit: input.graphHops * 5,
            validAt: input.validAt ?? null,
            accessWhere: input.accessWhere,
            contourGroupId: input.contourGroupId,
          })
        : [];

    return [...ranked, ...graphAdded];
  }

  /**
   * Слой источника Ф4 (R1) — обход (точный, по разрешённым id) маршрута К1.
   *
   * По разрешённым personIds/entityIds детерминированно собирает источники
   * (rawEventId) уровня источника: участие — `SourceParticipant`, упоминание
   * компании — `SourceEntity`; их объединение → блоки через
   * `IdeaBlockEvidence` (distinct blockId), упорядоченные по свежести источника
   * (`SourceEpisode.occurredAt DESC`, fallback `RawEvent.occurredAt`). Полнота,
   * не «похожее»: точное равенство по уже разрешённым id (нечёткость — в стадии
   * резолва, R14). Все WHERE tenant-скоупны (изоляция + partition-pruning).
   * Возвращает blockIds (top-`limit`); пустой вход → [].
   */
  async runStructuralAggregate(args: {
    tenantId: string;
    personIds: ReadonlyArray<string>;
    entityIds: ReadonlyArray<string>;
    limit: number;
  }): Promise<string[]> {
    const { tenantId, personIds, entityIds, limit } = args;
    if (personIds.length === 0 && entityIds.length === 0) return [];
    if (limit <= 0) return [];

    const params: unknown[] = [];
    const pushParam = (v: unknown): string => {
      params.push(v);
      return `$${params.length}`;
    };
    const pTenant = pushParam(tenantId);

    const sourceUnions: string[] = [];
    if (personIds.length > 0) {
      const pPersons = pushParam([...personIds]);
      sourceUnions.push(
        `SELECT "rawEventId" FROM "SourceParticipant" ` +
          `WHERE "tenantId" = ${pTenant} AND "personId" = ANY(${pPersons}::text[])`,
      );
    }
    if (entityIds.length > 0) {
      const pEntities = pushParam([...entityIds]);
      sourceUnions.push(
        `SELECT "rawEventId" FROM "SourceEntity" ` +
          `WHERE "tenantId" = ${pTenant} AND "entityId" = ANY(${pEntities}::text[])`,
      );
    }
    if (sourceUnions.length === 0) return [];

    const pLimit = pushParam(limit);

    interface Row {
      blockId: string;
      occurredAt: Date | null;
    }
    let rows: Row[];
    try {
      rows = await this.prisma.$queryRawUnsafe<Row[]>(
        `
        SELECT t."blockId" AS "blockId", t."occurredAt" AS "occurredAt"
        FROM (
          SELECT DISTINCT ON (ev."blockId")
                 ev."blockId" AS "blockId",
                 COALESCE(ep."occurredAt", re."occurredAt") AS "occurredAt"
          FROM "IdeaBlockEvidence" ev
          JOIN (
            ${sourceUnions.join('\n            UNION\n            ')}
          ) src ON src."rawEventId" = ev."rawEventId"
          LEFT JOIN "SourceEpisode" ep
            ON ep."rawEventId" = ev."rawEventId" AND ep."tenantId" = ${pTenant}
          LEFT JOIN "RawEvent" re
            ON re.id = ev."rawEventId" AND re."tenantId" = ${pTenant}
          JOIN "IdeaBlock" b
            ON b.id = ev."blockId" AND b."tenantId" = ${pTenant} AND b.status = 'canonical'
          WHERE ev."tenantId" = ${pTenant}
        ) t
        ORDER BY t."occurredAt" DESC NULLS LAST
        LIMIT ${pLimit}
        `,
        ...params,
      );
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'chat-v2 retrieval: runStructuralAggregate упал — возвращаем []',
      );
      return [];
    }
    return rows.map((r) => r.blockId);
  }

  /**
   * Слой источника Ф10 (R12) — маршрут К1 «список источников по человеку/группе»
   * на уровне ИСТОЧНИКА (не блока): по разрешённым personIds/entityIds
   * детерминированно собирает эпизоды (`SourceEpisode`), не абзац из блоков.
   * Union участия (`SourceParticipant`) и упоминания (`SourceEntity`) →
   * distinct rawEventId → эпизод (id/title/occurredAt/kind/rawEventId),
   * по свежести `occurredAt DESC`. Все WHERE tenant-скоупны (изоляция +
   * partition-pruning). Пустой вход / пустой limit → [].
   */
  async listEpisodesByActors(args: {
    tenantId: string;
    personIds: ReadonlyArray<string>;
    entityIds: ReadonlyArray<string>;
    limit: number;
  }): Promise<
    Array<{
      id: string;
      title: string;
      occurredAt: Date;
      kind: string;
      rawEventId: string;
    }>
  > {
    const { tenantId, personIds, entityIds, limit } = args;
    if (personIds.length === 0 && entityIds.length === 0) return [];
    if (limit <= 0) return [];

    const params: unknown[] = [];
    const pushParam = (v: unknown): string => {
      params.push(v);
      return `$${params.length}`;
    };
    const pTenant = pushParam(tenantId);

    const sourceUnions: string[] = [];
    if (personIds.length > 0) {
      const pPersons = pushParam([...personIds]);
      sourceUnions.push(
        `SELECT "rawEventId" FROM "SourceParticipant" ` +
          `WHERE "tenantId" = ${pTenant} AND "personId" = ANY(${pPersons}::text[])`,
      );
    }
    if (entityIds.length > 0) {
      const pEntities = pushParam([...entityIds]);
      sourceUnions.push(
        `SELECT "rawEventId" FROM "SourceEntity" ` +
          `WHERE "tenantId" = ${pTenant} AND "entityId" = ANY(${pEntities}::text[])`,
      );
    }
    if (sourceUnions.length === 0) return [];

    const pLimit = pushParam(limit);

    interface EpisodeRow {
      id: string;
      title: string;
      occurredAt: Date;
      kind: string;
      rawEventId: string;
    }
    let rows: EpisodeRow[];
    try {
      rows = await this.prisma.$queryRawUnsafe<EpisodeRow[]>(
        `
        SELECT ep.id AS "id",
               ep.title AS "title",
               ep."occurredAt" AS "occurredAt",
               ep.kind AS "kind",
               ep."rawEventId" AS "rawEventId"
        FROM "SourceEpisode" ep
        JOIN (
          SELECT DISTINCT "rawEventId" FROM (
            ${sourceUnions.join('\n            UNION\n            ')}
          ) u
        ) src ON src."rawEventId" = ep."rawEventId"
        WHERE ep."tenantId" = ${pTenant}
        ORDER BY ep."occurredAt" DESC
        LIMIT ${pLimit}
        `,
        ...params,
      );
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'chat-v2 retrieval: listEpisodesByActors упал — возвращаем []',
      );
      return [];
    }
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      occurredAt: r.occurredAt,
      kind: r.kind,
      rawEventId: r.rawEventId,
    }));
  }

  async selectTopThemes(args: {
    tenantId: string;
    query: string;
    limit: number;
    branches?: ReadonlyArray<string>;
  }): Promise<Array<{ id: string; summary: string | null }>> {
    const { tenantId, query, limit } = args;
    if (limit <= 0) return [];

    let rawVec: number[] | null;
    try {
      rawVec = await this.embeddings.embedQuery(query);
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'chat-v2 retrieval: selectTopThemes embedQuery упал — []',
      );
      return [];
    }
    if (!rawVec) return [];
    const expectedDim = this.cfg.ai?.embeddings?.dimensions ?? 1536;
    if (buildVectorLiteral(rawVec, expectedDim).literal === null) return [];
    const qvec = rawVec;

    const branches =
      args.branches && args.branches.length > 0 ? [...new Set(args.branches)] : null;

    const params: unknown[] = [];
    const pushParam = (v: unknown): string => {
      params.push(v);
      return `$${params.length}`;
    };
    const pTenant = pushParam(tenantId);
    const pVec = pushParam(toVectorLiteral(qvec));
    const branchClause = branches
      ? ` AND "branch" = ANY(${pushParam(branches)}::text[])`
      : '';
    const pLimit = pushParam(limit);

    interface ThemeRow {
      id: string;
      summary: string | null;
    }
    let rows: ThemeRow[];
    try {
      rows = await this.prisma.$queryRawUnsafe<ThemeRow[]>(
        `
        SELECT id, summary
        FROM "Theme"
        WHERE "tenantId" = ${pTenant}
          AND status = 'active'
          AND embedding IS NOT NULL${branchClause}
        ORDER BY embedding <=> ${pVec}::vector(1536)
        LIMIT ${pLimit}
        `,
        ...params,
      );
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'chat-v2 retrieval: selectTopThemes упал — []',
      );
      return [];
    }
    return rows.map((r) => ({ id: r.id, summary: r.summary ?? null }));
  }

  async poolByThemes(
    tenantId: string,
    themeIds: ReadonlyArray<string>,
    limit: number,
  ): Promise<string[]> {
    if (themeIds.length === 0 || limit <= 0) return [];
    const out: string[] = [];
    for (const themeId of themeIds) {
      const ids = await this.poolByTheme(tenantId, themeId);
      for (const id of ids) out.push(id);
    }
    return uniqueIds(out).slice(0, limit);
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

  private async collectPool(
    input: RetrievalInput,
    qvec: number[] | null,
  ): Promise<string[]> {
    const { tenantId, scope, scopeId } = input;
    const accessWhere = input.accessWhere;
    // Support-desk Ф2 (R-INV-1) — позитивный pre-filter закрытого контура.
    // БЕЗУСЛОВНЫЙ: не зависит от accessWhere/KNOWLEDGE_ACCESS_ENFORCEMENT.
    // `buildAccessWhere` возвращает форму `{ AND: [...] }` (верхний ключ `AND`),
    // а здесь верхний ключ `blockAccess` — коллизии нет, оба спредятся рядом.
    // contourGroupId не задан → `{}` (поведение byte-identical сегодняшнему).
    const contourWhere: Record<string, unknown> = input.contourGroupId
      ? { blockAccess: { some: { groupId: input.contourGroupId } } }
      : {};
    if (scope === 'org') {
      // Б26 [K3] — детерминированный org-pool.
      // Раньше: `findMany take 5000` без orderBy → Postgres отдавал произвольное
      // подмножество, ответ нестабилен между прогонами. Теперь:
      //  - есть qvec И нет структурного фильтра → pgvector HNSW
      //    `ORDER BY embedding <=> qvec LIMIT 5000`: стабильный recall ближайших
      //    к запросу, а не случайный срез;
      //  - нет qvec (или есть структурный фильтр) → `ORDER BY updatedAt DESC`
      //    (детерминированная свежесть). При структурном фильтре HNSW-срез
      //    НЕЛЬЗЯ: rankByStructuralFilter делает recall-safe полный скан по
      //    pool'у, а pre-narrow до 5000 ближайших уронил бы recall (см. Ф3).
      // Дальше rankByCosineOrRecency обрежет до limit'а тем же вектором.
      if (qvec && !hasStructuralFilter(input)) {
        try {
          const params: unknown[] = [];
          const pushParam = (v: unknown): string => {
            params.push(v);
            return `$${params.length}`;
          };
          const pTenant = pushParam(tenantId);
          const pVec = pushParam(toVectorLiteral(qvec));
          const sql = `
            SELECT b.id
            FROM "IdeaBlock" b
            WHERE b."tenantId" = ${pTenant}
              AND b.status = 'canonical'
              AND b.embedding IS NOT NULL
            ORDER BY b.embedding <=> ${pVec}::vector(1536)
            LIMIT 5000
          `;
          const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
            sql,
            ...params,
          );
          // accessWhere/contourWhere применяются ниже единым re-фильтром, чтобы
          // не дублировать Prisma-форму доступа в сыром SQL.
          const ids = rows.map((r) => r.id);
          return this.applyOrgPoolFilters(
            tenantId,
            ids,
            accessWhere,
            contourWhere,
          );
        } catch (err) {
          this.logger.warn(
            { err: err instanceof Error ? err.message : String(err) },
            'chat-v2 retrieval: org-pool HNSW упал — fallback на recency-orderBy',
          );
        }
      }
      // qvec нет (или HNSW упал) — детерминированная свежесть.
      const rows = await this.prisma.ideaBlock.findMany({
        where: {
          tenantId,
          status: 'canonical',
          ...(accessWhere ?? {}),
          ...contourWhere,
        },
        select: { id: true },
        orderBy: { updatedAt: 'desc' },
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
      return this.poolByMeeting(tenantId, scopeId, accessWhere, contourWhere);
    }
    if (scope === 'card') {
      return this.poolByCard(tenantId, scopeId, accessWhere, contourWhere);
    }
    if (scope === 'theme') {
      return this.poolByTheme(tenantId, scopeId, accessWhere, contourWhere);
    }
    if (scope === 'entity') {
      return this.poolByEntity(tenantId, scopeId, accessWhere, contourWhere);
    }
    const _exhaustive: never = scope;
    throw new Error(`chat-v2 retrieval: unknown scope ${String(_exhaustive)}`);
  }

  /**
   * Б26 [K3] — re-применение accessWhere/contourWhere к HNSW-выбранному
   * org-pool'у, СОХРАНЯЯ порядок HNSW (по близости к запросу). Сырой SQL отдаёт
   * id в порядке `embedding <=> qvec`; чтобы не дублировать Prisma-форму доступа
   * в SQL, фильтруем недоступные блоки отдельной findMany и пересобираем по
   * исходному порядку. Если фильтров нет — возвращаем id как есть (byte-identical).
   */
  private async applyOrgPoolFilters(
    tenantId: string,
    orderedIds: string[],
    accessWhere: Record<string, unknown> | undefined,
    contourWhere: Record<string, unknown>,
  ): Promise<string[]> {
    if (orderedIds.length === 0) return [];
    const hasAccess = accessWhere && Object.keys(accessWhere).length > 0;
    const hasContour = Object.keys(contourWhere).length > 0;
    if (!hasAccess && !hasContour) return orderedIds;

    const allowed = await this.prisma.ideaBlock.findMany({
      where: {
        id: { in: orderedIds },
        tenantId,
        status: 'canonical',
        ...(accessWhere ?? {}),
        ...contourWhere,
      },
      select: { id: true },
    });
    const allowedSet = new Set(allowed.map((r) => r.id));
    // Сохраняем HNSW-порядок.
    return orderedIds.filter((id) => allowedSet.has(id));
  }

  /**
   * Meeting scope: blockId'ы через RawEvent(sourceType='meeting',
   * sourceExternalId=meetingId) → IdeaBlockEvidence.rawEventId → blockId.
   * Только canonical, фильтр tenantId.
   */
  private async poolByMeeting(
    tenantId: string,
    meetingId: string,
    accessWhere?: Record<string, unknown>,
    contourWhere?: Record<string, unknown>,
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
        block: {
          status: 'canonical',
          tenantId,
          ...(accessWhere ?? {}),
          ...(contourWhere ?? {}),
        },
      },
      select: { blockId: true },
      // Б26 [K3] — детерминированный срез: без orderBy `take 1000` отдавал
      // случайное подмножество. Берём самые свежие блоки (по block.updatedAt).
      orderBy: { block: { updatedAt: 'desc' } },
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
    accessWhere?: Record<string, unknown>,
    contourWhere?: Record<string, unknown>,
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
          block: {
            status: 'canonical',
            tenantId,
            ...(accessWhere ?? {}),
            ...(contourWhere ?? {}),
          },
        },
        select: { blockId: true },
        // Б26 [K3] — детерминированный срез (см. poolByMeeting).
        orderBy: { block: { updatedAt: 'desc' } },
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
          block: {
            status: 'canonical',
            tenantId,
            ...(accessWhere ?? {}),
            ...(contourWhere ?? {}),
          },
        },
        select: { blockId: true },
        // Б26 [K3] — детерминированный срез (см. poolByMeeting).
        orderBy: { block: { updatedAt: 'desc' } },
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
    accessWhere?: Record<string, unknown>,
    contourWhere?: Record<string, unknown>,
  ): Promise<string[]> {
    const rows = await this.prisma.themeIdeaBlock.findMany({
      where: {
        themeId,
        theme: { tenantId, status: 'active' },
        block: {
          status: 'canonical',
          tenantId,
          ...(accessWhere ?? {}),
          ...(contourWhere ?? {}),
        },
      },
      select: { blockId: true },
      // Б26 [K3] — детерминированный срез (см. poolByMeeting).
      orderBy: { block: { updatedAt: 'desc' } },
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
    accessWhere?: Record<string, unknown>,
    contourWhere?: Record<string, unknown>,
  ): Promise<string[]> {
    // Проверим, что Entity принадлежит тенанту.
    const ent = await this.prisma.entity.findUnique({
      where: { id_tenantId: { id: entityId, tenantId } },
      select: { id: true, tenantId: true },
    });
    if (!ent || ent.tenantId !== tenantId) return [];

    const rows = await this.prisma.ideaBlockEntity.findMany({
      where: {
        entityId,
        block: {
          status: 'canonical',
          tenantId,
          ...(accessWhere ?? {}),
          ...(contourWhere ?? {}),
        },
      },
      select: { blockId: true },
      // Б26 [K3] — детерминированный срез (см. poolByMeeting).
      orderBy: { block: { updatedAt: 'desc' } },
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

  /**
   * Query Understanding Волна 1 (Ф3) — recall-safe фильтрованный ретрив.
   *
   * Ранжирует WHERE-фильтрованное множество полным сканом с combined-score в
   * `ORDER BY` (вычисляемый алиас, НЕ `ORDER BY embedding <=> qvec LIMIT`).
   * Вычисляемое выражение в ORDER BY не использует HNSW-индекс → точный
   * полный скан по уже узкому pool (capped 5000) → фильтр не роняет recall.
   *
   * Предикаты строятся `buildStructuralPredicates` (донор — `runHybridQuery`).
   * tenantId есть во всех ветках (pTenant). Без qvec — recency-fallback с теми
   * же структурными предикатами.
   */
  private async rankByStructuralFilter(args: {
    tenantId: string;
    blockIds: string[];
    qvec: number[] | null;
    filters: Omit<StructuralFilterArgs, 'tenantParamRef'>;
    limit: number;
  }): Promise<RankedBlockId[]> {
    const { tenantId, blockIds, qvec, filters, limit } = args;
    if (blockIds.length === 0) return [];

    const params: unknown[] = [];
    const pushParam = (v: unknown): string => {
      params.push(v);
      return `$${params.length}`;
    };

    // tenant ПЕРВЫМ — его `$N` переиспользуется предикатом themeBranch.
    const pTenant = pushParam(tenantId);
    const pIds = pushParam(blockIds);

    if (qvec) {
      const pVec = pushParam(toVectorLiteral(qvec));
      const predicates = buildStructuralPredicates(
        { ...filters, tenantParamRef: pTenant },
        pushParam,
      );
      const pLimit = pushParam(limit);
      const whereExtra =
        predicates.length > 0 ? `\n          AND ${predicates.join('\n          AND ')}` : '';
      // ORDER BY score DESC (вычисляемый алиас) — recall-safe, НЕ HNSW LIMIT.
      const sql = `
        SELECT b.id,
               (1 - (b.embedding <=> ${pVec}::vector(1536))) AS score
        FROM "IdeaBlock" b
        WHERE b."tenantId" = ${pTenant}
          AND b.status = 'canonical'
          AND b.id = ANY(${pIds}::text[])
          AND b.embedding IS NOT NULL${whereExtra}
        ORDER BY score DESC
        LIMIT ${pLimit}
      `;
      const rows = await this.prisma.$queryRawUnsafe<RankedRow[]>(
        sql,
        ...params,
      );
      return rows.map((r) => ({
        blockId: r.id,
        score: toFiniteNumber(r.score) ?? 0,
        fromGraph: false,
      }));
    }

    // qvec нет (embedding упал) — recency-fallback с теми же структурными
    // предикатами; score=0.
    const predicates = buildStructuralPredicates(
      { ...filters, tenantParamRef: pTenant },
      pushParam,
    );
    const pLimit = pushParam(limit);
    const whereExtra =
      predicates.length > 0 ? `\n          AND ${predicates.join('\n          AND ')}` : '';
    const sql = `
      SELECT b.id
      FROM "IdeaBlock" b
      WHERE b."tenantId" = ${pTenant}
        AND b.status = 'canonical'
        AND b.id = ANY(${pIds}::text[])${whereExtra}
      ORDER BY b."updatedAt" DESC
      LIMIT ${pLimit}
    `;
    const rows = await this.prisma.$queryRawUnsafe<RankedRow[]>(sql, ...params);
    return rows.map((r) => ({
      blockId: r.id,
      score: toFiniteNumber(r.score) ?? 0,
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
    accessWhere?: Record<string, unknown>;
    /** Support-desk Ф2 (R-INV-1) — закрытый контур: 1-hop-соседи тоже обязаны
     *  быть в контуре, иначе граф-расширение «протечёт» наружу. Безусловный. */
    contourGroupId?: string;
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
        ...ACTIVE_LINK_FILTER,
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
        ...ACTIVE_LINK_FILTER,
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
        ...(args.accessWhere ?? {}),
        // R-INV-1 — закрытый контур применяется и к граф-соседям (безусловно).
        ...(args.contourGroupId
          ? { blockAccess: { some: { groupId: args.contourGroupId } } }
          : {}),
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
