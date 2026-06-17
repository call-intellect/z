import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuditLogService } from '../../audit/audit-log.service';
import { tenantTopLabel } from '../../company-foundation/utils/tenant-top';
import type {
  CreateSkillTraitCategoryDto,
  ListSkillTraitCategoriesQuery,
  MergeSkillTraitCategoriesResultDto,
  SkillTraitCategoryDto,
  UpdateSkillTraitCategoryDto,
} from '../dto/skill-trait-categories.dto';

@Injectable()
export class SkillTraitCategoryService {
  private readonly logger = new Logger(SkillTraitCategoryService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  async list(args: {
    tenantId: string;
    query: ListSkillTraitCategoriesQuery;
  }): Promise<{ items: SkillTraitCategoryDto[]; total: number }> {
    const where: Prisma.SkillTraitCategoryWhereInput = {
      tenantId: args.tenantId,
      ...(args.query.includeDeleted ? {} : { deletedAt: null }),
      ...(args.query.parentCategoryId ? { parentCategoryId: args.query.parentCategoryId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.skillTraitCategory.findMany({
        where,
        orderBy: [{ name: 'asc' }],
        take: args.query.limit,
        include: { _count: { select: { traits: true } } },
      }),
      this.prisma.skillTraitCategory.count({ where }),
    ]);
    return {
      items: rows.map((r) => this.toDto(r, r._count.traits)),
      total,
    };
  }

  async getById(args: { tenantId: string; id: string }): Promise<SkillTraitCategoryDto> {
    const row = await this.prisma.skillTraitCategory.findUnique({
      where: { id: args.id },
      include: { _count: { select: { traits: true } } },
    });
    if (!row || row.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'skill_category_not_found',
          message: 'Категория не найдена',
        },
      });
    }
    return this.toDto(row, row._count.traits);
  }

  async create(args: {
    tenantId: string;
    userId: string;
    body: CreateSkillTraitCategoryDto;
  }): Promise<SkillTraitCategoryDto> {
    const slug = this.slugify(args.body.name);
    if (args.body.parentCategoryId) {
      await this.ensureExists(args.tenantId, args.body.parentCategoryId);
    }
    try {
      const created = await this.prisma.skillTraitCategory.create({
        data: {
          tenantId: args.tenantId,
          name: args.body.name,
          slug,
          description: args.body.description ?? null,
          parentCategoryId: args.body.parentCategoryId ?? null,
        },
      });
      void this.audit.log({
        userId: args.userId,
        action: 'skill_category.created',
        resourceId: created.id,
        metadata: { tenantId: args.tenantId, name: created.name, slug },
      });
      return this.toDto(created, 0);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({
          ok: false,
          error: {
            code: 'skill_category_slug_taken',
            message: `Категория со slug «${slug}» уже существует`,
          },
        });
      }
      throw err;
    }
  }

  async update(args: {
    tenantId: string;
    userId: string;
    id: string;
    body: UpdateSkillTraitCategoryDto;
  }): Promise<SkillTraitCategoryDto> {
    const existing = await this.prisma.skillTraitCategory.findUnique({
      where: { id: args.id },
    });
    if (!existing || existing.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'skill_category_not_found',
          message: 'Категория не найдена',
        },
      });
    }
    if (existing.deletedAt) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'skill_category_deleted',
          message: 'Категория помечена удалённой (merge source) — править нельзя',
        },
      });
    }
    if (args.body.parentCategoryId && args.body.parentCategoryId !== existing.parentCategoryId) {
      if (args.body.parentCategoryId === existing.id) {
        throw new BadRequestException({
          ok: false,
          error: {
            code: 'skill_category_self_parent',
            message: 'Категория не может быть собственным родителем',
          },
        });
      }
      await this.ensureExists(args.tenantId, args.body.parentCategoryId);
    }
    const data: Prisma.SkillTraitCategoryUpdateInput = {};
    if (args.body.name !== undefined) {
      data.name = args.body.name;
      data.slug = this.slugify(args.body.name);
    }
    if (args.body.description !== undefined) {
      data.description = args.body.description;
    }
    if (args.body.parentCategoryId !== undefined) {
      data.parent =
        args.body.parentCategoryId === null
          ? { disconnect: true }
          : { connect: { id: args.body.parentCategoryId } };
    }
    try {
      const updated = await this.prisma.skillTraitCategory.update({
        where: { id: args.id },
        data,
        include: { _count: { select: { traits: true } } },
      });
      void this.audit.log({
        userId: args.userId,
        action: 'skill_category.updated',
        resourceId: args.id,
        metadata: {
          tenantId: args.tenantId,
          changedFields: Object.keys(args.body),
        },
      });
      return this.toDto(updated, updated._count.traits);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({
          ok: false,
          error: {
            code: 'skill_category_slug_taken',
            message: 'Категория с таким slug уже существует',
          },
        });
      }
      throw err;
    }
  }

  async softDelete(args: {
    tenantId: string;
    userId: string;
    id: string;
  }): Promise<{ id: string; deletedAt: string }> {
    const existing = await this.prisma.skillTraitCategory.findUnique({
      where: { id: args.id },
      include: { _count: { select: { traits: true } } },
    });
    if (!existing || existing.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'skill_category_not_found',
          message: 'Категория не найдена',
        },
      });
    }
    if (existing._count.traits > 0) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'skill_category_has_traits',
          message: `К категории привязано ${existing._count.traits} черт. Удалите/перепривяжите их или используйте merge.`,
        },
      });
    }
    if (existing.deletedAt) {
      return {
        id: existing.id,
        deletedAt: existing.deletedAt.toISOString(),
      };
    }
    const now = new Date();
    await this.prisma.skillTraitCategory.update({
      where: { id: args.id },
      data: { deletedAt: now },
    });
    void this.audit.log({
      userId: args.userId,
      action: 'skill_category.deleted',
      resourceId: args.id,
      metadata: { tenantId: args.tenantId, soft: true },
    });
    return { id: args.id, deletedAt: now.toISOString() };
  }

  async merge(args: {
    tenantId: string;
    userId: string;
    sourceId: string;
    targetId: string;
    reasoning?: string | null;
    via?: 'rest' | 'curation_decision';
    curationDecisionId?: string | null;
  }): Promise<MergeSkillTraitCategoriesResultDto> {
    if (args.sourceId === args.targetId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'merge_same_category',
          message: 'sourceId и targetId должны различаться',
        },
      });
    }
    const [source, target] = await Promise.all([
      this.prisma.skillTraitCategory.findUnique({
        where: { id: args.sourceId },
      }),
      this.prisma.skillTraitCategory.findUnique({
        where: { id: args.targetId },
      }),
    ]);
    if (!source || source.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'skill_category_not_found',
          message: 'Исходная категория не найдена',
        },
      });
    }
    if (!target || target.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'skill_category_not_found',
          message: 'Целевая категория не найдена',
        },
      });
    }
    if (target.deletedAt) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'target_category_deleted',
          message: 'Целевая категория уже была merge-источником — выберите другую',
        },
      });
    }

    const movedTraits = await this.prisma.$transaction(async (tx) => {
      const move = await tx.skillTrait.updateMany({
        where: { categoryId: source.id },
        data: { categoryId: target.id },
      });
      if (!source.deletedAt) {
        await tx.skillTraitCategory.update({
          where: { id: source.id },
          data: { deletedAt: new Date() },
        });
      }
      return move.count;
    });

    void this.audit.log({
      userId: args.userId,
      action: 'skill_category.merged',
      resourceId: target.id,
      metadata: {
        tenantId: args.tenantId,
        sourceId: source.id,
        targetId: target.id,
        movedTraits,
        reasoning: args.reasoning ?? null,
        via: args.via ?? 'rest',
        curationDecisionId: args.curationDecisionId ?? null,
      },
    });
    this.logger.log(
      {
        tenantId: args.tenantId,
        sourceId: source.id,
        targetId: target.id,
        movedTraits,
        via: args.via ?? 'rest',
      },
      'skill-trait-categories.merge: завершено',
    );

    void this.refreshTenantMetrics(args.tenantId).catch((err) =>
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'skill-trait-categories.merge: refreshTenantMetrics упал — skip',
      ),
    );

    const [sourceAfter, targetAfter] = await Promise.all([
      this.prisma.skillTraitCategory.findUniqueOrThrow({
        where: { id: source.id },
        include: { _count: { select: { traits: true } } },
      }),
      this.prisma.skillTraitCategory.findUniqueOrThrow({
        where: { id: target.id },
        include: { _count: { select: { traits: true } } },
      }),
    ]);
    return {
      source: this.toDto(sourceAfter, sourceAfter._count.traits),
      target: this.toDto(targetAfter, targetAfter._count.traits),
      movedTraits,
    };
  }

  async refreshTenantMetrics(tenantId: string): Promise<void> {
    const [categoriesActive, traitsTotal, traitsCategorized] = await Promise.all([
      this.prisma.skillTraitCategory.count({
        where: { tenantId, deletedAt: null },
      }),
      this.prisma.skillTrait.count({
        where: { profile: { tenantId } },
      }),
      this.prisma.skillTrait.count({
        where: { profile: { tenantId }, categoryId: { not: null } },
      }),
    ]);
    const ratio = traitsTotal === 0 ? 0 : traitsCategorized / traitsTotal;
    const tenantTop = await tenantTopLabel(this.prisma, tenantId);
    this.metrics.setSkillCategoriesTotal({
      tenantTop,
      value: categoriesActive,
    });
    this.metrics.setSkillTraitCategorizedRatio({ tenantTop, value: ratio });
  }

  private async ensureExists(tenantId: string, id: string): Promise<void> {
    const found = await this.prisma.skillTraitCategory.findUnique({
      where: { id },
      select: { tenantId: true, deletedAt: true },
    });
    if (!found || found.tenantId !== tenantId || found.deletedAt) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'parent_category_not_found',
          message: 'Родительская категория не найдена',
        },
      });
    }
  }

  slugify(name: string): string {
    const map: Record<string, string> = {
      а: 'a',
      б: 'b',
      в: 'v',
      г: 'g',
      д: 'd',
      е: 'e',
      ё: 'e',
      ж: 'zh',
      з: 'z',
      и: 'i',
      й: 'y',
      к: 'k',
      л: 'l',
      м: 'm',
      н: 'n',
      о: 'o',
      п: 'p',
      р: 'r',
      с: 's',
      т: 't',
      у: 'u',
      ф: 'f',
      х: 'h',
      ц: 'c',
      ч: 'ch',
      ш: 'sh',
      щ: 'shch',
      ъ: '',
      ы: 'y',
      ь: '',
      э: 'e',
      ю: 'yu',
      я: 'ya',
    };
    const lower = name.toLowerCase().trim();
    let out = '';
    for (const ch of lower) {
      if (map[ch] !== undefined) {
        out += map[ch];
      } else if (/[a-z0-9]/.test(ch)) {
        out += ch;
      } else if (/[\s\-_/]/.test(ch)) {
        out += '-';
      }
    }
    out = out.replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (out.length === 0) {
      out = `cat-${Date.now().toString(36)}`;
    }
    return out.slice(0, 220);
  }

  private toDto(
    row: {
      id: string;
      tenantId: string;
      name: string;
      slug: string;
      description: string | null;
      parentCategoryId: string | null;
      createdAt: Date;
      updatedAt: Date;
      deletedAt: Date | null;
    },
    traitsCount: number,
  ): SkillTraitCategoryDto {
    return {
      id: row.id,
      tenantId: row.tenantId,
      name: row.name,
      slug: row.slug,
      description: row.description,
      parentCategoryId: row.parentCategoryId,
      traitsCount,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    };
  }
}
