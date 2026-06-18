import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CurrentUser, type CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';
import {
  type CoraFeedQuery,
  CoraFeedQuerySchema,
  type CoraFeedResponseDto,
  type CoraSeenResponseDto,
  type FeedItemDto,
  type FeedTypeDto,
  FeedTypeSchema,
  ListFeedQuerySchema,
  type ListFeedQuery,
  type ListFeedResponseDto,
  ReactBodySchema,
  type ReactBody,
} from '../dto/activity-feed.dto';
import { ActivityFeedService } from '../services/activity-feed.service';
import { CoraFeedService } from '../services/cora-feed.service';

@ApiTags('activity-feed')
@Controller('api/v1/feed')
@UseGuards(CookieAuthGuard, TenantGuard)
export class FeedController {
  constructor(
    @Inject(ActivityFeedService) private readonly svc: ActivityFeedService,
    @Inject(CoraFeedService) private readonly cora: CoraFeedService,
    @Inject(RbacService) private readonly rbac: RbacService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Единая лента активности пользователя' })
  async listAll(
    @Query(new ZodValidationPipe(ListFeedQuerySchema))
    q: ListFeedQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ListFeedResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    const ctx = await this.loadUserScope(user.id, t);
    return this.svc.getFeed({
      tenantId: t,
      userId: user.id,
      userTeamIds: ctx.teamIds,
      userRoleIds: ctx.roleIds,
      query: q,
    });
  }

  @Get('cora')
  @ApiOperation({
    summary:
      'Лента Коры — единая лента-новости с переключателем типов (idea / insight / decision / conflict / blocker / activity / probe_question / open_question)',
  })
  async coraFeed(
    @Query(new ZodValidationPipe(CoraFeedQuerySchema))
    q: CoraFeedQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<CoraFeedResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.cora.getFeed({ tenantId: t, userId: user.id, query: q });
  }

  @Post('cora/seen')
  @ApiOperation({
    summary: 'Отметить Ленту Коры прочитанной (двигает per-user курсор на now)',
  })
  async coraSeen(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<CoraSeenResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.cora.markCoraSeen({ tenantId: t, userId: user.id });
  }

  @Get(':type')
  @ApiOperation({
    summary: 'Лента конкретного типа (probe_question / insight / ...)',
  })
  async listByType(
    @Param('type') typeParam: string,
    @Query(new ZodValidationPipe(ListFeedQuerySchema))
    q: ListFeedQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ListFeedResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    const feedType = this.parseFeedType(typeParam);
    const ctx = await this.loadUserScope(user.id, t);
    return this.svc.getFeed({
      tenantId: t,
      userId: user.id,
      userTeamIds: ctx.teamIds,
      userRoleIds: ctx.roleIds,
      query: { ...q, feedType },
    });
  }

  @Post(':id/react')
  @ApiOperation({ summary: 'Поставить реакцию (thanks / vote) на запись' })
  async react(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReactBodySchema)) body: ReactBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true; item: FeedItemDto }> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    const item = await this.svc.react({
      tenantId: t,
      itemId: id,
      userId: user.id,
      reaction: body.reaction,
    });
    return { ok: true, item };
  }

  @Post(':id/seen')
  @ApiOperation({ summary: 'Пометить запись как просмотренную' })
  async seen(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true; item: FeedItemDto }> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    const item = await this.svc.markSeen({
      tenantId: t,
      itemId: id,
      userId: user.id,
    });
    return { ok: true, item };
  }

  @Post(':id/respond')
  @ApiOperation({
    summary: 'Пометить probe-вопрос как отвеченный (фактический ответ — отдельным каналом)',
  })
  async respond(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true; item: FeedItemDto }> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    const item = await this.svc.markResponded({
      tenantId: t,
      itemId: id,
      userId: user.id,
    });
    return { ok: true, item };
  }

  @Post(':id/dismiss')
  @ApiOperation({ summary: 'Скрыть запись из своей ленты' })
  async dismiss(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true; item: FeedItemDto }> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    const item = await this.svc.dismiss({
      tenantId: t,
      itemId: id,
      userId: user.id,
    });
    return { ok: true, item };
  }

  private requireTenant(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Организация не определена' },
      });
    }
    return tenantId;
  }

  private async requireRead(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canRead(userId, tenantId, 'activity_feed_item');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Недостаточно прав для чтения ленты активности',
        },
      });
    }
  }

  private parseFeedType(raw: string): FeedTypeDto {
    const parsed = FeedTypeSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'invalid_feed_type',
          message: `Неизвестный тип ленты: ${raw}`,
        },
      });
    }
    return parsed.data;
  }

  private async loadUserScope(
    userId: string,
    tenantId: string,
  ): Promise<{ teamIds: string[]; roleIds: string[] }> {
    const [memberships, appointments] = await Promise.all([
      this.prisma.membership.findMany({
        where: { userId, orgId: tenantId },
        select: { role: true },
      }),
      this.prisma.appointment
        .findMany({
          where: {
            tenantId,
            status: 'active',
            person: { userId },
          },
          select: { departmentId: true },
        })
        .catch(() => [] as { departmentId: string | null }[]),
    ]);
    const roleIds = memberships.map((m) => String(m.role)).filter((r) => r.length > 0);
    const teamIds = appointments
      .map((a) => a.departmentId)
      .filter((d): d is string => typeof d === 'string' && d.length > 0);
    return { teamIds, roleIds };
  }
}
