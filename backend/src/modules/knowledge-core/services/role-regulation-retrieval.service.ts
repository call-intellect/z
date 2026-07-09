import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { buildVectorLiteral } from '../../embeddings/services/vector-literal.util';

import { KnowledgeEmbeddingService } from './embedding.service';
import {
  buildRoleScopeFilter,
  rankRegulations,
  type RegulationKind,
  type RegulationSeverity,
  type RegulationSnapshotItem,
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

interface OwnedCandidate {
  kind: RegulationKind;
  id: string;
  name: string;
  text: string;
  severity: RegulationSeverity | null;
  scope: string | null;
  summary: string | null;
}

type ContextLevel = 'names' | 'summary' | 'fulltext';

const ROUTER_SYSTEM = [
  'Ты — маршрутизатор правил роли. На входе: вопрос сотрудника и НУМЕРОВАННЫЙ список правил его роли (у каждого — id).',
  'Задача: вернуть id ТОЛЬКО тех правил из списка, которые прямо релевантны вопросу (как правило 1, максимум 3).',
  'Если НИ ОДНО правило из списка не отвечает на вопрос — верни пустой список.',
  'НИКОГДА не выдумывай id — бери строго из данного списка. Не объясняй, верни только JSON.',
  'Формат ответа: {"ids": ["<id>", ...]}',
].join('\n');

@Injectable()
export class RoleRegulationRetrievalService {
  private readonly logger = new Logger(RoleRegulationRetrievalService.name);

  private static readonly TEXT_EXCERPT_LEN = 600;
  private static readonly ROUTER_TEXT_LEN = 1200;

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
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
  ) {}

  async retrieveForRole(args: {
    tenantId: string;
    roleId: string;
    query: string;
    departmentId?: string | null;
  }): Promise<RetrievedRegulation[]> {
    const trimmed = args.query.trim();
    if (!trimmed) return [];

    const routerEnabled = await this.cfg.getDynamic<boolean>(
      'clone.regulations.router.enabled',
      undefined,
      true,
    );
    if (routerEnabled) {
      try {
        return await this.retrieveViaRouter({ ...args, query: trimmed });
      } catch (err) {
        this.logger.debug(
          `role-regulations.retrieval: router упал — фолбэк на вектор: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return this.retrieveViaVector({ ...args, query: trimmed });
  }

  private async retrieveViaRouter(args: {
    tenantId: string;
    roleId: string;
    query: string;
    departmentId?: string | null;
  }): Promise<RetrievedRegulation[]> {
    const [contextLevel, maxTokens, maxPool, model, topN, includeOrg] = await Promise.all([
      this.cfg.getDynamic<ContextLevel>('clone.regulations.router.context_level', undefined, 'summary'),
      this.cfg.getDynamic<number>('clone.regulations.router.max_tokens', undefined, 1500),
      this.cfg.getDynamic<number>('clone.regulations.router.max_pool', undefined, 60),
      this.cfg.getDynamic<string>('clone.regulations.router.model', undefined, 'deepseek-v4-flash'),
      this.cfg.getDynamic<number>('clone.regulations.retrieval.top_n', undefined, 6),
      this.cfg.getDynamic<boolean>('clone.regulations.scope.include_org', undefined, true),
    ]);

    const departmentId = await this.resolveDepartmentId(
      args.tenantId,
      args.roleId,
      args.departmentId,
    );
    const owned = await this.resolveOwnedRules({
      tenantId: args.tenantId,
      roleId: args.roleId,
      departmentId,
      includeOrg,
      maxPool,
    });
    if (owned.length === 0) return [];

    const context = owned
      .map((c, i) => this.renderCandidate(contextLevel, i, c))
      .join('\n');
    const userMessage = `ВОПРОС: ${args.query}\n\nПРАВИЛА РОЛИ:\n${context}\n\nВерни JSON {"ids":[...]}.`;

    const res = await this.llm.call({
      taskType: 'clone-respond',
      model,
      tenantId: args.tenantId,
      dataClass: 'internal',
      maxTokens,
      responseFormat: { type: 'json_object' },
      systemPrompt: ROUTER_SYSTEM,
      userMessage,
      sourceRef: { type: 'clone-regulation-router', id: args.roleId },
    });

    const byId = new Map(owned.map((c) => [c.id, c]));
    const selected: RetrievedRegulation[] = [];
    const seen = new Set<string>();
    for (const id of this.parseIds(res.text)) {
      const c = byId.get(id);
      if (!c || seen.has(id)) continue;
      seen.add(id);
      selected.push({
        kind: c.kind,
        id: c.id,
        name: c.name,
        text: c.text,
        severity: c.severity,
        scope: c.scope,
        distance: 0,
      });
    }

    const ranked = rankRegulations(selected, topN);
    this.logger.debug(
      `role-regulations.router: { tenantId: ${args.tenantId}, roleId: ${args.roleId}, pool: ${owned.length}, selected: ${ranked.length}, ctx: ${contextLevel} }`,
    );
    return ranked;
  }

  private renderCandidate(level: ContextLevel, index: number, c: OwnedCandidate): string {
    const head = `${index + 1}. id=${c.id} | ${c.name}`;
    if (level === 'names') return head;
    if (level === 'fulltext') return `${head} — ${c.text.slice(0, RoleRegulationRetrievalService.ROUTER_TEXT_LEN)}`;
    const summary = (c.summary ?? '').trim();
    return summary ? `${head} — ${summary}` : head;
  }

  private async resolveOwnedRules(args: {
    tenantId: string;
    roleId: string;
    departmentId: string | null;
    includeOrg: boolean;
    maxPool: number;
  }): Promise<OwnedCandidate[]> {
    const role = await this.prisma.role.findFirst({
      where: { id: args.roleId, tenantId: args.tenantId },
      select: { name: true },
    });
    const roleName = role?.name?.trim() ?? null;

    const bearers = await this.prisma.personRole.findMany({
      where: {
        tenantId: args.tenantId,
        roleId: args.roleId,
        OR: [{ validTo: null }, { validTo: { gt: new Date() } }],
      },
      select: { personId: true, person: { select: { name: true } } },
    });
    const personIds = [...new Set(bearers.map((b) => b.personId))];
    const bearerNames = [
      ...new Set(bearers.map((b) => b.person?.name?.trim()).filter((n): n is string => !!n)),
    ];

    const roleScopes = [`role:${args.roleId}`];
    if (roleName) roleScopes.push(`role:${roleName}`);
    for (const n of bearerNames) roleScopes.push(`role:${n}`);
    const sharedScopes: string[] = [];
    if (args.includeOrg) sharedScopes.push('org');
    if (args.departmentId) sharedScopes.push(`department:${args.departmentId}`);
    const scopeValues = [...new Set([...roleScopes, ...sharedScopes])];
    const forRoleValues = [...new Set([args.roleId, roleName, ...bearerNames].filter((v): v is string => !!v))];

    const base = { tenantId: args.tenantId, deletedAt: null, status: 'active' as const };
    const scopeOr = { scope: { in: scopeValues } };
    const personOr = personIds.length > 0 ? [{ ownerPersonId: { in: personIds } }] : [];
    const take = Math.max(20, Math.ceil(args.maxPool) * 2);

    const [regs, instrs, pols, procs] = await Promise.all([
      this.safeFindMany('regulation', () =>
        this.prisma.regulation.findMany({
          where: { ...base, OR: [scopeOr, ...personOr] },
          select: { id: true, name: true, statement: true, contentMd: true, scope: true },
          take,
        }),
      ),
      this.safeFindMany('instruction', () =>
        this.prisma.instruction.findMany({
          where: { ...base, OR: [scopeOr, { forRole: { in: forRoleValues } }, ...personOr] },
          select: { id: true, name: true, statement: true, contentMd: true, scope: true },
          take,
        }),
      ),
      this.safeFindMany('policy', () =>
        this.prisma.policy.findMany({
          where: { ...base, OR: [scopeOr, ...personOr] },
          select: { id: true, name: true, contentMd: true, scope: true, severity: true },
          take,
        }),
      ),
      this.safeFindMany('process', () =>
        this.prisma.process.findMany({
          where: { ...base, OR: [scopeOr, { ownerRoleId: args.roleId }, ...personOr] },
          select: { id: true, name: true, description: true, scope: true },
          take,
        }),
      ),
    ]);

    const candidates: OwnedCandidate[] = [];
    const pushText = (
      kind: RegulationKind,
      id: string,
      name: string,
      text: string,
      scope: string | null,
      severity: RegulationSeverity | null,
    ): void => {
      const clean = (text ?? '').trim();
      if (!clean) return;
      candidates.push({ kind, id, name, text: clean, scope: scope ?? null, severity, summary: null });
    };
    for (const r of regs) pushText('regulation', r.id, r.name, (r.statement?.trim() || r.contentMd) ?? '', r.scope, null);
    for (const r of instrs) pushText('instruction', r.id, r.name, (r.statement?.trim() || r.contentMd) ?? '', r.scope, null);
    for (const r of pols) pushText('policy', r.id, r.name, r.contentMd ?? '', r.scope, this.normalizeSeverity(r.severity ?? null));
    for (const r of procs) pushText('process', r.id, r.name, r.description ?? '', r.scope, null);

    const deduped = this.dedupeCandidates(candidates).slice(0, Math.max(1, Math.ceil(args.maxPool)));
    if (deduped.length === 0) return deduped;

    const summaries = await this.safeFindMany('rule_summary', () =>
      this.prisma.ruleSummary.findMany({
        where: { tenantId: args.tenantId, ruleId: { in: deduped.map((c) => c.id) } },
        select: { kind: true, ruleId: true, summary: true },
      }),
    );
    const summaryByKey = new Map(summaries.map((s) => [`${s.kind}:${s.ruleId}`, s.summary]));
    for (const c of deduped) c.summary = summaryByKey.get(`${c.kind}:${c.id}`) ?? null;
    return deduped;
  }

  private dedupeCandidates(candidates: ReadonlyArray<OwnedCandidate>): OwnedCandidate[] {
    const seen = new Set<string>();
    const out: OwnedCandidate[] = [];
    for (const c of candidates) {
      const key = `${c.name.trim().toLowerCase()}::${c.text.trim().slice(0, 160).toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(c);
    }
    return out;
  }

  private parseIds(text: string): string[] {
    try {
      const match = text.match(/\{[\s\S]*\}/);
      const obj = JSON.parse(match ? match[0] : text) as { ids?: unknown };
      if (Array.isArray(obj.ids)) return obj.ids.filter((x): x is string => typeof x === 'string');
    } catch {
      /* fallthrough */
    }
    return [];
  }

  private async retrieveViaVector(args: {
    tenantId: string;
    roleId: string;
    query: string;
    departmentId?: string | null;
  }): Promise<RetrievedRegulation[]> {
    const [topN, maxDistance, includeOrg] = await Promise.all([
      this.cfg.getDynamic<number>('clone.regulations.retrieval.top_n', undefined, 6),
      this.cfg.getDynamic<number>('clone.regulations.retrieval.min_similarity', undefined, 0.3),
      this.cfg.getDynamic<boolean>('clone.regulations.scope.include_org', undefined, true),
    ]);

    let queryVec: number[] | null;
    try {
      queryVec = await this.embedder.embedQuery(args.query);
    } catch (err) {
      this.logger.debug(
        `role-regulations.retrieval: embedQuery failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
    if (!queryVec) return [];

    const expectedDim = this.cfg.ai?.embeddings?.dimensions ?? 768;
    const guard = buildVectorLiteral(queryVec, expectedDim);
    if (guard.literal === null) {
      this.logger.debug(
        `role-regulations.retrieval: query-вектор отвергнут guard-ом (${guard.rejectReason}, actualDim=${queryVec.length}, expectedDim=${expectedDim}) — []`,
      );
      return [];
    }
    const vecLiteral = guard.literal;

    const departmentId = await this.resolveDepartmentId(
      args.tenantId,
      args.roleId,
      args.departmentId,
    );
    const scopes = buildRoleScopeFilter({
      roleId: args.roleId,
      includeOrg,
      departmentId,
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

  async listRoleSnapshot(args: {
    tenantId: string;
    roleId: string;
  }): Promise<RegulationSnapshotItem[]> {
    const maxItems = await this.cfg.getDynamic<number>(
      'clone.regulations.snapshot.max_items',
      undefined,
      20,
    );
    const scope = `role:${args.roleId}`;
    const baseWhere = {
      tenantId: args.tenantId,
      scope,
      status: 'active' as const,
      deletedAt: null,
    };
    const baseOrder = [
      { lastConfirmedAt: 'desc' as const },
      { updatedAt: 'desc' as const },
    ];
    const baseSelect = {
      id: true,
      name: true,
      scope: true,
      lastConfirmedAt: true,
      updatedAt: true,
    };

    const collected: Array<{ item: RegulationSnapshotItem; freshness: number }> = [];
    const push = (
      kind: RegulationKind,
      rows: ReadonlyArray<{
        id: string;
        name: string;
        scope: string | null;
        lastConfirmedAt: Date | null;
        updatedAt: Date;
        severity?: string | null;
      }>,
    ): void => {
      for (const r of rows) {
        collected.push({
          item: {
            kind,
            id: r.id,
            name: r.name,
            severity: kind === 'policy' ? this.normalizeSeverity(r.severity ?? null) : null,
            scope: r.scope ?? null,
          },
          freshness: (r.lastConfirmedAt ?? r.updatedAt).getTime(),
        });
      }
    };

    await Promise.all([
      this.safeFindMany('regulation', () =>
        this.prisma.regulation.findMany({
          where: baseWhere,
          select: baseSelect,
          orderBy: baseOrder,
          take: maxItems,
        }),
      ).then((rows) => push('regulation', rows)),
      this.safeFindMany('instruction', () =>
        this.prisma.instruction.findMany({
          where: baseWhere,
          select: baseSelect,
          orderBy: baseOrder,
          take: maxItems,
        }),
      ).then((rows) => push('instruction', rows)),
      this.safeFindMany('policy', () =>
        this.prisma.policy.findMany({
          where: baseWhere,
          select: { ...baseSelect, severity: true },
          orderBy: baseOrder,
          take: maxItems,
        }),
      ).then((rows) => push('policy', rows)),
      this.safeFindMany('process', () =>
        this.prisma.process.findMany({
          where: baseWhere,
          select: baseSelect,
          orderBy: baseOrder,
          take: maxItems,
        }),
      ).then((rows) => push('process', rows)),
    ]);

    return collected
      .sort((a, b) => b.freshness - a.freshness)
      .slice(0, maxItems)
      .map((c) => c.item);
  }

  private async safeFindMany<T>(
    label: string,
    run: () => Promise<T[]>,
  ): Promise<T[]> {
    try {
      return await run();
    } catch (err) {
      this.logger.debug(
        `role-regulations: запрос по "${label}" упал: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  private async resolveDepartmentId(
    tenantId: string,
    roleId: string,
    override?: string | null,
  ): Promise<string | null> {
    if (override !== undefined) return override;
    try {
      const role = await this.prisma.role.findFirst({
        where: { id: roleId, tenantId },
        select: { departmentId: true },
      });
      return role?.departmentId ?? null;
    } catch (err) {
      this.logger.debug(
        `role-regulations: resolveDepartmentId упал: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  private normalizeSeverity(value: string | null): RegulationSeverity | null {
    if (value === 'advisory' || value === 'mandatory' || value === 'blocking') return value;
    return null;
  }
}
