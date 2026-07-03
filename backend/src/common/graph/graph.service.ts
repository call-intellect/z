import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { type EntityLinkType, type LinkCreatedBy, Prisma } from '@prisma/client';

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

const DEFAULT_EXPLANATION = 'manual';

const MAX_DEPTH_NEIGHBORS = 5;
const MAX_DEPTH_FIND_PATH = 10;
const DEFAULT_NEIGHBOR_LIMIT = 100;

type Tx = Prisma.TransactionClient;

const UPSERTABLE_BY_NAME: Partial<Record<NodeType, keyof Tx>> = {
  process: 'process',
  regulation: 'regulation',
  policy: 'policy',
  tool: 'tool',
  metric: 'metric',
};

@Injectable()
export class GraphService {
  private readonly logger = new Logger(GraphService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cfg: TypedConfigService,
  ) {}

  async addNode(params: AddNodeParams): Promise<void> {
    const { tenantId, type, id, properties } = params;
    if (!tenantId || !id) {
      throw new BadRequestException('tenantId and id required');
    }

    await this.runCypherMergeNode(this.prisma, tenantId, type, id, properties);
  }

  async removeNode(params: RemoveNodeParams): Promise<void> {
    const { tenantId, type, id } = params;
    if (!tenantId || !id) {
      throw new BadRequestException('tenantId and id required');
    }
    const label = CypherBuilder.toAgeLabel(type);

    await this.prisma.$transaction(async (tx) => {
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
    CypherBuilder.toAgeLabel(from.type);
    CypherBuilder.toAgeLabel(to.type);
    CypherBuilder.toRelType(linkType);

    if (confidence !== undefined && (confidence < 0 || confidence > 1)) {
      throw new BadRequestException('confidence must be in [0,1]');
    }

    const effectiveConfidence = confidence !== undefined ? confidence : 1.0;
    const effectiveCreatedBy: LinkCreatedBy = createdBy ?? 'manual';
    const effectiveValidFrom = validFrom ?? new Date();
    const effectiveValidTo = validTo ?? null;
    const effectiveExplanation = explanation ?? DEFAULT_EXPLANATION;
    const effectiveProperties = properties ?? {};

    await this.prisma.$transaction(async (tx) => {
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

    try {
      await this.runCypherMergeNode(this.prisma, tenantId, from.type, from.id);
      await this.runCypherMergeNode(this.prisma, tenantId, to.type, to.id);

      const baseMerge = CypherBuilder.buildMergeEdge({
        fromType: from.type,
        fromId: from.id,
        toType: to.type,
        toId: to.id,
        linkType,
        tenantId,
      });
      const validFromIso = effectiveValidFrom.toISOString();
      const validToIso = effectiveValidTo ? effectiveValidTo.toISOString() : null;
      const propsJson = CypherBuilder.escapeString(JSON.stringify(effectiveProperties));
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

  async removeEdge(params: RemoveEdgeParams): Promise<void> {
    const { tenantId, from, to, linkType, deletedBy } = params;
    if (!tenantId || !from?.id || !to?.id) {
      throw new BadRequestException('tenantId, from.id and to.id required');
    }
    CypherBuilder.toAgeLabel(from.type);
    CypherBuilder.toAgeLabel(to.type);
    CypherBuilder.toRelType(linkType);

    await this.prisma.$transaction(async (tx) => {
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
      throw new BadRequestException(`depth must be in [1,${MAX_DEPTH_NEIGHBORS}]`);
    }

    const startLabel = CypherBuilder.toAgeLabel(node.type);
    const safeId = CypherBuilder.escapeString(node.id);
    const safeTenant = CypherBuilder.escapeString(tenantId);

    const arrow =
      direction === 'out' ? '-[r*1..%d]->' : direction === 'in' ? '<-[r*1..%d]-' : '-[r*1..%d]-';
    const arrowExpanded = arrow.replace('%d', String(depth));

    const relTypeList = CypherBuilder.buildRelTypeFilter(linkTypes);
    const whereRelTypes = relTypeList
      ? ` AND ALL(rel IN r WHERE type(rel) IN [${relTypeList}])`
      : '';

    const cypher =
      `MATCH (a:${startLabel} {id: '${safeId}', tenant_id: '${safeTenant}'})` +
      `${arrowExpanded}(b) ` +
      `WHERE b.tenant_id = '${safeTenant}'${whereRelTypes} ` +
      `RETURN a, r, b LIMIT ${Math.max(1, Math.min(limit, 10_000))}`;

    const rows = await this.runRawCypherRows(this.prisma, cypher);
    return this.parseNeighborRows(rows);
  }

  async findPath(params: FindPathParams): Promise<PathResult> {
    const { tenantId, from, to, maxDepth = 5, linkTypes } = params;
    if (!tenantId || !from?.id || !to?.id) {
      throw new BadRequestException('tenantId, from.id and to.id required');
    }
    if (maxDepth < 1 || maxDepth > MAX_DEPTH_FIND_PATH) {
      throw new BadRequestException(`maxDepth must be in [1,${MAX_DEPTH_FIND_PATH}]`);
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

  async traverse(params: TraverseParams): Promise<unknown[]> {
    const { tenantId, start, cypher, bindings } = params;
    if (!tenantId || !start?.id) {
      throw new BadRequestException('tenantId and start.id required');
    }
    if (!cypher || typeof cypher !== 'string') {
      throw new BadRequestException('cypher string required');
    }
    CypherBuilder.toAgeLabel(start.type);

    if (bindings && Object.keys(bindings).length > 0) {
      this.logger.warn(
        `traverse() called with bindings (${Object.keys(bindings).join(',')}); ` +
          `bindings inline-substitution is not supported yet — inline values into cypher string`,
      );
    }

    const rows = await this.runRawCypherRows(this.prisma, cypher);
    return rows;
  }

  async upsertEntity(params: UpsertEntityParams): Promise<UpsertEntityResult> {
    const { tenantId, type, data, sourceProvenance, confidence } = params;
    if (!tenantId) throw new BadRequestException('tenantId required');

    if (type === 'mission' || type === 'vision' || type === 'strategy') {
      throw new BadRequestException(
        `upsertEntity for type=${type} requires EXTRACTION_ENABLE_TOP_LEVEL flag (not enabled)`,
      );
    }

    if (type === 'decision') {
      return this.upsertDecision(tenantId, data, sourceProvenance);
    }

    if (!UPSERTABLE_BY_NAME[type]) {
      throw new BadRequestException(`upsertEntity not supported for type=${type}`);
    }
    const name = data['name'];
    if (typeof name !== 'string' || name.length === 0) {
      throw new BadRequestException(
        `upsertEntity for type=${type} requires data.name (non-empty string)`,
      );
    }

    const result = await this.prisma.$transaction(async (tx) =>
      this.upsertNameKeyedEntity(tx, tenantId, type, name, data, confidence),
    );

    if (result.created && sourceProvenance) {
      this.logger.debug(
        `upsertEntity: created ${type}=${result.id} (provenance: ` +
          `${JSON.stringify(sourceProvenance)})`,
      );
    }

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

  async mergeEdgeGraphOnly(params: {
    tenantId: string;
    from: NodeRef;
    to: NodeRef;
    linkType: EntityLinkType;
    confidence?: number;
    validFrom?: Date;
    validTo?: Date | null;
    properties?: Record<string, unknown>;
  }): Promise<void> {
    const { tenantId, from, to, linkType } = params;
    if (!tenantId || !from?.id || !to?.id) {
      throw new BadRequestException('tenantId, from.id and to.id required');
    }
    CypherBuilder.toAgeLabel(from.type);
    CypherBuilder.toAgeLabel(to.type);
    CypherBuilder.toRelType(linkType);
    await this.runCypherMergeNode(this.prisma, tenantId, from.type, from.id);
    await this.runCypherMergeNode(this.prisma, tenantId, to.type, to.id);
    const baseMerge = CypherBuilder.buildMergeEdge({
      fromType: from.type,
      fromId: from.id,
      toType: to.type,
      toId: to.id,
      linkType,
      tenantId,
    });
    const conf = params.confidence !== undefined ? params.confidence : 1.0;
    const validFromIso = (params.validFrom ?? new Date()).toISOString();
    const validToIso = params.validTo ? params.validTo.toISOString() : null;
    const propsJson = CypherBuilder.escapeString(JSON.stringify(params.properties ?? {}));
    const setProps =
      ` SET r.confidence = ${conf.toFixed(3)},` +
      ` r.valid_from = '${validFromIso}',` +
      ` r.valid_to = ${validToIso ? `'${validToIso}'` : 'NULL'},` +
      ` r.properties = '${propsJson}'`;
    await this.runRawCypher(this.prisma, baseMerge + setProps);
  }

  async deleteEdgeGraphOnly(params: {
    tenantId: string;
    from: NodeRef;
    to: NodeRef;
    linkType: EntityLinkType;
  }): Promise<void> {
    const { tenantId, from, to, linkType } = params;
    if (!tenantId || !from?.id || !to?.id) {
      throw new BadRequestException('tenantId, from.id and to.id required');
    }
    const cypher = CypherBuilder.buildDeleteEdge({
      fromType: from.type,
      fromId: from.id,
      toType: to.type,
      toId: to.id,
      linkType,
      tenantId,
    });
    await this.runRawCypher(this.prisma, cypher);
  }

  async deleteNodeGraphOnly(params: {
    tenantId: string;
    type: NodeType;
    id: string;
  }): Promise<void> {
    const { tenantId, type, id } = params;
    if (!tenantId || !id) {
      throw new BadRequestException('tenantId and id required');
    }
    const label = CypherBuilder.toAgeLabel(type);
    const cypher =
      `MATCH (n:${label} {id: '${CypherBuilder.escapeString(id)}', ` +
      `tenant_id: '${CypherBuilder.escapeString(tenantId)}'}) DETACH DELETE n`;
    await this.runRawCypher(this.prisma, cypher);
  }

  private async runCypherMergeNode(
    client: PrismaService | Tx,
    tenantId: string,
    type: NodeType,
    id: string,
    properties?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.cfg.graph.ageEnabled) return;
    const merge = CypherBuilder.buildMergeNode(type, id, tenantId);
    let cypher = merge;
    if (properties && Object.keys(properties).length > 0) {
      const propsJson = CypherBuilder.escapeString(JSON.stringify(properties));
      cypher = `${merge} SET n.properties = '${propsJson}'`;
    }
    await this.runRawCypher(client, cypher);
  }

  private async runRawCypher(client: PrismaService | Tx, cypher: string): Promise<void> {
    if (!this.cfg.graph.ageEnabled) return;
    const quoted = CypherBuilder.dollarQuote(cypher);
    const sql = `SELECT * FROM cypher('${Z_GRAPH}', ${quoted}) AS (v agtype)`;
    await client.$queryRawUnsafe(sql);
  }

  private async runRawCypherRows(
    client: PrismaService | Tx,
    cypher: string,
  ): Promise<Array<Record<string, unknown>>> {
    const quoted = CypherBuilder.dollarQuote(cypher);
    const sql = `SELECT * FROM cypher('${Z_GRAPH}', ${quoted}) AS (v agtype)`;
    try {
      const result = await client.$queryRawUnsafe<Array<Record<string, unknown>>>(sql);
      return result ?? [];
    } catch (err) {
      const sqlMulti =
        `SELECT * FROM cypher('${Z_GRAPH}', ${quoted}) ` + `AS (a agtype, r agtype, b agtype)`;
      try {
        const result = await client.$queryRawUnsafe<Array<Record<string, unknown>>>(sqlMulti);
        return result ?? [];
      } catch {
        throw err;
      }
    }
  }

  private parseNeighborRows(rows: Array<Record<string, unknown>>): NeighborResult {
    const nodes = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];

    for (const row of rows) {
      const a = this.parseAgtype(row['a']);
      const b = this.parseAgtype(row['b']);
      const r = this.parseAgtype(row['r']);

      const aNode = this.agtypeToGraphNode(a);
      if (aNode) nodes.set(this.nodeKey(aNode), aNode);

      const bNode = this.agtypeToGraphNode(b);
      if (bNode) nodes.set(this.nodeKey(bNode), bNode);

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

  private parsePathRow(row: Record<string, unknown>): PathResult {
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

  private parseAgtype(value: unknown): unknown {
    if (value == null) return null;
    if (typeof value === 'object') return value;
    if (typeof value === 'string') {
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
    return {
      fromId: '',
      fromType: 'entity',
      toId: '',
      toType: 'entity',
      linkType: label as EntityLinkType,
      confidence:
        typeof props['confidence'] === 'number' ? (props['confidence'] as number) : undefined,
      properties: props,
    };
  }

  private fromAgeLabel(label: string): NodeType {
    return label.replace(/_/g, '-') as NodeType;
  }

  private nodeKey(node: GraphNode): string {
    return `${node.type}:${node.id}`;
  }

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
      confidence !== undefined && confidence >= 0 && confidence <= 1 ? confidence : null;

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
              typeof data['description'] === 'string' ? (data['description'] as string) : null,
            triggerDescription:
              typeof data['triggerDescription'] === 'string'
                ? (data['triggerDescription'] as string)
                : null,
            slaMinutes:
              typeof data['slaMinutes'] === 'number' ? (data['slaMinutes'] as number) : null,
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
            contentMd: typeof data['contentMd'] === 'string' ? (data['contentMd'] as string) : '',
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
            contentMd: typeof data['contentMd'] === 'string' ? (data['contentMd'] as string) : '',
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
              typeof data['externalUrl'] === 'string' ? (data['externalUrl'] as string) : null,
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
              typeof data['description'] === 'string' ? (data['description'] as string) : null,
            unit: typeof data['unit'] === 'string' ? (data['unit'] as string) : 'count',
            target: typeof data['target'] === 'number' ? (data['target'] as number) : null,
          },
          select: { id: true },
        });
        return { id: created.id, created: true };
      }
      default:
        throw new BadRequestException(`upsertNameKeyedEntity not supported for type=${type}`);
    }
  }

  private async upsertDecision(
    tenantId: string,
    data: Record<string, unknown>,
    sourceProvenance: UpsertEntityParams['sourceProvenance'],
  ): Promise<UpsertEntityResult> {
    const text = data['text'];
    const decidedAtRaw = data['decidedAt'];
    if (typeof text !== 'string' || text.length === 0) {
      throw new BadRequestException('upsertEntity(decision) requires data.text');
    }
    if (!decidedAtRaw) {
      throw new BadRequestException('upsertEntity(decision) requires data.decidedAt');
    }
    const decidedAt = decidedAtRaw instanceof Date ? decidedAtRaw : new Date(String(decidedAtRaw));
    if (Number.isNaN(decidedAt.getTime())) {
      throw new BadRequestException('upsertEntity(decision) data.decidedAt must be a valid date');
    }
    const sourceIdeaBlockId =
      typeof data['sourceIdeaBlockId'] === 'string'
        ? (data['sourceIdeaBlockId'] as string)
        : (sourceProvenance?.ideaBlockId ?? null);

    let result: { id: string; created: boolean };
    try {
      result = await this.prisma.$transaction(async (tx) => {
        if (sourceIdeaBlockId) {
          const existing = await tx.decision.findUnique({
            where: { sourceIdeaBlockId },
            select: { id: true, tenantId: true },
          });
          if (existing) {
            if (existing.tenantId === tenantId) {
              return { id: existing.id, created: false };
            }
            this.logger.warn(
              {
                sourceIdeaBlockId,
                existingTenantId: existing.tenantId,
                tenantId,
              },
              'upsertDecision: sourceIdeaBlockId другого тенанта — отказ создания (анти-P2002 cross-tenant)',
            );
            throw new ConflictException(
              'upsertEntity(decision): sourceIdeaBlockId принадлежит другому тенанту',
            );
          }
        }
        const created = await tx.decision.create({
          data: {
            tenantId,
            text,
            rationale: typeof data['rationale'] === 'string' ? (data['rationale'] as string) : null,
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
    } catch (err) {
      if (
        sourceIdeaBlockId &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002' &&
        this.isUniqueTarget(err, 'sourceIdeaBlockId')
      ) {
        const existing = await this.prisma.decision.findFirst({
          where: { tenantId, sourceIdeaBlockId },
          select: { id: true },
        });
        if (!existing) throw err;
        this.logger.warn(
          { sourceIdeaBlockId, tenantId },
          'upsertDecision: P2002 sourceIdeaBlockId — гонка писателей, возвращаю существующий Decision (без потери)',
        );
        result = { id: existing.id, created: false };
      } else {
        throw err;
      }
    }

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

  private isUniqueTarget(
    err: Prisma.PrismaClientKnownRequestError,
    field: string,
  ): boolean {
    const target = err.meta?.['target'];
    if (Array.isArray(target)) return target.includes(field);
    return typeof target === 'string' && target.includes(field);
  }
}

export type { NodeRef };
