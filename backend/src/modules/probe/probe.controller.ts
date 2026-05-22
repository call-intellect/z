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

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../rbac/guards/tenant.guard';
import { RbacService } from '../rbac/rbac.service';

import {
  ListProbeQueueQuerySchema,
  type ListProbeQueueQuery,
  type ListProbeQueueResponse,
  MyProbeHistoryQuerySchema,
  type MyProbeHistoryQuery,
  type MyProbeHistoryResponse,
} from './dto/probe.dto';

/**
 * REST API Probe-Agent (SBA β-5).
 *
 *   GET /api/v1/probe/queue        — admin: список ProbeEvent с фильтром.
 *   GET /api/v1/me/probe-history   — текущему user'у: история probe-уведомлений.
 *
 * RBAC: ProbeEvent — admin/owner; me/probe-history — self-фильтр через
 * `recipientUserId`, RBAC обходит (стандартный pattern me-endpoint'ов).
 */
@ApiTags('probe')
@Controller('api/v1')
@UseGuards(CookieAuthGuard, TenantGuard)
export class ProbeController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get('probe/queue')
  @ApiOperation({ summary: 'Очередь Probe-событий (admin)' })
  async listQueue(
    @Query(new ZodValidationPipe(ListProbeQueueQuerySchema))
    q: ListProbeQueueQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ListProbeQueueResponse> {
    const t = this.requireTenant(tenantId);
    // owner/admin only — пробуем сначала через org read, потом упадём
    const ok = await this.rbac.check({
      userId: user.id,
      tenantId: t,
      obj: 'org',
      act: 'manage',
    });
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Очередь Probe-Agent доступна только owner / admin Org',
        },
      });
    }
    const where: Record<string, unknown> = { tenantId: t };
    if (q.status) where.status = q.status;
    if (q.emittedByService) where.emittedByService = q.emittedByService;
    const [items, total] = await Promise.all([
      this.prisma.probeEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: q.limit,
        skip: (q.page - 1) * q.limit,
      }),
      this.prisma.probeEvent.count({ where }),
    ]);
    return {
      items: items.map((p) => ({
        id: p.id,
        emittedByService: p.emittedByService,
        reason: p.reason,
        status: p.status,
        recipientCandidates: p.recipientCandidates,
        selectedRecipientId: p.selectedRecipientId,
        priority: p.priority,
        createdAt: p.createdAt.toISOString(),
        dispatchedAt: p.dispatchedAt?.toISOString() ?? null,
        expiresAt: p.expiresAt?.toISOString() ?? null,
        dispatchedNotificationId: p.dispatchedNotificationId,
      })),
      total,
      page: q.page,
      limit: q.limit,
    };
  }

  @Get('me/probe-history')
  @ApiOperation({ summary: 'История моих probe-уведомлений' })
  async myHistory(
    @Query(new ZodValidationPipe(MyProbeHistoryQuerySchema))
    q: MyProbeHistoryQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<MyProbeHistoryResponse> {
    const t = this.requireTenant(tenantId);
    const where = {
      tenantId: t,
      recipientUserId: user.id,
      eventType: { startsWith: 'probe.' },
    } as const;
    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: q.limit,
        skip: (q.page - 1) * q.limit,
      }),
      this.prisma.notification.count({ where }),
    ]);
    return {
      items: items.map((n) => ({
        id: n.id,
        eventType: n.eventType,
        payload: (n.payload as Record<string, unknown> | null) ?? {},
        status: n.status,
        responseStatus: n.responseStatus,
        createdAt: n.createdAt.toISOString(),
        respondedAt: n.respondedAt?.toISOString() ?? null,
      })),
      total,
      page: q.page,
      limit: q.limit,
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
