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

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../rbac/guards/tenant.guard';
import { RbacService } from '../rbac/rbac.service';

import {
  ChangeIdeaStatusBodySchema,
  type ChangeIdeaStatusBody,
  type IdeaClusterDto,
  type IdeaDetailDto,
  LinkIdeaGoalSchema,
  type LinkIdeaGoalBody,
  ListIdeaClustersQuerySchema,
  type ListIdeaClustersQuery,
  type ListIdeaClustersResponse,
  ListIdeasQuerySchema,
  type ListIdeasQuery,
  type ListIdeasResponse,
  MyIdeasQuerySchema,
  type MyIdeasQuery,
  TopIdeasQuerySchema,
  type TopIdeasQuery,
  type TopIdeasResponse,
} from './dto/ideas.dto';
import { IdeasService } from './services/ideas.service';

/**
 * REST API SBA β-5 — Ideas Collector.
 *
 *   GET  /api/v1/ideas                        — список идей (фильтры).
 *   GET  /api/v1/ideas/:id                    — детали идеи.
 *   GET  /api/v1/me/ideas                     — мои идеи (author|supporter).
 *   POST /api/v1/ideas/:id/status             — изменить статус (owner/admin/curator).
 *   POST /api/v1/ideas/:id/support            — поддержать идею (member).
 *   POST /api/v1/me/ideas/:id/withdraw        — отозвать свою идею (автор).
 *   GET  /api/v1/idea-clusters                — список кластеров.
 *   GET  /api/v1/idea-clusters/:id            — детали кластера.
 *
 * RBAC: `idea` ResourceType. Read — все member'ы Org. Write status —
 * owner/admin. Support — любой member. Withdraw — только автор (проверка в
 * сервисе).
 */
@ApiTags('ideas')
@Controller('api/v1')
@UseGuards(CookieAuthGuard, TenantGuard)
export class IdeasController {
  constructor(
    @Inject(IdeasService) private readonly svc: IdeasService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  // ────────────── Idea: list / detail ──────────────

  @Get('ideas')
  @ApiOperation({ summary: 'Список идей (с фильтрами)' })
  async list(
    @Query(new ZodValidationPipe(ListIdeasQuerySchema)) q: ListIdeasQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ListIdeasResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.list({ tenantId: t, userId: user.id, query: q });
  }

  @Get('ideas/top')
  @ApiOperation({
    summary:
      'TZ-1 Ф4.A — топ идей (ре-ранк weight+свежесть+цель). Доступ owner/admin/coo.',
  })
  async top(
    @Query(new ZodValidationPipe(TopIdeasQuerySchema)) q: TopIdeasQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<TopIdeasResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireFeedAccess(user.id, t);
    return this.svc.getTop({ tenantId: t, userId: user.id, query: q });
  }

  @Get('ideas/:id')
  @ApiOperation({ summary: 'Получить идею по id' })
  async byId(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<IdeaDetailDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.getById({ tenantId: t, id });
  }

  // ────────────── Me ──────────────

  @Get('me/ideas')
  @ApiOperation({ summary: 'Мои идеи (author | supporter)' })
  async myIdeas(
    @Query(new ZodValidationPipe(MyIdeasQuerySchema)) q: MyIdeasQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ListIdeasResponse> {
    const t = this.requireTenant(tenantId);
    return this.svc.listMine({ tenantId: t, userId: user.id, query: q });
  }

  @Post('me/ideas/:id/withdraw')
  @ApiOperation({ summary: 'Отозвать свою идею (только автор)' })
  async withdraw(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true }> {
    const t = this.requireTenant(tenantId);
    return this.svc.withdraw({ tenantId: t, id, userId: user.id });
  }

  // ────────────── Actions ──────────────

  @Post('ideas/:id/status')
  @ApiOperation({ summary: 'Изменить статус идеи (owner / admin)' })
  async changeStatus(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ChangeIdeaStatusBodySchema))
    body: ChangeIdeaStatusBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true; status: string }> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.changeStatus({ tenantId: t, id, body, userId: user.id });
  }

  @Post('ideas/:id/goal')
  @ApiOperation({
    summary: 'Привязать/отвязать идею к цели (owner / admin). goalId=null — отвязать',
  })
  async linkGoal(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(LinkIdeaGoalSchema))
    body: LinkIdeaGoalBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true; goalId: string | null }> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.linkGoal({
      tenantId: t,
      ideaId: id,
      goalId: body.goalId,
      userId: user.id,
    });
  }

  @Post('ideas/:id/support')
  @ApiOperation({ summary: 'Поддержать идею (member)' })
  async support(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true; supporterCount: number }> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.support({ tenantId: t, id, userId: user.id });
  }

  // ────────────── Clusters ──────────────

  @Get('idea-clusters')
  @ApiOperation({ summary: 'Список кластеров идей' })
  async listClusters(
    @Query(new ZodValidationPipe(ListIdeaClustersQuerySchema))
    q: ListIdeaClustersQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ListIdeaClustersResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.listClusters({ tenantId: t, query: q });
  }

  @Get('idea-clusters/:id')
  @ApiOperation({ summary: 'Получить кластер по id' })
  async clusterById(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<IdeaClusterDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.getClusterById({ tenantId: t, id });
  }

  // ────────────── Helpers ──────────────

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
    const ok = await this.rbac.canRead(userId, tenantId, 'idea');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Недостаточно прав для чтения идей',
        },
      });
    }
  }

  private async requireWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canWrite(userId, tenantId, 'idea');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Только owner / admin могут изменять идеи',
        },
      });
    }
  }

  /**
   * TZ-1 Ф4.A — доступ к ленте идей (`GET /ideas/top`): owner/admin/coo
   * (+ super_admin). Переиспользуем `canViewOperationsDashboard` — та же роль,
   * что и для COO-дашборда (лента идей — управленческий виджет, не общий read).
   */
  private async requireFeedAccess(
    userId: string,
    tenantId: string,
  ): Promise<void> {
    const ok = await this.rbac.canViewOperationsDashboard(userId, tenantId);
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden_role',
          message: 'Лента идей доступна owner / admin / coo',
        },
      });
    }
  }
}
