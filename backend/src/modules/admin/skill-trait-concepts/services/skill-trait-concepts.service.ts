import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../../common/prisma/prisma.service';
import { SkillTraitConceptService } from '../../../knowledge-core/services/skill-trait-concept.service';
import type {
  ArchiveSkillTraitConceptDto,
  ListSkillTraitConceptsQueryDto,
  MergeSkillTraitConceptDto,
  SkillTraitConceptDetailDto,
  SkillTraitConceptListItemDto,
} from '../dto/skill-trait-concepts.dto';

@Injectable()
export class AdminSkillTraitConceptsService {
  private readonly logger = new Logger(AdminSkillTraitConceptsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SkillTraitConceptService)
    private readonly concepts: SkillTraitConceptService,
  ) {}

  async list(args: { tenantId: string; query: ListSkillTraitConceptsQueryDto }): Promise<{
    items: SkillTraitConceptListItemDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const where: Prisma.SkillTraitConceptWhereInput = {
      tenantId: args.tenantId,
    };
    if (args.query.status) where.status = args.query.status;
    if (args.query.q) {
      const q = args.query.q.trim();
      where.OR = [
        { canonicalName: { contains: q, mode: 'insensitive' } },
        { variants: { has: q } },
      ];
    }
    const [total, rows] = await Promise.all([
      this.prisma.skillTraitConcept.count({ where }),
      this.prisma.skillTraitConcept.findMany({
        where,
        orderBy: [{ traitCount: 'desc' }, { canonicalName: 'asc' }],
        skip: (args.query.page - 1) * args.query.pageSize,
        take: args.query.pageSize,
      }),
    ]);
    return {
      items: rows.map((r) => this.toListItem(r)),
      total,
      page: args.query.page,
      pageSize: args.query.pageSize,
    };
  }

  async detail(args: { tenantId: string; conceptId: string }): Promise<SkillTraitConceptDetailDto> {
    const row = await this.prisma.skillTraitConcept.findUnique({
      where: { id: args.conceptId },
    });
    if (!row || row.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'not_found', message: 'Смысловой блок не найден' },
      });
    }
    const traits = await this.prisma.skillTrait.findMany({
      where: { conceptId: row.id, status: 'active' },
      orderBy: { lastConfirmedAt: 'desc' },
      take: 20,
      select: {
        id: true,
        category: true,
        statement: true,
        confidence: true,
        profileId: true,
        lastConfirmedAt: true,
        profile: {
          select: {
            person: { select: { name: true } },
          },
        },
      },
    });
    return {
      ...this.toListItem(row),
      recentTraits: traits.map((t) => ({
        id: t.id,
        category: t.category,
        statement: t.statement,
        confidence: t.confidence,
        profileId: t.profileId,
        personName: t.profile?.person?.name ?? null,
        lastConfirmedAt: t.lastConfirmedAt.toISOString(),
      })),
    };
  }

  async merge(args: {
    tenantId: string;
    sourceId: string;
    dto: MergeSkillTraitConceptDto;
    actorUserId: string;
  }): Promise<{ ok: true }> {
    if (args.sourceId === args.dto.targetId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'cannot_merge_self',
          message: 'Нельзя слить смысловой блок сам в себя',
        },
      });
    }
    const source = await this.prisma.skillTraitConcept.findUnique({
      where: { id: args.sourceId },
    });
    const target = await this.prisma.skillTraitConcept.findUnique({
      where: { id: args.dto.targetId },
    });
    if (!source || source.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'not_found', message: 'Исходный смысловой блок не найден' },
      });
    }
    if (!target || target.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'not_found', message: 'Целевой смысловой блок не найден' },
      });
    }
    if (source.status !== 'active') {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'source_not_active',
          message: 'Можно сливать только активный смысловой блок',
        },
      });
    }
    if (target.status !== 'active') {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'target_not_active',
          message: 'Целевой смысловой блок не активный — слияние невозможно',
        },
      });
    }
    await this.concepts.mergeConcepts({
      tenantId: args.tenantId,
      sourceIds: [args.sourceId],
      targetId: args.dto.targetId,
    });
    this.logger.log(
      {
        tenantId: args.tenantId,
        sourceId: args.sourceId,
        targetId: args.dto.targetId,
        actorUserId: args.actorUserId,
        reason: args.dto.reason,
      },
      'admin.skill-trait-concepts.merge',
    );
    return { ok: true };
  }

  async archive(args: {
    tenantId: string;
    conceptId: string;
    dto: ArchiveSkillTraitConceptDto;
    actorUserId: string;
  }): Promise<{ ok: true }> {
    const row = await this.prisma.skillTraitConcept.findUnique({
      where: { id: args.conceptId },
    });
    if (!row || row.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'not_found', message: 'Смысловой блок не найден' },
      });
    }
    if (row.status === 'archived') {
      return { ok: true };
    }
    await this.prisma.skillTraitConcept.update({
      where: { id: args.conceptId },
      data: { status: 'archived' },
    });
    this.logger.log(
      {
        tenantId: args.tenantId,
        conceptId: args.conceptId,
        actorUserId: args.actorUserId,
        reason: args.dto.reason,
      },
      'admin.skill-trait-concepts.archive',
    );
    return { ok: true };
  }

  private toListItem(row: {
    id: string;
    canonicalName: string;
    description: string | null;
    variants: string[];
    status: 'active' | 'merged_into' | 'archived';
    mergedIntoId: string | null;
    traitCount: number;
    firstSeenAt: Date;
    lastSeenAt: Date;
  }): SkillTraitConceptListItemDto {
    return {
      id: row.id,
      canonicalName: row.canonicalName,
      description: row.description,
      variants: row.variants ?? [],
      status: row.status,
      mergedIntoId: row.mergedIntoId,
      traitCount: row.traitCount,
      firstSeenAt: row.firstSeenAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString(),
    };
  }
}
