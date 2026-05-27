import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

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
  BulkCreateChecklistItemsSchema,
  type BulkCreateChecklistItemsDto,
  type ChecklistItemResponseDto,
  type ChecklistResponseDto,
  CreateChecklistItemSchema,
  CreateChecklistSchema,
  type CreateChecklistDto,
  type CreateChecklistItemDto,
  ReorderChecklistItemsSchema,
  type ReorderChecklistItemsDto,
  ReorderChecklistsSchema,
  type ReorderChecklistsDto,
  UpdateChecklistItemSchema,
  type UpdateChecklistItemDto,
  UpdateChecklistSchema,
  type UpdateChecklistDto,
} from '../dto/checklists/checklist.dto';
import { ChecklistsService } from '../services/checklists.service';

/**
 * REST `/api/v1/issues/:id/checklists` + `/api/v1/checklists/...` +
 * `/api/v1/checklist-items/...`.
 *
 * RBAC: наследуем от Issue (отдельного ResourceType `checklist` нет — см.
 * ТЗ §RBAC, plans/tz/2026-05-27-tracker-checklists.md).
 *   - read   ← canRead(user, tenant, 'issue')
 *   - write  ← canWrite(user, tenant, 'issue')
 */
@ApiTags('tracker / checklists')
@ApiBearerAuth()
@Controller('api/v1')
@UseGuards(CookieAuthGuard, TenantGuard)
export class ChecklistsController {
  constructor(
    @Inject(ChecklistsService) private readonly svc: ChecklistsService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  // ── Checklists ────────────────────────────────────────────────────────

  @Get('issues/:id/checklists')
  @ApiOperation({ summary: 'Список чек-листов задачи (с пунктами inline)' })
  async list(
    @Param('id') issueId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ChecklistResponseDto[]> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.listForIssue(issueId, t);
  }

  @Post('issues/:id/checklists')
  @ApiOperation({ summary: 'Создать чек-лист на задаче' })
  async create(
    @Param('id') issueId: string,
    @Body(new ZodValidationPipe(CreateChecklistSchema)) body: CreateChecklistDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ChecklistResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.createChecklist(issueId, body, t);
  }

  @Patch('checklists/:id')
  @ApiOperation({ summary: 'Переименовать чек-лист' })
  async update(
    @Param('id') checklistId: string,
    @Body(new ZodValidationPipe(UpdateChecklistSchema)) body: UpdateChecklistDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ChecklistResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.updateChecklist(checklistId, body, t);
  }

  @Delete('checklists/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Удалить чек-лист (soft delete)' })
  async remove(
    @Param('id') checklistId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<void> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    await this.svc.deleteChecklist(checklistId, t);
  }

  @Post('checklists/reorder')
  @ApiOperation({ summary: 'Изменить порядок чек-листов внутри задачи' })
  async reorder(
    @Body(new ZodValidationPipe(ReorderChecklistsSchema))
    body: ReorderChecklistsDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ChecklistResponseDto[]> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.reorderChecklists({
      issueId: body.issueId,
      checklistIds: body.checklistIds,
      tenantId: t,
    });
  }

  // ── Checklist items ───────────────────────────────────────────────────

  @Post('checklists/:id/items')
  @ApiOperation({ summary: 'Создать пункт чек-листа' })
  async createItem(
    @Param('id') checklistId: string,
    @Body(new ZodValidationPipe(CreateChecklistItemSchema))
    body: CreateChecklistItemDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ChecklistItemResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.createItem(checklistId, body, t);
  }

  @Patch('checklist-items/:id')
  @ApiOperation({ summary: 'Изменить пункт (text / isDone / sequence)' })
  async updateItem(
    @Param('id') itemId: string,
    @Body(new ZodValidationPipe(UpdateChecklistItemSchema))
    body: UpdateChecklistItemDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ChecklistItemResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.updateItem(itemId, body, t, user.id);
  }

  @Delete('checklist-items/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Удалить пункт' })
  async removeItem(
    @Param('id') itemId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<void> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    await this.svc.deleteItem(itemId, t);
  }

  @Post('checklist-items/reorder')
  @ApiOperation({ summary: 'Изменить порядок пунктов внутри чек-листа' })
  async reorderItems(
    @Body(new ZodValidationPipe(ReorderChecklistItemsSchema))
    body: ReorderChecklistItemsDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ChecklistItemResponseDto[]> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.reorderItems({
      checklistId: body.checklistId,
      itemIds: body.itemIds,
      tenantId: t,
    });
  }

  @Post('checklist-items/bulk-create')
  @ApiOperation({
    summary: 'Массовое создание пунктов (до 50 строк, для вставки списка)',
  })
  async bulkCreateItems(
    @Body(new ZodValidationPipe(BulkCreateChecklistItemsSchema))
    body: BulkCreateChecklistItemsDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ChecklistItemResponseDto[]> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.bulkCreateItems(
      body.checklistId,
      { checklistId: body.checklistId, lines: body.lines },
      t,
    );
  }

  // ── helpers ───────────────────────────────────────────────────────────

  private requireTenant(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'tenant_required',
          message: 'Организация не определена',
        },
      });
    }
    return tenantId;
  }

  private async requireRead(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canRead(userId, tenantId, 'issue');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Недостаточно прав на чтение задач',
        },
      });
    }
  }

  private async requireWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canWrite(userId, tenantId, 'issue');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Недостаточно прав на изменение чек-листов',
        },
      });
    }
  }
}
