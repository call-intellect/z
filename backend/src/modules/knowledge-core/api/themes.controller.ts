import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Optional,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CurrentUser, type CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { RequireEntitlement } from '../../entitlements/require-entitlement.decorator';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { KnowledgeAccessResolver } from '../../rbac/knowledge-access-resolver.service';
import { RbacService } from '../../rbac/rbac.service';

import type { BlockSearchItemDto, EntityItemDto } from './dto/search.dto';
import {
  type ListThemesQuery,
  ListThemesQuerySchema,
  type ListThemesResultDto,
  type SaveThemeAsCardDto,
  SaveThemeAsCardSchema,
  type ThemeDetailDto,
  type ThemeItemDto,
  type ThemeSavedAsCardDto,
} from './dto/theme.dto';

const THEME_DETAIL_BLOCKS_LIMIT = 20;
const THEME_DETAIL_ENTITIES_LIMIT = 50;

@ApiTags('knowledge-core')
@Controller('api/v1/knowledge/themes')
@UseGuards(CookieAuthGuard, TenantGuard)
@RequireEntitlement('feature.theme')
export class KnowledgeThemesController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RbacService) private readonly rbac: RbacService,
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

  @Get()
  @ApiOperation({ summary: 'Список тем Org (фильтр branch/status, пагинация)' })
  async list(
    @Query(new ZodValidationPipe(ListThemesQuerySchema))
    query: ListThemesQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ListThemesResultDto> {
    if (!tenantId) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'tenant_required', message: 'Org не определена' },
      });
    }
    const allowed = await this.rbac.canRead(user.id, tenantId, 'theme');
    if (!allowed) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав' },
      });
    }

    const where: Prisma.ThemeWhereInput = {
      tenantId,
      status: query.status,
      ...(query.branch ? { branch: query.branch } : {}),
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.theme.findMany({
        where,
        orderBy: [
          { weight: 'desc' },
          { lastSignalAt: { sort: 'desc', nulls: 'last' } },
          { createdAt: 'desc' },
        ],
        skip: query.offset,
        take: query.limit,
        include: {
          _count: { select: { blocks: true, entities: true } },
        },
      }),
      this.prisma.theme.count({ where }),
    ]);

    return {
      items: items.map((t) => this.mapTheme(t, t._count.blocks, t._count.entities)),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Тема + связанные блоки + сущности' })
  async byId(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ThemeDetailDto> {
    if (!tenantId) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'tenant_required', message: 'Org не определена' },
      });
    }
    const allowed = await this.rbac.canRead(user.id, tenantId, 'theme');
    if (!allowed) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав' },
      });
    }

    const enf: 'off' | 'shadow' | 'enforce' =
      this.cfg && this.accessResolver ? this.cfg.knowledgeAccess.enforcement : 'off';
    const accessCtx =
      enf !== 'off' && this.accessResolver
        ? await this.accessResolver.resolveAccessibleGroups({
            tenantId,
            userId: user.id,
          })
        : null;

    const theme = await this.prisma.theme.findUnique({
      where: { id },
      include: {
        _count: { select: { blocks: true, entities: true } },
      },
    });
    if (!theme || theme.tenantId !== tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'theme_not_found', message: 'Тема не найдена' },
      });
    }

    const [blockRows, entityRows] = await Promise.all([
      this.prisma.themeIdeaBlock.findMany({
        where: { themeId: theme.id, block: { tenantId, status: 'canonical' } },
        include: { block: true },
        orderBy: [{ weight: 'desc' }, { createdAt: 'desc' }],
        take: THEME_DETAIL_BLOCKS_LIMIT,
      }),
      this.prisma.themeEntity.findMany({
        where: { themeId: theme.id, entity: { tenantId } },
        include: { entity: true },
        orderBy: [{ mentionsCount: 'desc' }, { createdAt: 'desc' }],
        take: THEME_DETAIL_ENTITIES_LIMIT,
      }),
    ]);

    let visibleBlockRows = blockRows;
    if (this.accessResolver && this.metrics && accessCtx && !accessCtx.isBypass) {
      const { accessible, denied } = await this.accessResolver.partitionBlockIdsByAccess(
        accessCtx,
        blockRows.map((r) => r.block.id),
      );
      if (enf === 'enforce') {
        const allow = new Set(accessible);
        visibleBlockRows = blockRows.filter((r) => allow.has(r.block.id));
        this.metrics.incAccessDenied({ surface: 'themes' }, denied);
      } else {
        this.metrics.incAccessShadowDiff({ surface: 'themes' }, denied);
      }
    }

    return {
      theme: this.mapTheme(theme, theme._count.blocks, theme._count.entities),
      blocks: visibleBlockRows.map((r): BlockSearchItemDto => this.mapBlock(r.block)),
      entities: entityRows.map(
        (r): EntityItemDto => ({
          id: r.entity.id,
          type: r.entity.type,
          canonicalName: r.entity.canonicalName,
          aliases: r.entity.aliases,
          mentionsCount: r.entity.mentionsCount,
          metadata: this.jsonObj(r.entity.metadata),
        }),
      ),
      ...(theme.mergedIntoId ? { mergedIntoId: theme.mergedIntoId } : {}),
    };
  }

  @Post(':id/save-as-card')
  @ApiOperation({ summary: 'Сохранить тему как карточку (kind=topic, bornFromThemeId)' })
  async saveAsCard(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SaveThemeAsCardSchema))
    body: SaveThemeAsCardDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ThemeSavedAsCardDto> {
    if (!tenantId) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'tenant_required', message: 'Org не определена' },
      });
    }
    const [readOk, writeOk] = await Promise.all([
      this.rbac.canRead(user.id, tenantId, 'theme'),
      this.rbac.canWrite(user.id, tenantId, 'card', user.id),
    ]);
    if (!readOk || !writeOk) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав' },
      });
    }

    const theme = await this.prisma.theme.findUnique({ where: { id } });
    if (!theme || theme.tenantId !== tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'theme_not_found', message: 'Тема не найдена' },
      });
    }
    if (theme.status !== 'active') {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'theme_not_active',
          message: 'Сохранять как карточку можно только активные темы',
        },
      });
    }

    const cardName = (body.name?.trim() || theme.name).slice(0, 200);
    try {
      const card = await this.prisma.card.create({
        data: {
          tenantId,
          ownerId: user.id,
          name: cardName,
          kind: 'topic',
          description: theme.description,
          bornFromThemeId: theme.id,
        },
        select: { id: true, name: true, kind: true, bornFromThemeId: true },
      });
      return {
        cardId: card.id,
        name: card.name,
        kind: card.kind,
        bornFromThemeId: card.bornFromThemeId ?? theme.id,
      };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({
          ok: false,
          error: {
            code: 'card_name_taken',
            message: 'Карточка с таким названием уже существует',
          },
        });
      }
      throw err;
    }
  }

  private mapTheme(
    t: {
      id: string;
      name: string;
      description: string;
      branch: string | null;
      status: string;
      weight: unknown;
      confidence: unknown;
      dynamic: string;
      lastSignalAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    },
    blocksCount: number,
    entitiesCount: number,
  ): ThemeItemDto {
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      branch: t.branch,
      status: t.status,
      weight: this.decimalToNumber(t.weight),
      confidence: this.decimalToNumber(t.confidence),
      dynamic: t.dynamic,
      lastSignalAt: t.lastSignalAt ? t.lastSignalAt.toISOString() : null,
      blocksCount,
      entitiesCount,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    };
  }

  private mapBlock(b: {
    id: string;
    name: string;
    criticalQuestion: string;
    trustedAnswer: string;
    tags: string[];
    signalType: string;
    confidence: unknown;
    evidenceCount: number;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  }): BlockSearchItemDto {
    return {
      id: b.id,
      name: b.name,
      criticalQuestion: b.criticalQuestion,
      trustedAnswer: b.trustedAnswer,
      signalType: b.signalType,
      tags: b.tags,
      confidence: this.decimalToNumber(b.confidence),
      evidenceCount: b.evidenceCount,
      status: b.status,
      createdAt: b.createdAt.toISOString(),
      updatedAt: b.updatedAt.toISOString(),
    };
  }

  private decimalToNumber(v: unknown): number {
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    if (typeof v === 'string') {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    }
    if (v && typeof (v as { toString?: () => string }).toString === 'function') {
      const n = Number((v as { toString: () => string }).toString());
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  }

  private jsonObj(v: unknown): Record<string, unknown> | null {
    if (v === null || v === undefined) return null;
    if (typeof v !== 'object' || Array.isArray(v)) return null;
    return v as Record<string, unknown>;
  }
}
