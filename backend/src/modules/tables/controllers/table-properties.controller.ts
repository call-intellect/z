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
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';

import {
  CreatePropertyBodySchema,
  type CreatePropertyBody,
  type PropertyViewDto,
  ReorderPropertyBodySchema,
  type ReorderPropertyBody,
  UpdatePropertyBodySchema,
  type UpdatePropertyBody,
  toPropertyViewDto,
} from '../dto/tables.dto';
import { TablePropertiesService } from '../services/table-properties.service';
import { TablesService } from '../services/tables.service';

@ApiTags('tables')
@ApiBearerAuth()
@Controller('api/v1/tables/:tableId/properties')
@UseGuards(CookieAuthGuard, TenantGuard)
export class TablePropertiesController {
  constructor(
    @Inject(TablePropertiesService)
    private readonly properties: TablePropertiesService,
    @Inject(TablesService) private readonly tables: TablesService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Список колонок таблицы (по порядку отображения)' })
  @ApiOkResponse({ description: 'Колонки таблицы' })
  async list(
    @Param('tableId') tableId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ items: PropertyViewDto[] }> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    const items = await this.properties.list({ tenantId: t, tableId });
    return { items: items.map(toPropertyViewDto) };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Создать новую колонку' })
  async create(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(CreatePropertyBodySchema))
    body: CreatePropertyBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<PropertyViewDto> {
    const t = this.requireTenant(tenantId);
    const table = await this.tables.findById({ tenantId: t, id: tableId });
    await this.requireWrite(user.id, t, table.createdBy);
    const row = await this.properties.create({
      tenantId: t,
      tableId,
      input: body,
    });
    return toPropertyViewDto(row);
  }

  @Patch(':propertyId')
  @ApiOperation({ summary: 'Обновить колонку (имя / config / isPrimary)' })
  async update(
    @Param('tableId') tableId: string,
    @Param('propertyId') propertyId: string,
    @Body(new ZodValidationPipe(UpdatePropertyBodySchema))
    body: UpdatePropertyBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<PropertyViewDto> {
    const t = this.requireTenant(tenantId);
    const table = await this.tables.findById({ tenantId: t, id: tableId });
    await this.requireWrite(user.id, t, table.createdBy);
    const row = await this.properties.update({
      tenantId: t,
      propertyId,
      input: body,
    });
    return toPropertyViewDto(row);
  }

  @Post(':propertyId/reorder')
  @ApiOperation({ summary: 'Изменить порядок колонки (фракционная сортировка)' })
  async reorder(
    @Param('tableId') tableId: string,
    @Param('propertyId') propertyId: string,
    @Body(new ZodValidationPipe(ReorderPropertyBodySchema))
    body: ReorderPropertyBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<PropertyViewDto> {
    const t = this.requireTenant(tenantId);
    const table = await this.tables.findById({ tenantId: t, id: tableId });
    await this.requireWrite(user.id, t, table.createdBy);
    const row = await this.properties.reorder({
      tenantId: t,
      propertyId,
      order: body.order,
    });
    return toPropertyViewDto(row);
  }

  @Delete(':propertyId')
  @ApiOperation({ summary: 'Удалить колонку' })
  async delete(
    @Param('tableId') tableId: string,
    @Param('propertyId') propertyId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ id: string }> {
    const t = this.requireTenant(tenantId);
    const table = await this.tables.findById({ tenantId: t, id: tableId });
    await this.requireDelete(user.id, t, table.createdBy);
    return this.properties.delete({ tenantId: t, propertyId });
  }

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
        error: { code: 'forbidden', message: 'Недостаточно прав для чтения таблицы' },
      });
    }
  }

  private async requireWrite(
    userId: string,
    tenantId: string,
    ownerUserId?: string,
  ): Promise<void> {
    const ok = await this.rbac.canWrite(userId, tenantId, 'table', ownerUserId ?? null);
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав для изменения колонок' },
      });
    }
  }

  private async requireDelete(
    userId: string,
    tenantId: string,
    ownerUserId?: string,
  ): Promise<void> {
    const ok = await this.rbac.check({
      userId,
      tenantId,
      obj: 'table',
      act: 'delete',
      resourceOwnerId: ownerUserId ?? null,
    });
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав для удаления колонок' },
      });
    }
  }
}
