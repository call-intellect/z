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
import { z } from 'zod';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';
import {
  PersonCommitmentsQuerySchema,
  type PersonCommitmentsQuery,
  type CommitmentDto,
} from '../dto/commitments.dto';
import type { PersonalRelationListDto } from '../dto/operations-dashboard.dto';
import { CommitmentsService } from '../services/commitments.service';
import { PersonalRelationService } from '../services/personal-relation.service';

const ListQuerySchema = z
  .object({
    personId: z.string().max(80).optional(),
    relationType: z.string().max(80).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();

type ListQuery = z.infer<typeof ListQuerySchema>;

/**
 * SBA β-8 — `GET /api/v1/personal-relations`.
 *
 * Read-only API над PersonalRelation (EntityLink между Person'ами). Доступ:
 * owner/admin/coo/super_admin (см. policy.csv `personal_relation.read`).
 */
@ApiTags('personal-relations')
@Controller('api/v1/personal-relations')
@UseGuards(CookieAuthGuard, TenantGuard)
export class PersonalRelationsController {
  constructor(
    @Inject(PersonalRelationService)
    private readonly svc: PersonalRelationService,
    @Inject(RbacService) private readonly rbac: RbacService,
    @Inject(CommitmentsService)
    private readonly commitments: CommitmentsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Список personal-relation EntityLink (фильтр по personId/relationType)' })
  async list(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
    @Query(new ZodValidationPipe(ListQuerySchema)) q: ListQuery,
  ): Promise<PersonalRelationListDto> {
    const uid = this.requireUser(req);
    this.requireTenant(tenantId);
    const allowed = await this.rbac.canRead(uid, tenantId!, 'personal_relation');
    if (!allowed) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Нет прав на personal-relations' },
      });
    }
    return this.svc.list({
      tenantId: tenantId!,
      personId: q.personId,
      relationType: q.relationType,
      limit: q.limit,
    });
  }

  /**
   * SBA β-8.2 — Обещания человека (исходящие + входящие).
   * Доступ — admin/coo/owner (через RBAC commitment.read).
   */
  @Get('commitments')
  @ApiOperation({ summary: 'Обещания человека (исходящие + входящие)' })
  async commitmentsForPerson(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
    @Query(new ZodValidationPipe(PersonCommitmentsQuerySchema))
    q: PersonCommitmentsQuery,
  ): Promise<{ outgoing: CommitmentDto[]; incoming: CommitmentDto[] }> {
    const uid = this.requireUser(req);
    this.requireTenant(tenantId);
    const allowed = await this.rbac.canRead(uid, tenantId!, 'commitment');
    if (!allowed) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Нет прав на обещания' },
      });
    }
    return this.commitments.listForPerson({
      tenantId: tenantId!,
      personId: q.personId,
      limit: q.limit,
    });
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
