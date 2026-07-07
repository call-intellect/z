import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  Logger,
  NotFoundException,
  Optional,
  Param,
  Patch,
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
import { tenantTopOf } from '../../dialog-layer/utils/tenant-top';
import { RequireEntitlement } from '../../entitlements/require-entitlement.decorator';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { KnowledgeAccessResolver } from '../../rbac/knowledge-access-resolver.service';
import { RbacService } from '../../rbac/rbac.service';
import { IssuesService } from '../../tracker/services/issues.service';
import { ProjectsService } from '../../tracker/services/projects.service';
import { ThemeFillService } from '../services/theme-fill.service';
import { ThemeWriteService } from '../services/theme-write.service';

import type { BlockSearchItemDto, EntityItemDto } from './dto/search.dto';
import {
  type CreateThemeDto,
  CreateThemeSchema,
  type ListThemesQuery,
  ListThemesQuerySchema,
  type ListThemesResultDto,
  type PinToThemeDto,
  PinToThemeSchema,
  type RenameThemeDto,
  RenameThemeSchema,
  type SaveThemeAsCardDto,
  SaveThemeAsCardSchema,
  type ThemeBlockItemDto,
  type ThemeDetailDto,
  type ThemeItemDto,
  type ThemeSavedAsCardDto,
} from './dto/theme.dto';

const THEME_DETAIL_BLOCKS_LIMIT = 20;
const THEME_DETAIL_ENTITIES_LIMIT = 50;
const THEME_DETAIL_DETAILS_LIMIT = 50;

@ApiTags('knowledge-core')
@Controller('api/v1/knowledge/themes')
@UseGuards(CookieAuthGuard, TenantGuard)
@RequireEntitlement('feature.theme')
export class KnowledgeThemesController {
  private readonly logger = new Logger(KnowledgeThemesController.name);

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
    @Optional()
    @Inject(ThemeWriteService)
    private readonly themeWrite: ThemeWriteService | null = null,
    @Optional()
    @Inject(ThemeFillService)
    private readonly themeFill: ThemeFillService | null = null,
    @Optional()
    @Inject(IssuesService)
    private readonly issues: IssuesService | null = null,
    @Optional()
    @Inject(ProjectsService)
    private readonly projects: ProjectsService | null = null,
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
      AND: [{ OR: [{ visibility: 'team' }, { createdByUserId: user.id }] }],
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
      items: items.map((t) =>
        this.mapTheme(t, t._count.blocks, t._count.entities, t.createdByUserId === user.id),
      ),
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
    if (theme.visibility === 'personal' && theme.createdByUserId !== user.id) {
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

    const themeEntityRows = await this.prisma.themeEntity.findMany({
      where: { themeId: theme.id, tenantId },
      select: { entityId: true },
    });
    const themeEntityIds = themeEntityRows.map((r) => r.entityId);
    const themeBlockIds = visibleBlockRows.map((r) => r.block.id);

    const decisionRows =
      themeEntityIds.length > 0
        ? await this.prisma.decision.findMany({
            where: {
              tenantId,
              OR: [
                { entityId: { in: themeEntityIds } },
                { affectsEntityIds: { hasSome: themeEntityIds } },
              ],
            },
            select: { id: true, statement: true },
            take: THEME_DETAIL_DETAILS_LIMIT,
          })
        : [];

    const taskRows =
      themeBlockIds.length > 0
        ? await this.prisma.issue.findMany({
            where: { tenantId, sourceBlockIds: { hasSome: themeBlockIds } },
            select: { id: true, title: true },
            take: THEME_DETAIL_DETAILS_LIMIT,
          })
        : [];

    const documentRows = await this.prisma.document.findMany({
      where: { tenantId, attachedThemeId: theme.id },
      select: { id: true, name: true },
      take: THEME_DETAIL_DETAILS_LIMIT,
    });

    const regulationRows =
      themeEntityIds.length > 0
        ? await this.prisma.regulation.findMany({
            where: { tenantId, entityId: { in: themeEntityIds } },
            select: { id: true, name: true, category: true },
            take: THEME_DETAIL_DETAILS_LIMIT,
          })
        : [];

    return {
      theme: this.mapTheme(
        theme,
        theme._count.blocks,
        theme._count.entities,
        theme.createdByUserId === user.id,
      ),
      blocks: visibleBlockRows.map((r): ThemeBlockItemDto => this.mapThemeBlock(r)),
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
      decisions: decisionRows.map((d) => ({
        id: d.id,
        statement: d.statement,
        reversibility: null,
        href: `/decisions/${d.id}`,
      })),
      tasks: taskRows.map((t) => ({ id: t.id, title: t.title, href: `/issues/${t.id}` })),
      documents: documentRows.map((d) => ({
        id: d.id,
        title: d.name,
        href: `/documents/${d.id}`,
      })),
      regulations: regulationRows.map((r) => ({
        id: r.id,
        title: r.name,
        category: String(r.category),
        href: `/regulations/${r.id}`,
      })),
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

  @Post()
  @ApiOperation({ summary: 'Создать пользовательскую тему (personal/team) + авто-наполнение' })
  async create(
    @Body(new ZodValidationPipe(CreateThemeSchema)) body: CreateThemeDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ThemeItemDto> {
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
    if (body.visibility === 'team') {
      const canTeam = await this.rbac.canCreateTeamTheme(user.id, tenantId);
      if (!canTeam) {
        throw new ForbiddenException({
          ok: false,
          error: {
            code: 'forbidden_team_theme',
            message: 'Недостаточно прав для создания командной темы',
          },
        });
      }
    }
    if (!this.themeWrite) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Создание тем недоступно' },
      });
    }

    const { id } = await this.themeWrite.createTheme({
      tenantId,
      phrase: body.phrase,
      visibility: body.visibility,
      createdByUserId: user.id,
    });

    if (this.cfg && this.themeFill) {
      try {
        const opts = await this.cfg.themeAutofillOpts();
        if (opts.enabled) {
          await this.themeFill.fillTheme({
            tenantId,
            themeId: id,
            opts: {
              threshold: opts.threshold,
              scanWindowDays: opts.scanWindowDays,
              maxPerScan: opts.maxPerScan,
              dedupeSimilarity: opts.dedupeSimilarity,
            },
          });
        }
      } catch (err) {
        this.logger.warn(`fill-on-create не выполнен для темы ${id}: ${String(err)}`);
      }
    }

    const created = await this.prisma.theme.findUnique({
      where: { id },
      include: { _count: { select: { blocks: true, entities: true } } },
    });
    if (!created) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'theme_not_found', message: 'Тема не найдена' },
      });
    }
    return this.mapTheme(created, created._count.blocks, created._count.entities, true);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Переименовать тему (владелец/командная роль)' })
  async rename(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RenameThemeSchema)) body: RenameThemeDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ThemeItemDto> {
    if (!tenantId) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'tenant_required', message: 'Org не определена' },
      });
    }
    const theme = await this.loadThemeForWrite(id, tenantId);
    await this.assertThemeOwner(theme, user, tenantId);
    if (!this.themeWrite) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Изменение тем недоступно' },
      });
    }
    await this.themeWrite.renameTheme({ tenantId, themeId: id, name: body.name });

    const updated = await this.prisma.theme.findUnique({
      where: { id },
      include: { _count: { select: { blocks: true, entities: true } } },
    });
    if (!updated) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'theme_not_found', message: 'Тема не найдена' },
      });
    }
    return this.mapTheme(
      updated,
      updated._count.blocks,
      updated._count.entities,
      updated.createdByUserId === user.id,
    );
  }

  @Post(':id/archive')
  @ApiOperation({ summary: 'Архивировать тему (владелец/командная роль)' })
  async archive(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true }> {
    if (!tenantId) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'tenant_required', message: 'Org не определена' },
      });
    }
    const theme = await this.loadThemeForWrite(id, tenantId);
    await this.assertThemeOwner(theme, user, tenantId);
    if (!this.themeWrite) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Изменение тем недоступно' },
      });
    }
    await this.themeWrite.archiveTheme({ tenantId, themeId: id });
    return { ok: true };
  }

  @Post(':id/pin')
  @ApiOperation({ summary: 'Прикрепить блок/сущность к теме (владелец/командная роль)' })
  async pin(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(PinToThemeSchema)) body: PinToThemeDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true }> {
    if (!tenantId) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'tenant_required', message: 'Org не определена' },
      });
    }
    const theme = await this.loadThemeForWrite(id, tenantId);
    await this.assertThemeOwner(theme, user, tenantId);
    if (!this.themeWrite) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Изменение тем недоступно' },
      });
    }
    await this.themeWrite.pin({ tenantId, themeId: id, kind: body.kind, objectId: body.id });
    return { ok: true };
  }

  @Delete(':id/pin/:kind/:objectId')
  @ApiOperation({ summary: 'Открепить блок/сущность от темы (unpin → исключение)' })
  async unpin(
    @Param('id') id: string,
    @Param('kind') kind: string,
    @Param('objectId') objectId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true }> {
    if (!tenantId) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'tenant_required', message: 'Org не определена' },
      });
    }
    if (kind !== 'block' && kind !== 'entity') {
      throw new BadRequestException({
        ok: false,
        error: { code: 'invalid_kind', message: 'kind должен быть block или entity' },
      });
    }
    const theme = await this.loadThemeForWrite(id, tenantId);
    await this.assertThemeOwner(theme, user, tenantId);
    if (!this.themeWrite) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Изменение тем недоступно' },
      });
    }
    await this.themeWrite.unpin({
      tenantId,
      themeId: id,
      kind,
      objectId,
      createdByUserId: user.id,
    });
    this.metrics?.incThemeExclusions({ tenantTop: tenantTopOf(tenantId), count: 1 });
    return { ok: true };
  }

  @Post(':id/commitments/:blockId/to-task')
  @ApiOperation({ summary: 'Завести задачу трекера из обязательства темы (идемпотентно)' })
  async commitmentToTask(
    @Param('id') id: string,
    @Param('blockId') blockId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ taskId: string; created: boolean }> {
    if (!tenantId) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'tenant_required', message: 'Org не определена' },
      });
    }
    const theme = await this.loadThemeForWrite(id, tenantId);
    if (theme.visibility === 'personal' && theme.createdByUserId !== user.id) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'theme_not_found', message: 'Тема не найдена' },
      });
    }
    if (!(await this.rbac.canRead(user.id, tenantId, 'theme'))) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав' },
      });
    }

    const link = await this.prisma.themeIdeaBlock.findUnique({
      where: { themeId_blockId_tenantId: { themeId: id, blockId, tenantId } },
    });
    if (!link) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'block_not_in_theme', message: 'Блок не привязан к этой теме' },
      });
    }

    const block = await this.prisma.ideaBlock.findFirst({
      where: { id: blockId, tenantId },
      select: { name: true, trustedAnswer: true },
    });
    if (!block) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'block_not_found', message: 'Блок не найден' },
      });
    }

    const externalId = ('theme-commitment:' + id + ':' + blockId).slice(0, 200);
    const existing = await this.prisma.issue.findFirst({
      where: { tenantId, externalSource: 'theme_commitment', externalId },
    });
    if (existing) {
      return { taskId: existing.id, created: false };
    }

    if (!this.projects || !this.issues) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Создание задач недоступно' },
      });
    }

    const projectId = await this.projects.ensureInboxProjectId(tenantId);
    if (!projectId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'inbox_project_unavailable',
          message: 'Не удалось определить проект «Входящие»',
        },
      });
    }

    const title = (block.name?.trim() || block.trustedAnswer.trim()).slice(0, 200);
    const description = block.trustedAnswer;
    const issue = await this.issues.create(
      projectId,
      {
        title,
        description,
        descriptionHtml: null,
        descriptionStripped: description,
        priority: 'none',
        stateId: null,
        parentId: null,
        estimatePoints: null,
        sortOrder: 0,
        startDate: null,
        dueDate: null,
        cycleId: null,
        goalId: null,
        assigneeUserIds: [],
        labelIds: [],
        externalSource: 'theme_commitment',
        externalId,
        sourceBlockIds: [blockId],
        skipDedup: true,
      },
      tenantId,
      user.id,
    );

    return { taskId: issue.id, created: true };
  }

  private async loadThemeForWrite(
    id: string,
    tenantId: string,
  ): Promise<{ id: string; tenantId: string; visibility: string; createdByUserId: string | null }> {
    const theme = await this.prisma.theme.findUnique({
      where: { id },
      select: { id: true, tenantId: true, visibility: true, createdByUserId: true },
    });
    if (!theme || theme.tenantId !== tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'theme_not_found', message: 'Тема не найдена' },
      });
    }
    return theme;
  }

  private async assertThemeOwner(
    theme: { visibility: string; createdByUserId: string | null },
    user: CurrentUserPayload,
    tenantId: string,
  ): Promise<void> {
    if (theme.visibility === 'personal') {
      if (theme.createdByUserId !== user.id) {
        throw new ForbiddenException({
          ok: false,
          error: { code: 'not_theme_owner', message: 'Тема принадлежит другому пользователю' },
        });
      }
      return;
    }
    const canTeam = await this.rbac.canCreateTeamTheme(user.id, tenantId);
    if (!canTeam) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав' },
      });
    }
  }

  private mapTheme(
    t: {
      id: string;
      name: string;
      description: string;
      branch: string | null;
      status: string;
      origin: string;
      visibility: string;
      weight: unknown;
      confidence: unknown;
      dynamic: string;
      lastSignalAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    },
    blocksCount: number,
    entitiesCount: number,
    isMine: boolean,
  ): ThemeItemDto {
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      branch: t.branch,
      status: t.status,
      origin: t.origin,
      visibility: t.visibility,
      isMine,
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

  private mapThemeBlock(r: {
    addedVia: string;
    score: unknown;
    reason: string | null;
    block: Parameters<KnowledgeThemesController['mapBlock']>[0];
  }): ThemeBlockItemDto {
    return {
      ...this.mapBlock(r.block),
      addedVia: r.addedVia,
      score: r.score === null || r.score === undefined ? null : this.decimalToNumber(r.score),
      reason: r.reason,
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
