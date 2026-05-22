import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { type Idea, Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { Specialist36Service } from '../../knowledge-core/services/specialist-3-6-ideas.service';

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
} from '../dto/ideas.dto';

@Injectable()
export class IdeasService {
  private readonly logger = new Logger(IdeasService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Specialist36Service)
    private readonly specialist36: Specialist36Service,
  ) {}

  async list(args: {
    tenantId: string;
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
    return {
      items: items.map((i) => this.toListItem(i)),
      total,
      page: q.page,
      limit: q.limit,
    };
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
      // supporter: ищем по supporters JSON через text-contains (упрощение для β-5;
      // нормальный путь — joined-таблица, γ+).
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
    return {
      items: items.map((i) => this.toListItem(i)),
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

  async support(args: {
    tenantId: string;
    id: string;
    userId: string;
  }): Promise<{ ok: true; supporterCount: number }> {
    // Найдём Person'а текущего user'а в этой Org.
    const person = await this.prisma.person.findFirst({
      where: { tenantId: args.tenantId, userId: args.userId, deletedAt: null },
      select: { entityId: true },
    });
    if (!person || !person.entityId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'no_person',
          message: 'У вас нет Person\'а в этой организации',
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
    const newSubjects = Array.from(
      new Set([...idea.personSubjectIds, person.entityId]),
    );
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

  async withdraw(args: {
    tenantId: string;
    id: string;
    userId: string;
  }): Promise<{ ok: true }> {
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

  async getClusterById(args: {
    tenantId: string;
    id: string;
  }): Promise<IdeaClusterDto> {
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

  // ─────────────────────────── mappers ────────────────────────────────

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
      const kind: 'person' | 'customer' =
        kindRaw === 'customer' ? 'customer' : 'person';
      const entityId = typeof s.entityId === 'string' ? s.entityId : '';
      if (entityId.length === 0) continue;
      const firstSupportedAt =
        typeof s.firstSupportedAt === 'string'
          ? s.firstSupportedAt
          : new Date().toISOString();
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
    return persons
      .map((p) => p.entityId)
      .filter((id): id is string => !!id);
  }
}
