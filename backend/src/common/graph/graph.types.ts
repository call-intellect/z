import type { EntityLinkType, LinkCreatedBy } from '@prisma/client';

/**
 * Полный список типов узлов графа Z (Фаза 0a, см.
 * `plans/tz/2026-05-21-phase-0a-data-model-and-graph-infra.md` §6).
 *
 * Группы:
 *   - Группа А (Person/Role/Department/Skill/JobDescription/Document/RoleProfile)
 *     — наполняется через wizard + admin UI.
 *   - Группа Б (Mission/Vision/Strategy/Process/ProcessStep/Regulation/Policy/
 *     Tool/Metric/Decision) — наполняется через extraction (Фаза 0b).
 *   - Legacy knowledge-core (entity/goal/meeting/idea-block/theme) — уже живут
 *     в Postgres + могут быть отражены в AGE для cross-domain обхода.
 *
 * Метка узла в AGE — нормализованный `NodeType` (тире → подчёркивание),
 * см. `CypherBuilder.toAgeLabel()`.
 */
export type NodeType =
  | 'role'
  | 'department'
  | 'person'
  | 'job-description'
  | 'skill'
  | 'document'
  | 'role-profile'
  | 'mission'
  | 'vision'
  | 'strategy'
  | 'process'
  | 'process-step'
  | 'regulation'
  | 'policy'
  | 'tool'
  | 'metric'
  | 'decision'
  | 'entity'
  | 'goal'
  | 'meeting'
  | 'idea-block'
  | 'theme';

/**
 * Полный whitelist `NodeType`. Используется CypherBuilder для валидации —
 * никакая внешняя строка не должна попадать в Cypher без проверки по списку.
 */
export const ALL_NODE_TYPES: readonly NodeType[] = [
  'role',
  'department',
  'person',
  'job-description',
  'skill',
  'document',
  'role-profile',
  'mission',
  'vision',
  'strategy',
  'process',
  'process-step',
  'regulation',
  'policy',
  'tool',
  'metric',
  'decision',
  'entity',
  'goal',
  'meeting',
  'idea-block',
  'theme',
] as const;

/**
 * Ссылка на узел графа (дуальная: type + id). Используется во всех методах
 * `GraphService`, чтобы исключить путаницу «откуда id» (Entity, Role, Person, …).
 */
export interface NodeRef {
  type: NodeType;
  id: string;
}

/**
 * Параметры `GraphService.addNode`. Идемпотентно: повторный вызов с тем же
 * `(tenantId, type, id)` не должен падать.
 *
 * `properties` — произвольная Json-полезная нагрузка узла в AGE. На уровне
 * Postgres узлы не записываются: вершины бизнес-сущностей живут в своих
 * таблицах (`Person`, `Role`, `Process`, …). AGE-узел — лишь зеркало для
 * Cypher-обхода.
 */
export interface AddNodeParams {
  tenantId: string;
  type: NodeType;
  id: string;
  properties?: Record<string, unknown>;
}

export interface RemoveNodeParams {
  tenantId: string;
  type: NodeType;
  id: string;
}

/**
 * Параметры `GraphService.addEdge`. Двойная запись: `EntityLink` в Postgres
 * (composite unique по `[fromEntityId, fromType, toEntityId, toType, relationType]`)
 * + AGE-ребро через Cypher `MERGE`.
 *
 * Дефолты:
 *   - `confidence` = 1.0 (для `createdBy=manual`).
 *   - `createdBy` = `manual` (для пользовательских действий CRUD API).
 *   - `validFrom` = now().
 *   - `validTo` = null (открытое во времени).
 *   - `properties` = {}.
 */
export interface AddEdgeParams {
  tenantId: string;
  from: NodeRef;
  to: NodeRef;
  linkType: EntityLinkType;
  validFrom?: Date;
  validTo?: Date | null;
  properties?: Record<string, unknown>;
  /** 0..1; для manual обычно 1.0; для linker — вердикт LLM-арбитра. */
  confidence?: number;
  /** Объяснение связи (короткая фраза). По умолчанию — `'manual'`. */
  explanation?: string;
  createdBy?: LinkCreatedBy;
}

export interface RemoveEdgeParams {
  tenantId: string;
  from: NodeRef;
  to: NodeRef;
  linkType: EntityLinkType;
  /** userId, инициировавший удаление (для аудита). */
  deletedBy?: string;
}

/**
 * Параметры `GraphService.getNeighbors`. Direction `out` — где узел является
 * `from`, `in` — где `to`, `both` — обе стороны. `depth` > 1 — обход по
 * Cypher `[*1..depth]`.
 */
export interface GetNeighborsParams {
  tenantId: string;
  node: NodeRef;
  linkTypes?: EntityLinkType[];
  direction?: 'in' | 'out' | 'both';
  /** Глубина обхода (по умолчанию 1). Жёсткий потолок — 5. */
  depth?: number;
  /** Лимит соседей в ответе (по умолчанию 100). */
  limit?: number;
}

export interface GraphNode {
  type: NodeType;
  id: string;
  properties?: Record<string, unknown>;
}

export interface GraphEdge {
  fromId: string;
  fromType: NodeType;
  toId: string;
  toType: NodeType;
  linkType: EntityLinkType;
  confidence?: number;
  validFrom?: Date;
  validTo?: Date | null;
  properties?: Record<string, unknown>;
}

export interface NeighborResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Параметры `GraphService.findPath`. Cypher `MATCH p = shortestPath((a)-[*..maxDepth]-(b))`.
 *
 * `linkTypes` — если задан, ограничивает рёбра пути списком типов. По
 * умолчанию — любые рёбра в пределах `tenantId`.
 */
export interface FindPathParams {
  tenantId: string;
  from: NodeRef;
  to: NodeRef;
  /** По умолчанию 5; жёсткий потолок 10 (защита от взрыва обхода). */
  maxDepth?: number;
  linkTypes?: EntityLinkType[];
}

export interface PathResult {
  /** Узлы пути в порядке обхода. `[]` если пути нет. */
  nodes: GraphNode[];
  /** Рёбра между соседними узлами `nodes[i] → nodes[i+1]`. */
  edges: GraphEdge[];
  /** Длина пути (= `edges.length`). 0 если пути нет. */
  length: number;
}

/**
 * Параметры `GraphService.traverse` — **escape-hatch**. Используется только
 * внутри `common/graph/` или специализированных воркеров (например,
 * `RoleProfileAgent`). См. §6.3 ТЗ Фазы 0a (запрет прямого Cypher из бизнес-
 * сервисов).
 *
 * `bindings` подставляются в Cypher как параметры (через JSONB-параметр AGE).
 * Подстановка строковых меток (`:role`, тип ребра) — **через whitelist в
 * CypherBuilder**, не через bindings.
 */
export interface TraverseParams {
  tenantId: string;
  start: NodeRef;
  cypher: string;
  bindings?: Record<string, unknown>;
}

/**
 * Параметры `GraphService.upsertEntity` — высокоуровневый upsert для
 * extraction (Фаза 0b §6.2). Поддерживаемые `NodeType`:
 *   - `'process'`, `'regulation'`, `'policy'`, `'tool'`, `'metric'`,
 *     `'decision'` — поиск по `(tenantId, name)` (`@@unique` в schema.prisma).
 *   - `'mission' | 'vision' | 'strategy'` — только если включён фичефлаг
 *     `EXTRACTION_ENABLE_TOP_LEVEL` (Фаза δ); иначе бросаем `BadRequestException`.
 *
 * `data` — поля бизнес-таблицы (имя/описание/etc). Для name-based upsert
 * обязательно `data.name`. Для `decision` — обязательно `data.text` +
 * `data.decidedAt` (decision дедуплицируется по `sourceIdeaBlockId`).
 *
 * `sourceProvenance` — откуда extraction (для аудита и обратных ссылок).
 * Сейчас не пишется в БД (нет таблицы Provenance), но логируется.
 */
export interface UpsertEntityParams {
  tenantId: string;
  type: NodeType;
  data: Record<string, unknown>;
  sourceProvenance?: {
    rawEventId?: string;
    ideaBlockId?: string;
    documentId?: string;
  };
  /** 0..1; пишется в `<Entity>.confidence` для Process/Regulation/Policy. */
  confidence?: number;
}

export interface UpsertEntityResult {
  id: string;
  /** true — новая строка; false — найдена существующая по unique-ключу. */
  created: boolean;
}
