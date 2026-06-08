import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import {
  CustomerRiskQuerySchema,
  type CustomerRiskQuery,
  type CustomerRiskListDto,
} from '../dto/customer-risk.dto';
import { CommitmentsService } from '../services/commitments.service';
import { CustomerRiskRadarService } from '../services/customer-risk-radar.service';

/**
 * TZ-1 Фаза 1 (daily-value-engine) — `/api/v1/me/customer-risk`.
 *
 * Self-scope для менеджера: клиенты, где `responsiblePersonId = my Person.id`.
 * НЕ светит чужих клиентов (фильтр идёт по resolved selfPersonId, не по query).
 *
 * Auth: CookieAuthGuard + TenantGuard. Если у пользователя нет Person-записи —
 * отдаём пустой список (200), как в `/me/promises` (Ф9 graceful).
 */
@ApiTags('me-customer-risk')
@Controller('api/v1/me/customer-risk')
@UseGuards(CookieAuthGuard, TenantGuard)
export class MyCustomerRiskController {
  constructor(
    @Inject(CommitmentsService)
    private readonly commitments: CommitmentsService,
    @Inject(CustomerRiskRadarService)
    private readonly customerRisk: CustomerRiskRadarService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Мои клиенты под риском (self-scope, без чужих клиентов)',
  })
  async list(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
    @Query(new ZodValidationPipe(CustomerRiskQuerySchema))
    q: CustomerRiskQuery,
  ): Promise<CustomerRiskListDto> {
    const uid = this.requireUser(req);
    this.requireTenant(tenantId);

    let person: { id: string };
    try {
      person = await this.commitments.resolveSelfPerson({
        tenantId: tenantId!,
        userId: uid,
      });
    } catch (err) {
      if (err instanceof ForbiddenException && this.isNoPersonError(err)) {
        return { items: [], criticalCount: 0, warningCount: 0 };
      }
      throw err;
    }

    return this.customerRisk.listForResponsible({
      tenantId: tenantId!,
      selfPersonId: person.id,
      query: q,
    });
  }

  private isNoPersonError(err: ForbiddenException): boolean {
    const response = err.getResponse();
    return (
      typeof response === 'object' &&
      response !== null &&
      (response as { error?: { code?: string } }).error?.code === 'no_person'
    );
  }

  private requireUser(req: Request): string {
    const uid = req.user?.id;
    if (!uid) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'no_user', message: 'Требуется авторизация' },
      });
    }
    return uid;
  }

  private requireTenant(tenantId: string | undefined): void {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Не передан tenantId' },
      });
    }
  }
}
