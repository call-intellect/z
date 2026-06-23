import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { buildVectorLiteral } from '../../embeddings/services/vector-literal.util';

import { KnowledgeEmbeddingService } from './embedding.service';
import {
  buildRoleScopeFilter,
  rankRegulations,
  type RegulationKind,
  type RegulationSeverity,
  type RetrievedRegulation,
} from './role-scope.util';

interface TableSpec {
  kind: RegulationKind;
  table: string;
  textExpr: string;
  severityExpr: string;
}

interface RawRegulationRow {
  id: string;
  name: string;
  text: string | null;
  scope: string | null;
  severity: string | null;
  distance: number | string;
}

@Injectable()
export class RoleRegulationRetrievalService {
  private readonly logger = new Logger(RoleRegulationRetrievalService.name);

  private static readonly TEXT_EXCERPT_LEN = 600;

  private static readonly TABLE_SPECS: ReadonlyArray<TableSpec> = [
    {
      kind: 'regulation',
      table: 'regulations',
      textExpr: `COALESCE(NULLIF("statement",''), LEFT("contentMd", ${RoleRegulationRetrievalService.TEXT_EXCERPT_LEN}))`,
      severityExpr: `NULL::text`,
    },
    {
      kind: 'instruction',
      table: 'instructions',
      textExpr: `COALESCE(NULLIF("statement",''), LEFT("contentMd", ${RoleRegulationRetrievalService.TEXT_EXCERPT_LEN}))`,
      severityExpr: `NULL::text`,
    },
    {
      kind: 'policy',
      table: 'policies',
      textExpr: `LEFT("contentMd", ${RoleRegulationRetrievalService.TEXT_EXCERPT_LEN})`,
      severityExpr: `"severity"::text`,
    },
    {
      kind: 'process',
      table: 'processes',
      textExpr: `COALESCE(NULLIF("description",''), '')`,
      severityExpr: `NULL::text`,
    },
  ];

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(KnowledgeEmbeddingService)
    private readonly embedder: KnowledgeEmbeddingService,
  ) {}

  async retrieveForRole(args: {
    tenantId: string;
    roleId: string;
    query: string;
    departmentId?: string | null;
  }): Promise<RetrievedRegulation[]> {
    const trimmed = args.query.trim();
    if (!trimmed) return [];

    const [topN, maxDistance, includeOrg] = await Promise.all([
      this.cfg.getDynamic<number>('clone.regulations.retrieval.top_n', undefined, 6),
      this.cfg.getDynamic<number>('clone.regulations.retrieval.min_similarity', undefined, 0.3),
      this.cfg.getDynamic<boolean>('clone.regulations.scope.include_org', undefined, true),
    ]);

    let queryVec: number[] | null;
    try {
      queryVec = await this.embedder.embedQuery(trimmed);
    } catch (err) {
      this.logger.debug(
        `role-regulations.retrieval: embedQuery failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
    if (!queryVec) return [];

    const expectedDim = this.cfg.ai?.embeddings?.dimensions ?? 1536;
    const guard = buildVectorLiteral(queryVec, expectedDim);
    if (guard.literal === null) {
      this.logger.debug(
        `role-regulations.retrieval: query-вектор отвергнут guard-ом (${guard.rejectReason}, actualDim=${queryVec.length}, expectedDim=${expectedDim}) — []`,
      );
      return [];
    }
    const vecLiteral = guard.literal;

    const scopes = buildRoleScopeFilter({
      roleId: args.roleId,
      includeOrg,
      departmentId: args.departmentId ?? null,
    });
    const perTable = Math.max(topN, 4);

    const allRows: RetrievedRegulation[] = [];
    for (const spec of RoleRegulationRetrievalService.TABLE_SPECS) {
      const sql = `SELECT "id", "name", ${spec.textExpr} AS "text", "scope", ${spec.severityExpr} AS "severity",
       ("embedding" <=> $1::vector) AS "distance"
  FROM "${spec.table}"
 WHERE "tenantId" = $2
   AND "deletedAt" IS NULL
   AND "status"::text = 'active'
   AND "embedding" IS NOT NULL
   AND "scope" = ANY($3::text[])
   AND ("embedding" <=> $1::vector) <= $4
 ORDER BY "distance" ASC
 LIMIT ${perTable}`;
      try {
        const rows = await this.prisma.$queryRawUnsafe<RawRegulationRow[]>(
          sql,
          vecLiteral,
          args.tenantId,
          scopes,
          maxDistance,
        );
        for (const r of rows) {
          allRows.push({
            kind: spec.kind,
            id: r.id,
            name: r.name,
            text: r.text ?? '',
            severity: this.normalizeSeverity(r.severity),
            scope: r.scope ?? null,
            distance: Number(r.distance),
          });
        }
      } catch (err) {
        this.logger.debug(
          `role-regulations.retrieval: запрос по "${spec.table}" упал: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const ranked = rankRegulations(allRows, topN);
    this.logger.debug(
      `role-regulations.retrieval: { tenantId: ${args.tenantId}, roleId: ${args.roleId}, found: ${ranked.length} }`,
    );
    return ranked;
  }

  private normalizeSeverity(value: string | null): RegulationSeverity | null {
    if (value === 'advisory' || value === 'mandatory' || value === 'blocking') return value;
    return null;
  }
}
