import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CurrentUser, type CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';

import {
  ListSubjectMemoryQuerySchema,
  type ListSubjectMemoryQuery,
  type ListSubjectMemoryResponse,
} from './dto/subject-memory.dto';

@ApiTags('subject-memory')
@Controller('api/v1')
@UseGuards(CookieAuthGuard, TenantGuard)
export class SubjectMemoryController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get('subject-memory')
  @ApiOperation({
    summary: 'Что Кора выучила — выведенные правила самообучения (owner/admin/coo)',
  })
  async list(
    @Query(new ZodValidationPipe(ListSubjectMemoryQuerySchema)) q: ListSubjectMemoryQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ListSubjectMemoryResponse> {
    const t = this.requireTenant(tenantId);
    const ok = await this.rbac.canViewOperationsDashboard(user.id, t);
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: '«Что Кора выучила» доступно только owner / admin / coo',
        },
      });
    }
    const where: Record<string, unknown> = { tenantId: t };
    if (q.status) where.status = q.status;
    if (q.kind) where.kind = q.kind;
    const [items, total, grouped] = await Promise.all([
      this.prisma.subjectMemory.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        take: q.limit,
        skip: (q.page - 1) * q.limit,
        select: {
          id: true,
          kind: true,
          contextText: true,
          ruleText: true,
          status: true,
          confidence: true,
          confirmCount: true,
          refuteCount: true,
          sourceProbeIds: true,
          appliedCount: true,
          occurredAt: true,
          lastAppliedAt: true,
          createdAt: true,
        },
      }),
      this.prisma.subjectMemory.count({ where: { tenantId: t } }),
      this.prisma.subjectMemory.groupBy({
        by: ['status'],
        where: { tenantId: t },
        _count: { _all: true },
      }),
    ]);
    const countsByStatus: Record<string, number> = {};
    for (const g of grouped) countsByStatus[g.status] = g._count._all;
    return {
      items: items.map((r) => ({
        id: r.id,
        kind: r.kind,
        contextText: r.contextText,
        ruleText: r.ruleText,
        status: r.status,
        confidence: Number(r.confidence),
        confirmCount: r.confirmCount,
        refuteCount: r.refuteCount,
        sourceProbeIds: r.sourceProbeIds,
        appliedCount: r.appliedCount,
        occurredAt: r.occurredAt.toISOString(),
        lastAppliedAt: r.lastAppliedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      page: q.page,
      limit: q.limit,
      countsByStatus,
    };
  }

  private requireTenant(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Организация не определена' },
      });
    }
    return tenantId;
  }
}
