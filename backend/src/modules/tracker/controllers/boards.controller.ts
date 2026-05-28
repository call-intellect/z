import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../../auth/decorators/current-user.decorator';
import { RequireSubscription } from '../../billing/guards/require-subscription.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';
import type {
  BoardResponseDto,
  ListBoardsResponse,
} from '../dto/boards/board-response.dto';
import {
  CreateBoardSchema,
  type CreateBoardDto,
  ListBoardsQuerySchema,
  type ListBoardsQuery,
  ReorderBoardsSchema,
  type ReorderBoardsDto,
  UpdateBoardSchema,
  type UpdateBoardDto,
} from '../dto/boards/board-schemas';
import { BoardsService } from '../services/boards.service';

/**
 * Tracker Boards (2026-05-27) — REST API досок проекта.
 *
 * Endpoints (под `/api/v1` глобальным префиксом):
 *   GET    /projects/:projectId/boards            — список (опц. ?includeArchived=true)
 *   POST   /projects/:projectId/boards            — создать
 *   GET    /boards/:id                            — детали
 *   PATCH  /boards/:id                            — изменить
 *   DELETE /boards/:id                            — soft-delete (issues → default)
 *   POST   /boards/:id/archive                    — архивировать
 *   POST   /boards/:id/unarchive                  — снять архив
 *   POST   /boards/reorder                        — массовый sequence
 *
 * Guards: CookieAuth + Tenant. RBAC ResourceType=`board` (см. policy.csv).
 * ТЗ: plans/tz/2026-05-27-tracker-boards.md.
 */
@ApiTags('tracker / boards')
@ApiBearerAuth()
@Controller('api/v1')
@UseGuards(CookieAuthGuard, TenantGuard)
export class BoardsController {
  constructor(
    @Inject(BoardsService) private readonly svc: BoardsService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get('projects/:projectId/boards')
  @ApiOperation({ summary: 'Список досок проекта' })
  async list(
    @Param('projectId') projectId: string,
    @Query(new ZodValidationPipe(ListBoardsQuerySchema)) query: ListBoardsQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ListBoardsResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.findAll(projectId, t, {
      includeArchived: query.includeArchived,
    });
  }

  @Post('projects/:projectId/boards')
  @RequireSubscription()
  @ApiOperation({ summary: 'Создать доску в проекте' })
  async create(
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(CreateBoardSchema)) body: CreateBoardDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<BoardResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.create(projectId, body, t, user.id);
  }

  /**
   * Массовая переустановка sequence досок. Body: `{ boardIds: string[] }`,
   * порядок = новый sequence. Должен быть зарегистрирован ДО `/boards/:id`,
   * иначе NestJS поймёт `reorder` как id.
   */
  @Post('boards/reorder')
  @RequireSubscription()
  @ApiOperation({ summary: 'Изменить порядок досок проекта (DnD-сортировка)' })
  async reorder(
    @Body(new ZodValidationPipe(ReorderBoardsSchema)) body: ReorderBoardsDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ListBoardsResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.reorder(body.boardIds, t, user.id);
  }

  @Get('boards/:id')
  @ApiOperation({ summary: 'Получить доску по id' })
  async byId(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<BoardResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.findById(id, t);
  }

  @Patch('boards/:id')
  @RequireSubscription()
  @ApiOperation({ summary: 'Изменить доску (название/цвет/иконка/порядок)' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateBoardSchema)) body: UpdateBoardDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<BoardResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.update(id, body, t, user.id);
  }

  @Delete('boards/:id')
  @RequireSubscription()
  @ApiOperation({
    summary: 'Удалить доску (soft). Задачи переедут на основную доску.',
  })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{
    ok: true;
    movedIssuesCount: number;
    movedToBoardId: string;
  }> {
    const t = this.requireTenant(tenantId);
    await this.requireDelete(user.id, t);
    return this.svc.softDelete(id, t, user.id);
  }

  @Post('boards/:id/archive')
  @RequireSubscription()
  @ApiOperation({ summary: 'Архивировать доску' })
  async archive(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<BoardResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.archive(id, t, user.id);
  }

  @Post('boards/:id/unarchive')
  @RequireSubscription()
  @ApiOperation({ summary: 'Разархивировать доску' })
  async unarchive(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<BoardResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.unarchive(id, t, user.id);
  }

  // ── helpers ──

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
    const ok = await this.rbac.canRead(userId, tenantId, 'board');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав на чтение досок' },
      });
    }
  }

  private async requireWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canWrite(userId, tenantId, 'board');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Недостаточно прав на изменение досок',
        },
      });
    }
  }

  private async requireDelete(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.check({
      userId,
      tenantId,
      obj: 'board',
      act: 'delete',
    });
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Только admin / owner могут удалять доски',
        },
      });
    }
  }
}
