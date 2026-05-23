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
import { ApiOperation, ApiTags } from '@nestjs/swagger';

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
  CreateDomainSchema,
  type CreateDomainDto,
  type FunctionalDomainDto,
  ListDomainsQuerySchema,
  type ListDomainsQuery,
  type ListDomainsResponseDto,
  SeedTemplateSchema,
  type SeedTemplateDto,
  type SeedTemplateResponseDto,
  UpdateDomainSchema,
  type UpdateDomainDto,
} from '../dto/functional-domain.dto';
import { FunctionalDomainService } from '../services/functional-domain.service';

/**
 * SBA α-9 wave 3 — REST API `/api/v1/domains`.
 *
 *   GET    /                — tree-view (опц. includeChildren).
 *   POST   /                — создать домен (admin).
 *   GET    /:id             — один домен.
 *   PATCH  /:id             — обновить (admin).
 *   DELETE /:id             — soft-archive (admin).
 *   POST   /seed-template   — admin: дополнить базовыми + per-industry доменами.
 *
 * RBAC: read — все members; write — owner/admin; seed-template — super_admin/admin/owner.
 */
@ApiTags('domains')
@Controller('api/v1/domains')
@UseGuards(CookieAuthGuard, TenantGuard)
export class DomainsController {
  constructor(
    @Inject(FunctionalDomainService)
    private readonly svc: FunctionalDomainService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Дерево функциональных доменов' })
  async list(
    @Query(new ZodValidationPipe(ListDomainsQuerySchema))
    query: ListDomainsQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ListDomainsResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.list({ tenantId: t, query });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Один домен по id' })
  async byId(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<FunctionalDomainDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.get({ tenantId: t, id });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Создать пользовательский домен (admin)' })
  async create(
    @Body(new ZodValidationPipe(CreateDomainSchema)) body: CreateDomainDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<FunctionalDomainDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.create({ tenantId: t, userId: user.id, body });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Обновить домен (admin)' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateDomainSchema)) body: UpdateDomainDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<FunctionalDomainDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.update({ tenantId: t, userId: user.id, id, body });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Архивировать домен (soft-delete, admin)' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ id: string; deletedAt: string }> {
    const t = this.requireTenant(tenantId);
    await this.requireDelete(user.id, t);
    return this.svc.softDelete({ tenantId: t, userId: user.id, id });
  }

  @Post('seed-template')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Дополнить набор базовыми + per-industry доменами' })
  async seedTemplate(
    @Body(new ZodValidationPipe(SeedTemplateSchema)) body: SeedTemplateDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<SeedTemplateResponseDto> {
    const t = this.requireTenant(tenantId);
    // seed-template — повышенное право (как `manage`), но проще закрыть через write +
    // явную проверку: только admin/owner. RBAC `domain:manage` доступен только им.
    await this.requireManage(user.id, t);
    return this.svc.seedTemplate({
      tenantId: t,
      userId: user.id,
      industry: body.industry,
    });
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
    const ok = await this.rbac.canRead(userId, tenantId, 'functional_domain');
    if (!ok) throw this.forbidden('Недостаточно прав для чтения доменов');
  }

  private async requireWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canWrite(userId, tenantId, 'functional_domain');
    if (!ok)
      throw this.forbidden('Изменять домены может только владелец/администратор Org');
  }

  private async requireDelete(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.check({
      userId,
      tenantId,
      obj: 'functional_domain',
      act: 'delete',
    });
    if (!ok) throw this.forbidden('Удалять домены может только владелец/администратор Org');
  }

  private async requireManage(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.check({
      userId,
      tenantId,
      obj: 'functional_domain',
      act: 'manage',
    });
    if (!ok)
      throw this.forbidden('Расширенные операции с доменами доступны только администраторам');
  }

  private forbidden(message: string): ForbiddenException {
    return new ForbiddenException({
      ok: false,
      error: { code: 'forbidden', message },
    });
  }
}
