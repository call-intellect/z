import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';

import {
  CreateTableViewBodySchema,
  type CreateTableViewBody,
  type TableViewViewDto,
  UpdateTableViewBodySchema,
  type UpdateTableViewBody,
  toTableViewViewDto,
} from '../dto/tables.dto';
import { TableViewsService } from '../services/table-views.service';

/**
 * Smart Tables — REST CRUD сохраняемых видов (`TableView`, Фаза 3).
 *
 *   GET    /api/v1/tables/:tableId/views           — список доступных видов
 *   POST   /api/v1/tables/:tableId/views           — создать вид
 *   GET    /api/v1/tables/:tableId/views/:viewId   — карточка вида
 *   PATCH  /api/v1/tables/:tableId/views/:viewId   — обновить
 *   DELETE /api/v1/tables/:tableId/views/:viewId   — удалить
 *
 * RBAC: ресурс `table`. Read — все member'ы Org (видят shared/public + свои
 * personal); write/delete — владелец или admin (см. policy.csv §Smart Tables).
 *
 * Multi-tenancy: `TenantGuard` обязателен.
 */
@ApiTags('tables')
@ApiBearerAuth()
@Controller('api/v1/tables/:tableId/views')
@UseGuards(CookieAuthGuard, TenantGuard)
export class TableViewsController {
  constructor(
    @Inject(TableViewsService) private readonly views: TableViewsService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Список видов, доступных пользователю' })
  @ApiOkResponse({ description: 'Все shared/public + свои personal' })
  async list(
    @Param('tableId') tableId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ items: TableViewViewDto[] }> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    const items = await this.views.list({
      tenantId: t,
      tableId,
      userId: user.id,
    });
    return { items: items.map(toTableViewViewDto) };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Создать новый сохраняемый вид' })
  async create(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(CreateTableViewBodySchema))
    body: CreateTableViewBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<TableViewViewDto> {
    const t = this.requireTenant(tenantId);
    // На write вид требуем canRead на table — любой member может создать
    // свой personal-вид. Shared/public — тоже создаёт любой member, ограничения
    // на «кто может опубликовать» оставим на Фазу 14 (public-share).
    await this.requireRead(user.id, t);
    const row = await this.views.create({
      tenantId: t,
      tableId,
      userId: user.id,
      input: body,
    });
    return toTableViewViewDto(row);
  }

  @Get(':viewId')
  @ApiOperation({ summary: 'Карточка вида' })
  async byId(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<TableViewViewDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    const row = await this.views.findById({
      tenantId: t,
      tableId,
      viewId,
      userId: user.id,
    });
    return toTableViewViewDto(row);
  }

  @Patch(':viewId')
  @ApiOperation({ summary: 'Обновить вид (имя/config/visibility)' })
  async update(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(UpdateTableViewBodySchema))
    body: UpdateTableViewBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<TableViewViewDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    const row = await this.views.update({
      tenantId: t,
      tableId,
      viewId,
      userId: user.id,
      input: body,
    });
    return toTableViewViewDto(row);
  }

  @Delete(':viewId')
  @ApiOperation({ summary: 'Удалить вид' })
  async delete(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ id: string }> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.views.delete({
      tenantId: t,
      tableId,
      viewId,
      userId: user.id,
    });
  }

  // ─────────────────────────── helpers ────────────────────────────────────

  private requireTenant(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Org не определена' },
      });
    }
    return tenantId;
  }

  private async requireRead(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canRead(userId, tenantId, 'table');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав для чтения видов' },
      });
    }
  }
}
