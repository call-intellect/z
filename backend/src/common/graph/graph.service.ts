import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  type EntityLinkType,
  type LinkCreatedBy,
  Prisma,
} from '@prisma/client';

import { TypedConfigService } from '../config';
import { PrismaService } from '../prisma/prisma.service';

import { CypherBuilder, Z_GRAPH } from './cypher-builder';
import {
  type AddEdgeParams,
  type AddNodeParams,
  type FindPathParams,
  type GetNeighborsParams,
  type GraphEdge,
  type GraphNode,
  type NeighborResult,
  type NodeRef,
  type NodeType,
  type PathResult,
  type RemoveEdgeParams,
  type RemoveNodeParams,
  type TraverseParams,
  type UpsertEntityParams,
  type UpsertEntityResult,
} from './graph.types';

/**
 * Дефолтный объяснительный текст для пользовательских (manual) связей —
 * `EntityLink.explanation` объявлен `@db.Text NOT NULL` в schema.prisma.
 */
const DEFAULT_EXPLANATION = 'manual';

/**
 * Жёсткие потолки обхода — защита от взрыва Cypher на больших графах.
 */
const MAX_DEPTH_NEIGHBORS = 5;
const MAX_DEPTH_FIND_PATH = 10;
const DEFAULT_NEIGHBOR_LIMIT = 100;

/**
 * Поля `Prisma` транзакционного клиента, которые нам нужны. Используем
 * `Prisma.TransactionClient`, чтобы не зависеть от полного `PrismaClient`.
 */
type Tx = Prisma.TransactionClient;

/**
 * Тип маппинга `NodeType → Postgres-таблица`. Используется в `upsertEntity` и
 * `removeNode` (TRUNCATE EntityLink — общая таблица, а сам узел удаляется из
 * соответствующей бизнес-таблицы; пока что removeNode НЕ трогает бизнес-
 * таблицу, оставляя это вызывающему).
 */
const UPSERTABLE_BY_NAME: Partial<Record<NodeType, keyof Tx>> = {
  process: 'process',
  regulation: 'regulation',
  policy: 'policy',
  tool: 'tool',
  metric: 'metric',
};

/**
 * `GraphService` — единая точка работы с графовой инфраструктурой
 * (PostgreSQL + Apache AGE) проекта Z.
 *
 * Главное свойство: **двойная запись** Postgres (`EntityLink` / Process /
 * Decision / …) + AGE (`z_graph`). МТЗ «разблокировка конвейера» Ф5 РАЗВЯЗАЛ
 * транзакцию: Postgres-строка — **источник правды**, коммитится ПЕРВОЙ внутри
 * `$transaction`; AGE-часть (`cypher()` MERGE/DELETE) выполняется ПОСЛЕ
 * коммита как **post-commit best-effort** (`try/catch+warn`). Отказ AGE
 * (недоступность, не настроен `search_path` → Postgres 42883) больше НЕ
 * откатывает бизнес-строку — раньше это приводило к тихой потере сущностей.
 * Kill-switch `cfg.graph.ageEnabled=false` делает все write-Cypher no-op.
 * Прямое обращение к `cypher(...)` из бизнес-сервисов запрещено (см.
 * `second-brain/02_architecture/code-pitfalls.md`).
 *
 * См. план: `plans/tz/2026-05-21-phase-0a-data-model-and-graph-infra.md` §6
 * и `plans/tz/2026-06-04-razblokirovka-konveyera.md` §Ф5.
 */
@Injectable()
export class GraphService {
  private readonly logger = new Logger(GraphService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cfg: TypedConfigService,
  ) {}

  // ─────────────────────────── узлы ──────────────────────────────────

  /**
   * Идемпотентно создать узел в AGE.
   *
   * Postgres-side ничего не пишем: вершины бизнес-сущностей живут в своих
   * таблицах (`Person`, `Role`, `Process`, …) — их upsert делает caller
   * через профильный сервис, либо `GraphService.upsertEntity`.
   *
   * Если у узла уже были рёбра (повторный addNode) — они сохраняются.
   * `MERGE` — Cypher-идиома upsert: создаёт узел, если нет, иначе ничего.
   */
  async addNode(params: AddNodeParams): Promise<void> {
    const { tenantId, type, id, properties } = params;
    if (!tenantId || !id) {
      throw new BadRequestException('tenantId and id required');
    }

    await this.runCypherMergeNode(this.prisma, tenantId, type, id, properties);
  }

  /**
   * Удалить узел из AGE + soft-delete ВСЕ EntityLink-связи (где он `from`
   * или `to`).
   *
   * Бизнес-строка (Person/Role/Process/…) — НЕ трогается. Caller должен
   * сделать это сам (например, через профильный сервис), потому что бизнес-
   * логика soft-delete живёт там.
   */
  async removeNode(params: RemoveNodeParams): Promise<void> {
    const { tenantId, type, id } = params;
    if (!tenantId || !id) {
      throw new BadRequestException('tenantId and id required');
    }
    const label = CypherBuilder.toAgeLabel(type);

    // МТЗ Ф5 — РАЗВЯЗКА ТРАНЗАКЦИИ. Soft-delete EntityLink (Postgres) —
    // источник правды, коммитим ПЕРВЫМ. DETACH DELETE в AGE — post-commit
    // best-effort: падение cypher() не возвращает уже архивированные связи.
    await this.prisma.$transaction(async (tx) => {
      // Soft-delete всех EntityLink, где этот узел — `from` или `to`.
      const now = new Date();
      await tx.entityLink.updateMany({
        where: {
          tenantId,
          deletedAt: null,
          OR: [
            { fromEntityId: id, fromType: type },
            { toEntityId: id, toType: type },
          ],
        },
        data: {
          status: 'archived',
          deletedAt: now,
        },
      });
    });

    // Удалить узел из AGE — DETACH DELETE убирает все его рёбра.
    try {
      const cypher =
        `MATCH (n:${label} {id: '${CypherBuilder.escapeString(id)}', ` +
        `tenant_id: '${CypherBuilder.escapeString(tenantId)}'}) ` +
        `DETACH DELETE n`;
      await this.runRawCypher(this.prisma, cypher);
    } catch (err) {
      this.logger.warn(
        {
          node: `${type}:${id}`,
          err: err instanceof Error ? err.message : String(err),
        },
        'removeNode: AGE DETACH DELETE упал (post-commit best-effort) — EntityLink уже архивирован',
      );
    }
  }

  // ─────────────────────────── рёбра ─────────────────────────────────

  /**
   * Идемпотентно создать ребро (двойная запись Postgres + AGE).
   *
   * Уникальность на стороне Postgres: composite `[fromEntityId, fromType,
   * toEntityId, toType, relationType]`. Уникальность на стороне AGE: `MERGE`
   * по pattern — но AGE может допускать дубликаты при разных свойствах,
   * поэтому полагаемся на Postgres-ключ как на источник правды.
   *
   * Если две стороны транзакции падают — обе записи откатываются. При
   * успехе — обе зафиксированы.
   */
  async addEdge(params: AddEdgeParams): Promise<void> {
    const {
      tenantId,
      from,
      to,
      linkType,
      validFrom,
      validTo,
      properties,
      confidence,
      explanation,
      createdBy,
    } = params;
    if (!tenantId || !from?.id || !to?.id) {
      throw new BadRequestException('tenantId, from.id and to.id required');
    }
    // Валидация label/relType — упадёт BadRequestException, если кто-то
    // передал значение вне whitelist'а.
    CypherBuilder.toAgeLabel(from.type);
    CypherBuilder.toAgeLabel(to.type);
    CypherBuilder.toRelType(linkType);

    if (confidence !== undefined && (confidence < 0 || confidence > 1)) {
      throw new BadRequestException('confidence must be in [0,1]');
    }

    const effectiveConfidence =
      confidence !== undefined ? confidence : 1.0;
    const effectiveCreatedBy: LinkCreatedBy = createdBy ?? 'manual';
    const effectiveValidFrom = validFrom ?? new Date();
    const effectiveValidTo = validTo ?? null;
    const effectiveExplanation = explanation ?? DEFAULT_EXPLANATION;
    const effectiveProperties = properties ?? {};

    // МТЗ Ф5 — РАЗВЯЗКА ТРАНЗАКЦИИ. EntityLink (Postgres) — источник правды,
    // коммитим ПЕРВЫМ внутри tx. AGE-часть (merge узлов + ребра) вынесена
    // НАРУЖУ как post-commit best-effort: падение cyp() (AGE недоступен,
    // search_path не настроен) больше НЕ откатывает EntityLink.
    await this.prisma.$transaction(async (tx) => {
      // EntityLink upsert (Postgres).
      //
      // Composite unique включает nullable `fromType/toType`. Prisma
      // допускает использование composite unique только когда все поля не
      // null. У нас они всегда не null (мы их явно проставляем из NodeRef.type),
      // так что `upsert` через имя композитного ключа работает.
      await tx.entityLink.upsert({
        where: {
          fromEntityId_fromType_toEntityId_toType_relationType: {
            fromEntityId: from.id,
            fromType: from.type,
            toEntityId: to.id,
            toType: to.type,
            relationType: linkType,
          },
        },
        create: {
          tenantId,
          fromEntityId: from.id,
          fromType: from.type,
          toEntityId: to.id,
          toType: to.type,
          relationType: linkType,
          confidence: new Prisma.Decimal(effectiveConfidence.toFixed(3)),
          explanation: effectiveExplanation,
          createdBy: effectiveCreatedBy,
          status: 'active',
          validFrom: effectiveValidFrom,
          validTo: effectiveValidTo,
          properties: effectiveProperties as Prisma.InputJsonValue,
          deletedAt: null,
        },
        update: {
          // Идемпотент: обновляем «свежие» поля, но не пересоздаём строку.
          confidence: new Prisma.Decimal(effectiveConfidence.toFixed(3)),
          explanation: effectiveExplanation,
          validFrom: effectiveValidFrom,
          validTo: effectiveValidTo,
          properties: effectiveProperties as Prisma.InputJsonValue,
          status: 'active',
          deletedAt: null,
        },
      });
    });

    // AGE-часть — ПОСЛЕ коммита EntityLink, best-effort. Семантика графа
    // неизменна (те же MERGE узлов + MERGE ребра + SET свойств).
    try {
      // Гарантируем существование обоих узлов в AGE (на случай, если addNode
      // не вызывали — типичный сценарий extraction-воркера).
      await this.runCypherMergeNode(this.prisma, tenantId, from.type, from.id);
      await this.runCypherMergeNode(this.prisma, tenantId, to.type, to.id);

      // MERGE ребра в AGE + SET свойств.
      const baseMerge = CypherBuilder.buildMergeEdge({
        fromType: from.type,
        fromId: from.id,
        toType: to.type,
        toId: to.id,
        linkType,
        tenantId,
      });
      // SET свойств — отдельной фразой Cypher. Значения экранируем через
      // JSON.stringify (Cypher принимает map-литералы в SET).
      const validFromIso = effectiveValidFrom.toISOString();
      const validToIso = effectiveValidTo ? effectiveValidTo.toISOString() : null;
      const propsJson = CypherBuilder.escapeString(
        JSON.stringify(effectiveProperties),
      );
      const setProps =
        ` SET r.confidence = ${effectiveConfidence.toFixed(3)},` +
        ` r.valid_from = '${validFromIso}',` +
        ` r.valid_to = ${validToIso ? `'${validToIso}'` : 'NULL'},` +
        ` r.properties = '${propsJson}'`;
      await this.runRawCypher(this.prisma, baseMerge + setProps);
    } catch (err) {
      this.logger.warn(
        {
          from: `${from.type}:${from.id}`,
          to: `${to.type}:${to.id}`,
          linkType,
          err: err instanceof Error ? err.message : String(err),
        },
        'addEdge: AGE-часть упала (post-commit best-effort) — EntityLink сохранён',
      );
    }
  }

  /**
   * Удалить ребро — soft-delete в Postgres (`status='archived'`,
   * `deletedAt=now`) + DELETE в AGE. Транзакционно.
   *
   * Идемпотент: если ребра нет, оба шага — no-op.
   */
  async removeEdge(params: RemoveEdgeParams): Promise<void> {
    const { tenantId, from, to, linkType, deletedBy } = params;
    if (!tenantId || !from?.id || !to?.id) {
      throw new BadRequestException('tenantId, from.id and to.id required');
    }
    CypherBuilder.toAgeLabel(from.type);
    CypherBuilder.toAgeLabel(to.type);
    CypherBuilder.toRelType(linkType);

    // МТЗ Ф5 — РАЗВЯЗКА ТРАНЗАКЦИИ. Soft-delete EntityLink (Postgres) —
    // источник правды, коммитим ПЕРВЫМ. DELETE ребра в AGE — post-commit
    // best-effort.
    await this.prisma.$transaction(async (tx) => {
      // Soft-delete EntityLink.
      await tx.entityLink.updateMany({
        where: {
          tenantId,
          fromEntityId: from.id,
          fromType: from.type,
          toEntityId: to.id,
          toType: to.type,
          relationType: linkType,
          deletedAt: null,
        },
        data: {
          status: 'archived',
          deletedAt: new Date(),
          deletedBy: deletedBy ?? null,
        },
      });
    });

    // Удалить ребро в AGE.
    try {
      const cypher = CypherBuilder.buildDeleteEdge({
        fromType: from.type,
        fromId: from.id,
        toType: to.type,
        toId: to.id,
        linkType,
        tenantId,
      });
      await this.runRawCypher(this.prisma, cypher);
    } catch (err) {
      this.logger.warn(
        {
          from: `${from.type}:${from.id}`,
          to: `${to.type}:${to.id}`,
          linkType,
          err: err instanceof Error ? err.message : String(err),
        },
        'removeEdge: AGE DELETE ребра упал (post-commit best-effort) — EntityLink уже архивирован',
      );
    }
  }

  // ─────────────────────────── чтение ────────────────────────────────

  /**
   * Соседи узла. Чтение идёт через AGE Cypher (это его основное назначение —
   * быстрый обход графа). Postgres-таблица `EntityLink` тоже годится, но
   * многошаговый обход на Postgres превратится в каскад self-join'ов —
   * AGE лучше масштабируется на depth ≥ 2.
   */
  async getNeighbors(params: GetNeighborsParams): Promise<NeighborResult> {
    const {
      tenantId,
      node,
      linkTypes,
      direction = 'both',
      depth = 1,
      limit = DEFAULT_NEIGHBOR_LIMIT,
    } = params;
    if (!tenantId || !node?.id) {
      throw new BadRequestException('tenantId and node.id required');
    }
    if (depth < 1 || depth > MAX_DEPTH_NEIGHBORS) {
      throw new BadRequestException(
        `depth must be in [1,${MAX_DEPTH_NEIGHBORS}]`,
      );
    }

    const startLabel = CypherBuilder.toAgeLabel(node.type);
    const safeId = CypherBuilder.escapeString(node.id);
    const safeTenant = CypherBuilder.escapeString(tenantId);

    // Направление: out → `-[r]->`, in → `<-[r]-`, both → `-[r]-`.
    const arrow =
      direction === 'out' ? '-[r*1..%d]->' : direction === 'in' ? '<-[r*1..%d]-' : '-[r*1..%d]-';
    const arrowExpanded = arrow.replace('%d', String(depth));

    // Фильтр по типу ребра — через WHERE ALL(... IN [...]).
    const relTypeList = CypherBuilder.buildRelTypeFilter(linkTypes);
    const whereRelTypes = relTypeList
      ? ` AND ALL(rel IN r WHERE type(rel) IN [${relTypeList}])`
      : '';

    // tenant_id фильтр на соседе — чтобы не утащить чужие узлы (защита от
    // отсутствия label-фильтра в multi-hop).
    const cypher =
      `MATCH (a:${startLabel} {id: '${safeId}', tenant_id: '${safeTenant}'})` +
      `${arrowExpanded}(b) ` +
      `WHERE b.tenant_id = '${safeTenant}'${whereRelTypes} ` +
      `RETURN a, r, b LIMIT ${Math.max(1, Math.min(limit, 10_000))}`;

    const rows = await this.runRawCypherRows(this.prisma, cypher);
    return this.parseNeighborRows(rows);
  }

  /**
   * Shortest path между двумя узлами. Cypher `shortestPath((a)-[*..maxDepth]-(b))`.
   * Если пути нет — возвращает `{ nodes: [], edges: [], length: 0 }`.
   *
   * `linkTypes` — фильтр по типам рёбер (если задан).
   */
  async findPath(params: FindPathParams): Promise<PathResult> {
    const { tenantId, from, to, maxDepth = 5, linkTypes } = params;
    if (!tenantId || !from?.id || !to?.id) {
      throw new BadRequestException('tenantId, from.id and to.id required');
    }
    if (maxDepth < 1 || maxDepth > MAX_DEPTH_FIND_PATH) {
      throw new BadRequestException(
        `maxDepth must be in [1,${MAX_DEPTH_FIND_PATH}]`,
      );
    }

    const fromLabel = CypherBuilder.toAgeLabel(from.type);
    const toLabel = CypherBuilder.toAgeLabel(to.type);
    const safeFromId = CypherBuilder.escapeString(from.id);
    const safeToId = CypherBuilder.escapeString(to.id);
    const safeTenant = CypherBuilder.escapeString(tenantId);

    const relTypeList = CypherBuilder.buildRelTypeFilter(linkTypes);
    const whereRelTypes = relTypeList
      ? ` WHERE ALL(rel IN relationships(p) WHERE type(rel) IN [${relTypeList}])`
      : '';

    const cypher =
      `MATCH (a:${fromLabel} {id: '${safeFromId}', tenant_id: '${safeTenant}'}), ` +
      `(b:${toLabel} {id: '${safeToId}', tenant_id: '${safeTenant}'}), ` +
      `p = shortestPath((a)-[*..${maxDepth}]-(b))${whereRelTypes} ` +
      `RETURN nodes(p) AS ns, relationships(p) AS rs`;

    const rows = await this.runRawCypherRows(this.prisma, cypher);
    const first = rows[0];
    if (!first) {
      return { nodes: [], edges: [], length: 0 };
    }
    return this.parsePathRow(first);
  }

  /**
   * **Escape-hatch** для сложных Cypher-запросов. Используется только внутри
   * `common/graph/` или специализированных воркеров (например,
   * `RoleProfileAgent`). См. §6.3 ТЗ Фазы 0a.
   *
   * Подстановка bindings — через свойства AGE-параметра JSONB не реализована
   * (AGE имеет ограниченную поддержку параметров). Сейчас bindings
   * добавляются как параметры к `cypher(...)` через 2-й аргумент: третий
   * параметр функции `cypher` — `agtype` JSON. Использовать с осторожностью.
   *
   * `start` — формально нужен для проверки tenant'а, но конкретный фильтр
   * остаётся на совести вызывающего (он подставляет `$startId` в свой Cypher).
   */
  async traverse(params: TraverseParams): Promise<unknown[]> {
    const { tenantId, start, cypher, bindings } = params;
    if (!tenantId || !start?.id) {
      throw new BadRequestException('tenantId and start.id required');
    }
    if (!cypher || typeof cypher !== 'string') {
      throw new BadRequestException('cypher string required');
    }
    // Whitelist label/relType из start (хотя caller сам встраивает их в свой
    // запрос — мы только страхуем от тривиальных опечаток).
    CypherBuilder.toAgeLabel(start.type);

    // bindings — передаём как 2-й параметр в cypher() (AGE-агтайп параметр).
    // Реализуем минимально: бросаем, если переданы — расширим, когда
    // появится первый честный сценарий из RoleProfileAgent (Фаза 0d).
    if (bindings && Object.keys(bindings).length > 0) {
      this.logger.warn(
        `traverse() called with bindings (${Object.keys(bindings).join(',')}); ` +
          `bindings inline-substitution is not supported yet — inline values into cypher string`,
      );
    }

    const rows = await this.runRawCypherRows(this.prisma, cypher);
    return rows;
  }

  // ─────────────────────────── upsert (для extraction) ──────────────

  /**
   * Высокоуровневый upsert бизнес-сущности (Фаза 0b §6.2).
   *
   * Сначала ищет запись по `(tenantId, name)` (для Process/Regulation/Policy/
   * Tool/Metric — у них `@@unique([tenantId, name])`). Если нашёл — возвращает
   * `{ id, created: false }`. Если нет — создаёт строку в Postgres-таблице
   * соответствующего типа + AGE-узел.
   *
   * Для `mission/vision/strategy` — поведение задаётся флагом
   * `EXTRACTION_ENABLE_TOP_LEVEL` (env, Фаза δ). Сейчас он не поднят в
   * `TypedConfigService` — поэтому всегда бросаем `BadRequestException`.
   *
   * Для `decision` — дедуп по `sourceIdeaBlockId` (`@unique` в schema). Если
   * `data.sourceIdeaBlockId` задан и запись существует — возвращает её.
   */
  async upsertEntity(params: UpsertEntityParams): Promise<UpsertEntityResult> {
    const { tenantId, type, data, sourceProvenance, confidence } = params;
    if (!tenantId) throw new BadRequestException('tenantId required');

    // Mission/Vision/Strategy — закрыто за фичефлагом (Фаза δ).
    if (type === 'mission' || type === 'vision' || type === 'strategy') {
      throw new BadRequestException(
        `upsertEntity for type=${type} requires EXTRACTION_ENABLE_TOP_LEVEL flag (not enabled)`,
      );
    }

    // Decision — отдельная ветка (нет unique по name; уникальность —
    // sourceIdeaBlockId).
    if (type === 'decision') {
      return this.upsertDecision(tenantId, data, sourceProvenance);
    }

    // Process / Regulation / Policy / Tool / Metric — поиск по name.
    if (!UPSERTABLE_BY_NAME[type]) {
      throw new BadRequestException(
        `upsertEntity not supported for type=${type}`,
      );
    }
    const name = data['name'];
    if (typeof name !== 'string' || name.length === 0) {
      throw new BadRequestException(
        `upsertEntity for type=${type} requires data.name (non-empty string)`,
      );
    }

    // МТЗ Ф5 — РАЗВЯЗКА ТРАНЗАКЦИИ. Бизнес-строка (Process/Regulation/Policy/
    // Tool/Metric) — источник правды, коммитим ПЕРВОЙ. AGE-узел (MERGE) —
    // post-commit best-effort: падение cypher() больше НЕ откатывает
    // бизнес-строку (раньше падение AGE на рантайм-пуле без search_path
    // приводило к 42883 → откат всей tx → тихая потеря сущности).
    const result = await this.prisma.$transaction(async (tx) =>
      this.upsertNameKeyedEntity(tx, tenantId, type, name, data, confidence),
    );

    if (result.created && sourceProvenance) {
      this.logger.debug(
        `upsertEntity: created ${type}=${result.id} (provenance: ` +
          `${JSON.stringify(sourceProvenance)})`,
      );
    }

    // AGE-узел — гарантируем существование (после коммита бизнес-строки).
    try {
      await this.runCypherMergeNode(this.prisma, tenantId, type, result.id);
    } catch (err) {
      this.logger.warn(
        {
          node: `${type}:${result.id}`,
          err: err instanceof Error ? err.message : String(err),
        },
        'upsertEntity: AGE MERGE узла упал (post-commit best-effort) — бизнес-строка сохранена',
      );
    }

    return result;
  }

  // ─────────────────────────── private helpers ──────────────────────

  /**
   * MERGE узла в AGE. Если переданы свойства — добавляем `SET n += {...}`.
   * Принимает Prisma-клиент (внутри транзакции или обычный) — это важно
   * для двойной записи.
   */
  private async runCypherMergeNode(
    client: PrismaService | Tx,
    tenantId: string,
    type: NodeType,
    id: string,
    properties?: Record<string, unknown>,
  ): Promise<void> {
    // МТЗ Ф5 kill-switch: при выключенном AGE — no-op (Postgres-часть пишется
    // вызывающим без графа). Центральная точка — `runRawCypher` ниже, но здесь
    // короткое замыкание избегает лишней сборки Cypher.
    if (!this.cfg.graph.ageEnabled) return;
    const merge = CypherBuilder.buildMergeNode(type, id, tenantId);
    let cypher = merge;
    if (properties && Object.keys(properties).length > 0) {
      const propsJson = CypherBuilder.escapeString(JSON.stringify(properties));
      cypher = `${merge} SET n.properties = '${propsJson}'`;
    }
    await this.runRawCypher(client, cypher);
  }

  /**
   * Исполнить Cypher без возврата результата (MERGE/DELETE/SET).
   * Обёртка `SELECT * FROM cypher('z_graph', $$ ... $$) as (v agtype)`.
   */
  private async runRawCypher(
    client: PrismaService | Tx,
    cypher: string,
  ): Promise<void> {
    // МТЗ Ф5 kill-switch: единая no-op точка для ВСЕХ write-Cypher
    // (MERGE/DELETE/SET узлов и рёбер). Чинит весь класс одним рычагом —
    // addNode/addEdge/upsertEntity/removeNode/removeEdge. Read-путь
    // (getNeighbors/findPath/traverse через runRawCypherRows) не трогаем.
    if (!this.cfg.graph.ageEnabled) return;
    const sql =
      `SELECT * FROM cypher('${Z_GRAPH}', $cypher$ ${cypher} $cypher$) AS (v agtype)`;
    await client.$queryRawUnsafe(sql);
  }

  /**
   * Исполнить Cypher и вернуть строки. Используется в getNeighbors/findPath/
   * traverse. agtype возвращается как строка/JSON — парсинг на стороне
   * вызывающего.
   */
  private async runRawCypherRows(
    client: PrismaService | Tx,
    cypher: string,
  ): Promise<Array<Record<string, unknown>>> {
    // ВНИМАНИЕ: количество и имена колонок в AS (...) должны совпадать с тем,
    // что вернул RETURN. Универсально возвращаем одну колонку `v` и парсим
    // её как JSON-агтайп — но AGE возвращает несколько колонок при `RETURN a, r, b`.
    // Поэтому для multi-column запросов используем альтернативу: оборачиваем
    // в `collect()`. Чтобы не плодить ad-hoc обёртки, разбираем оба варианта.
    //
    // Простейший путь: возвращаем `RETURN ... AS row` уже в каждом запросе.
    // Но для совместимости делаем generic-парсинг: одна колонка `v agtype`.
    const sql =
      `SELECT * FROM cypher('${Z_GRAPH}', $cypher$ ${cypher} $cypher$) AS (v agtype)`;
    try {
      const result = await client.$queryRawUnsafe<Array<Record<string, unknown>>>(sql);
      return result ?? [];
    } catch (err) {
      // Multi-column queries падают на `AS (v agtype)`. Пытаемся с (a,r,b).
      const sqlMulti =
        `SELECT * FROM cypher('${Z_GRAPH}', $cypher$ ${cypher} $cypher$) ` +
        `AS (a agtype, r agtype, b agtype)`;
      try {
        const result = await client.$queryRawUnsafe<
          Array<Record<string, unknown>>
        >(sqlMulti);
        return result ?? [];
      } catch {
        // Пробрасываем оригинальную ошибку — она информативнее.
        throw err;
      }
    }
  }

  /**
   * Парсинг строк AGE → NeighborResult. AGE возвращает agtype как строки;
   * драйвер `@prisma/adapter-pg` отдаёт их в виде объектов / строк JSON.
   * Здесь — best-effort: пытаемся вытащить узлы/рёбра обоими способами.
   */
  private parseNeighborRows(
    rows: Array<Record<string, unknown>>,
  ): NeighborResult {
    const nodes = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];

    for (const row of rows) {
      // Однострочный формат: { v: ... } или { a, r, b }.
      const a = this.parseAgtype(row['a']);
      const b = this.parseAgtype(row['b']);
      const r = this.parseAgtype(row['r']);

      const aNode = this.agtypeToGraphNode(a);
      if (aNode) nodes.set(this.nodeKey(aNode), aNode);

      const bNode = this.agtypeToGraphNode(b);
      if (bNode) nodes.set(this.nodeKey(bNode), bNode);

      // r может быть массивом рёбер (variable-length path) или одиночным.
      const relList = Array.isArray(r) ? r : r ? [r] : [];
      for (const rel of relList) {
        const edge = this.agtypeToGraphEdge(rel);
        if (edge) edges.push(edge);
      }
    }

    return {
      nodes: Array.from(nodes.values()),
      edges,
    };
  }

  /**
   * Парсинг shortestPath-строки в PathResult. AGE возвращает узлы и рёбра
   * как массивы agtype.
   */
  private parsePathRow(row: Record<string, unknown>): PathResult {
    // `RETURN nodes(p) AS ns, relationships(p) AS rs` ожидается через
    // `AS (ns agtype, rs agtype)` — но мы пользуемся generic-парсингом v.
    // Поэтому ищем оба варианта.
    const ns = this.parseAgtype(row['ns'] ?? row['v']);
    const rs = this.parseAgtype(row['rs']);

    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    if (Array.isArray(ns)) {
      for (const n of ns) {
        const node = this.agtypeToGraphNode(n);
        if (node) nodes.push(node);
      }
    }
    if (Array.isArray(rs)) {
      for (const e of rs) {
        const edge = this.agtypeToGraphEdge(e);
        if (edge) edges.push(edge);
      }
    }

    return {
      nodes,
      edges,
      length: edges.length,
    };
  }

  /**
   * Парсинг agtype-значения. Драйвер pg может вернуть строку (`"vertex"::vertex`)
   * или уже разобранный объект; пробуем оба пути.
   */
  private parseAgtype(value: unknown): unknown {
    if (value == null) return null;
    if (typeof value === 'object') return value;
    if (typeof value === 'string') {
      // AGE сериализует как `<json>::vertex` или просто JSON. Срезаем хвост `::...`.
      const cleaned = value.replace(/::[a-zA-Z_]+$/g, '');
      try {
        return JSON.parse(cleaned);
      } catch {
        return null;
      }
    }
    return null;
  }

  private agtypeToGraphNode(value: unknown): GraphNode | null {
    if (!value || typeof value !== 'object') return null;
    const v = value as Record<string, unknown>;
    const label = typeof v['label'] === 'string' ? (v['label'] as string) : undefined;
    const props = (v['properties'] ?? {}) as Record<string, unknown>;
    const id = typeof props['id'] === 'string' ? (props['id'] as string) : undefined;
    if (!label || !id) return null;
    return {
      type: this.fromAgeLabel(label),
      id,
      properties: props,
    };
  }

  private agtypeToGraphEdge(value: unknown): GraphEdge | null {
    if (!value || typeof value !== 'object') return null;
    const v = value as Record<string, unknown>;
    const label = typeof v['label'] === 'string' ? (v['label'] as string) : undefined;
    const props = (v['properties'] ?? {}) as Record<string, unknown>;
    if (!label) return null;
    // start_id/end_id есть в agtype-edge, но нам важнее наш `id` свойство —
    // в нашей модели мы храним id endpoint'ов в узлах, а у ребра их нет;
    // в getNeighbors() id endpoint'ов мы берём из a/b отдельно. Поэтому
    // здесь оставляем пустыми — caller сматчит через NeighborResult.nodes.
    return {
      fromId: '',
      fromType: 'entity',
      toId: '',
      toType: 'entity',
      linkType: label as EntityLinkType,
      confidence:
        typeof props['confidence'] === 'number'
          ? (props['confidence'] as number)
          : undefined,
      properties: props,
    };
  }

  /** AGE-метка (job_description) → NodeType (job-description). */
  private fromAgeLabel(label: string): NodeType {
    return label.replace(/_/g, '-') as NodeType;
  }

  private nodeKey(node: GraphNode): string {
    return `${node.type}:${node.id}`;
  }

  /**
   * Upsert строки в одной из «именованных» таблиц (Process/Regulation/Policy/
   * Tool/Metric). Использует Prisma delegate map.
   *
   * Замечание: мы не используем `tx.$transaction(prisma.process.upsert)`,
   * потому что find-then-create — атомарный по unique-ключу, и нам нужен
   * флаг `created` (которого нет у upsert).
   */
  private async upsertNameKeyedEntity(
    tx: Tx,
    tenantId: string,
    type: NodeType,
    name: string,
    data: Record<string, unknown>,
    confidence?: number,
  ): Promise<UpsertEntityResult> {
    const trimmedName = name.trim();
    const confidenceValue =
      confidence !== undefined && confidence >= 0 && confidence <= 1
        ? confidence
        : null;

    switch (type) {
      case 'process': {
        const existing = await tx.process.findUnique({
          where: { tenantId_name: { tenantId, name: trimmedName } },
          select: { id: true },
        });
        if (existing) return { id: existing.id, created: false };
        const created = await tx.process.create({
          data: {
            tenantId,
            name: trimmedName,
            description:
              typeof data['description'] === 'string'
                ? (data['description'] as string)
                : null,
            triggerDescription:
              typeof data['triggerDescription'] === 'string'
                ? (data['triggerDescription'] as string)
                : null,
            slaMinutes:
              typeof data['slaMinutes'] === 'number'
                ? (data['slaMinutes'] as number)
                : null,
            ambiguousTypes: Array.isArray(data['ambiguousTypes'])
              ? (data['ambiguousTypes'] as string[])
              : [],
            confidence: confidenceValue,
          },
          select: { id: true },
        });
        return { id: created.id, created: true };
      }
      case 'regulation': {
        const existing = await tx.regulation.findUnique({
          where: { tenantId_name: { tenantId, name: trimmedName } },
          select: { id: true },
        });
        if (existing) return { id: existing.id, created: false };
        const created = await tx.regulation.create({
          data: {
            tenantId,
            name: trimmedName,
            contentMd:
              typeof data['contentMd'] === 'string'
                ? (data['contentMd'] as string)
                : '',
            confidence: confidenceValue,
          },
          select: { id: true },
        });
        return { id: created.id, created: true };
      }
      case 'policy': {
        const existing = await tx.policy.findUnique({
          where: { tenantId_name: { tenantId, name: trimmedName } },
          select: { id: true },
        });
        if (existing) return { id: existing.id, created: false };
        const created = await tx.policy.create({
          data: {
            tenantId,
            name: trimmedName,
            contentMd:
              typeof data['contentMd'] === 'string'
                ? (data['contentMd'] as string)
                : '',
            confidence: confidenceValue,
          },
          select: { id: true },
        });
        return { id: created.id, created: true };
      }
      case 'tool': {
        const existing = await tx.tool.findUnique({
          where: { tenantId_name: { tenantId, name: trimmedName } },
          select: { id: true },
        });
        if (existing) return { id: existing.id, created: false };
        const created = await tx.tool.create({
          data: {
            tenantId,
            name: trimmedName,
            externalUrl:
              typeof data['externalUrl'] === 'string'
                ? (data['externalUrl'] as string)
                : null,
          },
          select: { id: true },
        });
        return { id: created.id, created: true };
      }
      case 'metric': {
        const existing = await tx.metric.findUnique({
          where: { tenantId_name: { tenantId, name: trimmedName } },
          select: { id: true },
        });
        if (existing) return { id: existing.id, created: false };
        const created = await tx.metric.create({
          data: {
            tenantId,
            name: trimmedName,
            description:
              typeof data['description'] === 'string'
                ? (data['description'] as string)
                : null,
            unit:
              typeof data['unit'] === 'string'
                ? (data['unit'] as string)
                : 'count',
            target:
              typeof data['target'] === 'number'
                ? (data['target'] as number)
                : null,
          },
          select: { id: true },
        });
        return { id: created.id, created: true };
      }
      default:
        throw new BadRequestException(
          `upsertNameKeyedEntity not supported for type=${type}`,
        );
    }
  }

  /**
   * Upsert Decision. Уникальность — `sourceIdeaBlockId` (`@unique` в schema).
   * Если `data.sourceIdeaBlockId` задан и запись существует — возвращает её.
   */
  private async upsertDecision(
    tenantId: string,
    data: Record<string, unknown>,
    sourceProvenance: UpsertEntityParams['sourceProvenance'],
  ): Promise<UpsertEntityResult> {
    const text = data['text'];
    const decidedAtRaw = data['decidedAt'];
    if (typeof text !== 'string' || text.length === 0) {
      throw new BadRequestException(
        'upsertEntity(decision) requires data.text',
      );
    }
    if (!decidedAtRaw) {
      throw new BadRequestException(
        'upsertEntity(decision) requires data.decidedAt',
      );
    }
    const decidedAt =
      decidedAtRaw instanceof Date ? decidedAtRaw : new Date(String(decidedAtRaw));
    if (Number.isNaN(decidedAt.getTime())) {
      throw new BadRequestException(
        'upsertEntity(decision) data.decidedAt must be a valid date',
      );
    }
    const sourceIdeaBlockId =
      typeof data['sourceIdeaBlockId'] === 'string'
        ? (data['sourceIdeaBlockId'] as string)
        : sourceProvenance?.ideaBlockId ?? null;

    // МТЗ Ф5 — РАЗВЯЗКА ТРАНЗАКЦИИ. Decision (Postgres) — источник правды,
    // коммитим ПЕРВЫМ. AGE-узел (MERGE) — post-commit best-effort, не
    // откатывает Decision при отказе cypher(). `id` захватываем из tx.
    const result = await this.prisma.$transaction(async (tx) => {
      if (sourceIdeaBlockId) {
        const existing = await tx.decision.findUnique({
          where: { sourceIdeaBlockId },
          select: { id: true, tenantId: true },
        });
        if (existing && existing.tenantId === tenantId) {
          return { id: existing.id, created: false };
        }
      }
      const created = await tx.decision.create({
        data: {
          tenantId,
          text,
          rationale:
            typeof data['rationale'] === 'string'
              ? (data['rationale'] as string)
              : null,
          decidedAt,
          decidedByPersonId:
            typeof data['decidedByPersonId'] === 'string'
              ? (data['decidedByPersonId'] as string)
              : null,
          sourceMeetingId:
            typeof data['sourceMeetingId'] === 'string'
              ? (data['sourceMeetingId'] as string)
              : null,
          sourceIdeaBlockId,
        },
        select: { id: true },
      });
      return { id: created.id, created: true };
    });

    // AGE-узел Decision — после коммита бизнес-строки (best-effort).
    try {
      await this.runCypherMergeNode(this.prisma, tenantId, 'decision', result.id);
    } catch (err) {
      this.logger.warn(
        {
          node: `decision:${result.id}`,
          err: err instanceof Error ? err.message : String(err),
        },
        'upsertDecision: AGE MERGE узла упал (post-commit best-effort) — Decision сохранён',
      );
    }

    return result;
  }
}

// Заглушка экспорта типов наружу, чтобы тесты могли импортить NodeRef в одной
// строке вместе с GraphService.
export type { NodeRef };
