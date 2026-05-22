import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
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
  ListVendorsQuerySchema,
  type ListVendorsQuery,
  type ListVendorsResponse,
  type VendorDto,
} from './dto/vendors.dto';
import { VendorsService } from './services/vendors.service';

/**
 * REST API поставщиков (SBA α-3, категория A онтологии).
 *
 *   GET /api/v1/vendors?segment=&status=&q=&page=&limit=
 *   GET /api/v1/vendors/:id
 *
 * RBAC: `vendor` — owner/admin: read/write/delete; manager: read.
 * На α-3 — read-only; POST/PATCH/DELETE появятся в α-6 (Specialist 3-4).
 */
@ApiTags('vendors')
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

  // ─────────────────────────── helpers ──────────────────────────────

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
}
