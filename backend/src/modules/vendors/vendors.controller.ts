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
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../rbac/guards/tenant.guard';
import { RbacService } from '../rbac/rbac.service';

import {
  CreateVendorSchema,
  ListVendorsQuerySchema,
  UpdateVendorSchema,
  type CreateVendorDto,
  type ListVendorsQuery,
  type ListVendorsResponse,
  type UpdateVendorDto,
  type VendorDto,
} from './dto/vendors.dto';
import { VendorsService } from './services/vendors.service';

@ApiTags('vendors')
@ApiBearerAuth()
@Controller('api/v1/vendors')
@UseGuards(CookieAuthGuard, TenantGuard)
export class VendorsController {
  constructor(
    @Inject(VendorsService) private readonly vendors: VendorsService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Список поставщиков Org (с фильтрами и пагинацией)' })
  async list(
    @Query(new ZodValidationPipe(ListVendorsQuerySchema)) q: ListVendorsQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ListVendorsResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.vendors.list({ tenantId: t, query: q });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Получить поставщика по id' })
  async byId(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<VendorDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.vendors.getById({ tenantId: t, id });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Создать поставщика (inline-create из мастера спринта или /vendors)',
  })
  async create(
    @Body(new ZodValidationPipe(CreateVendorSchema)) body: CreateVendorDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<VendorDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.vendors.create({ tenantId: t, dto: body, actorUserId: user.id });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Обновить поставщика (частичное обновление)' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateVendorSchema)) body: UpdateVendorDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<VendorDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.vendors.update({
      tenantId: t,
      id,
      dto: body,
      actorUserId: user.id,
    });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft-delete поставщика (идемпотентно)' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true }> {
    const t = this.requireTenant(tenantId);
    await this.requireDelete(user.id, t);
    return this.vendors.softDelete({ tenantId: t, id, actorUserId: user.id });
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
    const ok = await this.rbac.canRead(userId, tenantId, 'vendor');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Недостаточно прав для чтения поставщиков',
        },
      });
    }
  }

  private async requireWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canWrite(userId, tenantId, 'vendor');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Недостаточно прав для изменения поставщиков',
        },
      });
    }
  }

  private async requireDelete(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.check({
      userId,
      tenantId,
      obj: 'vendor',
      act: 'delete',
    });
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Удалять поставщиков может только владелец/администратор Org',
        },
      });
    }
  }
}
