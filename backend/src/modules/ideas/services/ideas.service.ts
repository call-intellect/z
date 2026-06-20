import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { type Idea, Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuditLogService } from '../../audit/audit-log.service';
import { Specialist36Service } from '../../knowledge-core/services/specialist-3-6-ideas.service';
import { KnowledgeAccessResolver } from '../../rbac/knowledge-access-resolver.service';
import {
  type ChangeIdeaStatusBody,
  type IdeaClusterDto,
  type IdeaDetailDto,
  type IdeaListItemDto,
  type IdeaSupporterDto,
  type ListIdeaClustersQuery,
  type ListIdeaClustersResponse,
  type ListIdeasQuery,
  type ListIdeasResponse,
  type MyIdeasQuery,
  type TopIdeasQuery,
  type TopIdeasResponse,
} from '../dto/ideas.dto';
import {
  DEFAULT_IDEAS_FRESHNESS_DAYS,
  DEFAULT_IDEAS_RERANK_WEIGHTS,
  rerankIdeas,
  type IdeasRerankWeights,
} from './ideas-rerank.scoring';

@Injectable()
export class IdeasService {
  private readonly logger = new Logger(IdeasService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Specialist36Service)
    private readonly specialist36: Specialist36Service,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Optional()
    @Inject(KnowledgeAccessResolver)
    private readonly accessResolver: KnowledgeAccessResolver | null = null,
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg: TypedConfigService | null = null,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService | null = null,
  ) {}

  private async gateProjections<T extends { id: string; sourceBlockIds: string[] }>(
    items: T[],
    args: { tenantId: string; userId?: string; surface: string },
  ): Promise<T[]> {
    const enf = this.cfg?.knowledgeAccess.enforcement ?? 'off';
    if (enf === 'off' || !this.accessResolver || !args.userId || items.length === 0) {
      return items;
    }
    const accessCtx = await this.accessResolver.resolveAccessibleGroups({
      tenantId: args.tenantId,
      userId: args.userId,
    });
    if (accessCtx.isBypass) return items;
    const { accessibleIds, denied } = await this.accessResolver.partitionProjectionsByAccess(
      accessCtx,
      items.map((i) => ({ id: i.id, sourceBlockIds: i.sourceBlockIds ?? [] })),
    );
    if (enf === 'enforce') {
      this.metrics?.incAccessDenied({ surface: args.surface }, denied);
      return items.filter((i) => accessibleIds.has(i.id));
    }
    this.metrics?.incAccessShadowDiff({ surface: args.surface }, denied);
    return items;
  }

  async list(args: {
    tenantId: string;
    userId?: string;
    query: ListIdeasQuery;
  }): Promise<ListIdeasResponse> {
    const q = args.query;
    const where: Prisma.IdeaWhereInput = { tenantId: args.tenantId };
    if (q.kind) where.kind = q.kind;
    if (q.status) where.status = q.status;
    if (q.clusterId) where.clusterId = q.clusterId;
    if (q.q) {
      where.OR = [
        { statement: { contains: q.q, mode: 'insensitive' } },
        { rationale: { contains: q.q, mode: 'insensitive' } },
      ];
    }
    if (q.supporterEntityId) {
      where.personSubjectIds = { has: q.supporterEntityId };
    }
    const [items, total] = await Promise.all([
      this.prisma.idea.findMany({
        where,
        orderBy: [{ weight: 'desc' }, { createdAt: 'desc' }],
        take: q.limit,
        skip: (q.page - 1) * q.limit,
      }),
      this.prisma.idea.count({ where }),
    ]);
    const visible = await this.gateProjections(items, {
      tenantId: args.tenantId,
      userId: args.userId,
      surface: 'ideas',
    });
    return {
      items: visible.map((i) => this.toListItem(i)),
      total,
      page: q.page,
      limit: q.limit,
    };
  }

  async getTop(args: {
    tenantId: string;
    userId?: string;
    query: TopIdeasQuery;
  }): Promise<TopIdeasResponse> {
    const limit = args.query.limit;
    const items = await this.prisma.idea.findMany({
      where: {
        tenantId: args.tenantId,
        status: { notIn: ['rejected', 'archived'] },
      },
      orderBy: [{ weight: 'desc' }, { lastDiscussedAt: 'desc' }],
      take: Math.max(limit * 3, limit),
    });

    const [weights, freshnessDays] = await Promise.all([
      this.resolveRerankWeights(),
      this.resolveFreshnessDays(),
    ]);
    const now = new Date();
    const scoreById = new Map(
      rerankIdeas(
        items.map((i) => ({
          id: i.id,
          weight: Number(i.weight),
          lastDiscussedAt: i.lastDiscussedAt,
          goalId: i.goalId,
        })),
        now,
        weights,
        freshnessDays,
      ).map((s) => [s.item.id, s.score]),
    );
    const reranked = [...items].sort(
      (a, b) => (scoreById.get(b.id) ?? 0) - (scoreById.get(a.id) ?? 0),
    );

    const visible = await this.gateProjections(reranked, {
      tenantId: args.tenantId,
      userId: args.userId,
      surface: 'ideas',
    });

    this.metrics?.incIdeasTopServed();
    return {
      items: visible.slice(0, limit).map((i) => this.toListItem(i)),
    };
  }

  private async resolveRerankWeights(): Promise<IdeasRerankWeights> {
    if (!this.cfg) return DEFAULT_IDEAS_RERANK_WEIGHTS;
    const [weight, freshness, goalLink] = await Promise.all([
      this.cfg.getDynamic<number>(
        'ideas.feed.rerank.weight',
        'IDEAS_FEED_RERANK_WEIGHT',
        DEFAULT_IDEAS_RERANK_WEIGHTS.weight,
      ),
      this.cfg.getDynamic<number>(
        'ideas.feed.rerank.freshness',
        'IDEAS_FEED_RERANK_FRESHNESS',
        DEFAULT_IDEAS_RERANK_WEIGHTS.freshness,
      ),
      this.cfg.getDynamic<number>(
        'ideas.feed.rerank.goal_link',
        'IDEAS_FEED_RERANK_GOAL_LINK',
        DEFAULT_IDEAS_RERANK_WEIGHTS.goalLink,
      ),
    ]);
    return { weight, freshness, goalLink };
  }

  private async resolveFreshnessDays(): Promise<number> {
    if (!this.cfg) return DEFAULT_IDEAS_FRESHNESS_DAYS;
    return this.cfg.getDynamic<number>(
      'ideas.feed.freshness_days',
      'IDEAS_FEED_FRESHNESS_DAYS',
      DEFAULT_IDEAS_FRESHNESS_DAYS,
    );
  }

  async getById(args: { tenantId: string; id: string }): Promise<IdeaDetailDto> {
    const idea = await this.prisma.idea.findFirst({
      where: { id: args.id, tenantId: args.tenantId },
    });
    if (!idea) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'idea_not_found', message: 'Идея не найдена' },
      });
    }
    return this.toDetail(idea);
  }

  async listMine(args: {
    tenantId: string;
    userId: string;
    query: MyIdeasQuery;
  }): Promise<ListIdeasResponse> {
    const q = args.query;
    const where: Prisma.IdeaWhereInput = { tenantId: args.tenantId };
    if (q.role === 'author') {
      where.createdByUserId = args.userId;
    } else {
      const personEntityIds = await this.findPersonEntityIdsForUser({
        userId: args.userId,
        tenantId: args.tenantId,
      });
      if (personEntityIds.length === 0) {
        return { items: [], total: 0, page: q.page, limit: q.limit };
      }
      where.personSubjectIds = { hasSome: personEntityIds };
    }
    const [items, total] = await Promise.all([
      this.prisma.idea.findMany({
        where,
        orderBy: [{ weight: 'desc' }, { createdAt: 'desc' }],
        take: q.limit,
        skip: (q.page - 1) * q.limit,
      }),
      this.prisma.idea.count({ where }),
    ]);
    const visible = await this.gateProjections(items, {
      tenantId: args.tenantId,
      userId: args.userId,
      surface: 'ideas',
    });
    return {
      items: visible.map((i) => this.toListItem(i)),
      total,
      page: q.page,
      limit: q.limit,
    };
  }

  async changeStatus(args: {
    tenantId: string;
    id: string;
    body: ChangeIdeaStatusBody;
    userId: string;
  }): Promise<{ ok: true; status: string }> {
    const updated = await this.specialist36.changeStatus({
      tenantId: args.tenantId,
      ideaId: args.id,
      newStatus: args.body.newStatus,
      reason: args.body.reason ?? null,
      changedByUserId: args.userId,
    });
    return { ok: true, status: updated.status };
  }

  async linkGoal(args: {
    tenantId: string;
    ideaId: string;
    goalId: string | null;
    userId: string;
  }): Promise<{ ok: true; goalId: string | null }> {
    const idea = await this.prisma.idea.findFirst({
      where: { id: args.ideaId, tenantId: args.tenantId },
      select: { id: true },
    });
    if (!idea) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'idea_not_found', message: 'Идея не найдена' },
      });
    }
    if (args.goalId !== null) {
      const goal = await this.prisma.goal.findFirst({
        where: { id: args.goalId, tenantId: args.tenantId },
        select: { id: true },
      });
      if (!goal) {
        throw new BadRequestException({
          ok: false,
          error: { code: 'goal_not_found', message: 'Цель не найдена' },
        });
      }
    }
    await this.prisma.idea.update({
      where: { id: idea.id },
      data: { goalId: args.goalId },
    });
    void this.audit.log({
      userId: args.userId,
      action: 'idea.goal_linked',
      resourceId: idea.id,
      metadata: { ideaId: idea.id, goalId: args.goalId },
    });
    return { ok: true, goalId: args.goalId };
  }

  async support(args: {
    tenantId: string;
    id: string;
    userId: string;
  }): Promise<{ ok: true; supporterCount: number }> {
    const person = await this.prisma.person.findFirst({
      where: { tenantId: args.tenantId, userId: args.userId, deletedAt: null },
      select: { entityId: true },
    });
    if (!person || !person.entityId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'no_person',
          message: "У вас нет Person'а в этой организации",
        },
      });
    }
    const idea = await this.prisma.idea.findFirst({
      where: { id: args.id, tenantId: args.tenantId },
    });
    if (!idea) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'idea_not_found', message: 'Идея не найдена' },
      });
    }
    const supporters = this.parseSupporters(idea.supporters);
    const alreadyKey = `person:${person.entityId}`;
    if (supporters.some((s) => `${s.kind}:${s.entityId}` === alreadyKey)) {
      return { ok: true, supporterCount: idea.supporterCount };
    }
    supporters.push({
      kind: 'person',
      entityId: person.entityId,
      firstSupportedAt: new Date().toISOString(),
    });
    const newSubjects = Array.from(new Set([...idea.personSubjectIds, person.entityId]));
    const updated = await this.prisma.idea.update({
      where: { id: idea.id },
      data: {
        supporters: supporters as unknown as Prisma.InputJsonValue,
        supporterCount: supporters.length,
        personSubjectIds: newSubjects,
        lastDiscussedAt: new Date(),
      },
    });
    return { ok: true, supporterCount: updated.supporterCount };
  }

  async withdraw(args: { tenantId: string; id: string; userId: string }): Promise<{ ok: true }> {
    const idea = await this.prisma.idea.findFirst({
      where: { id: args.id, tenantId: args.tenantId },
    });
    if (!idea) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'idea_not_found', message: 'Идея не найдена' },
      });
    }
    if (idea.createdByUserId !== args.userId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'not_author',
          message: 'Только автор может отозвать идею',
        },
      });
    }
    await this.specialist36.changeStatus({
      tenantId: args.tenantId,
      ideaId: idea.id,
      newStatus: 'archived',
      reason: 'author_withdrew',
      changedByUserId: args.userId,
    });
    return { ok: true };
  }

  async listClusters(args: {
    tenantId: string;
    query: ListIdeaClustersQuery;
  }): Promise<ListIdeaClustersResponse> {
    const q = args.query;
    const where: Prisma.IdeaClusterWhereInput = { tenantId: args.tenantId };
    const [items, total] = await Promise.all([
      this.prisma.ideaCluster.findMany({
        where,
        orderBy: { clusterWeight: 'desc' },
        take: q.limit,
        skip: (q.page - 1) * q.limit,
      }),
      this.prisma.ideaCluster.count({ where }),
    ]);
    return {
      items: items.map((c) => this.toClusterDto(c)),
      total,
      page: q.page,
      limit: q.limit,
    };
  }

  async getClusterById(args: { tenantId: string; id: string }): Promise<IdeaClusterDto> {
    const cluster = await this.prisma.ideaCluster.findFirst({
      where: { id: args.id, tenantId: args.tenantId },
    });
    if (!cluster) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'cluster_not_found', message: 'Кластер не найден' },
      });
    }
    return this.toClusterDto(cluster);
  }

  private toListItem(i: Idea): IdeaListItemDto {
    return {
      id: i.id,
      kind: i.kind,
      status: i.status,
      statement: i.statement,
      rationale: i.rationale,
      weight: Number(i.weight),
      supporterCount: i.supporterCount,
      clusterId: i.clusterId,
      firstProposedAt: i.firstProposedAt.toISOString(),
      lastDiscussedAt: i.lastDiscussedAt.toISOString(),
      createdByUserId: i.createdByUserId,
    };
  }

  private toDetail(i: Idea): IdeaDetailDto {
    return {
      ...this.toListItem(i),
      supporters: this.parseSupporters(i.supporters),
      sourceBlockIds: i.sourceBlockIds,
      personSubjectIds: i.personSubjectIds,
      statusChangedAt: i.statusChangedAt?.toISOString() ?? null,
      statusChangedByUserId: i.statusChangedByUserId,
      statusReason: i.statusReason,
      confidence: Number(i.confidence),
      dataClass: i.dataClass,
      realizedAsDecisionId: i.realizedAsDecisionId,
    };
  }

  private toClusterDto(c: {
    id: string;
    name: string;
    description: string | null;
    ideaIds: string[];
    clusterWeight: Prisma.Decimal;
    createdAt: Date;
    updatedAt: Date;
  }): IdeaClusterDto {
    return {
      id: c.id,
      name: c.name,
      description: c.description,
      ideaIds: c.ideaIds,
      clusterWeight: Number(c.clusterWeight),
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    };
  }

  private parseSupporters(payload: Prisma.JsonValue): IdeaSupporterDto[] {
    if (!Array.isArray(payload)) return [];
    const arr = payload as Array<Prisma.JsonValue>;
    const result: IdeaSupporterDto[] = [];
    for (const item of arr) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        continue;
      }
      const s = item as Record<string, Prisma.JsonValue>;
      const kindRaw = typeof s.kind === 'string' ? s.kind : 'person';
      const kind: 'person' | 'customer' = kindRaw === 'customer' ? 'customer' : 'person';
      const entityId = typeof s.entityId === 'string' ? s.entityId : '';
      if (entityId.length === 0) continue;
      const firstSupportedAt =
        typeof s.firstSupportedAt === 'string' ? s.firstSupportedAt : new Date().toISOString();
      const dto: IdeaSupporterDto = { kind, entityId, firstSupportedAt };
      if (typeof s.blockId === 'string') dto.blockId = s.blockId;
      result.push(dto);
    }
    return result;
  }

  private async findPersonEntityIdsForUser(args: {
    userId: string;
    tenantId: string;
  }): Promise<string[]> {
    const persons = await this.prisma.person.findMany({
      where: {
        userId: args.userId,
        tenantId: args.tenantId,
        deletedAt: null,
      },
      select: { entityId: true },
    });
    return persons.map((p) => p.entityId).filter((id): id is string => !!id);
  }
}
