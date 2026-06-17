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
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
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
  ProbeControlQuerySchema,
  type ProbeControlQuery,
  type ProbeControlItemDto,
  type ProbeControlResponse,
  type ProbeControlStateDto,
} from './dto/probe.dto';

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

  @Get('probe/control')
  @ApiOperation({
    summary:
      'Контроль вопросов Коры — дисциплина ответов (owner / admin / coo): кто получил вопрос и в каком он состоянии',
  })
  async controlQuestions(
    @Query(new ZodValidationPipe(ProbeControlQuerySchema))
    q: ProbeControlQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ProbeControlResponse> {
    const t = this.requireTenant(tenantId);
    const ok = await this.rbac.canViewOperationsDashboard(user.id, t);
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Контроль вопросов Коры доступен только owner / admin / coo',
        },
      });
    }

    const now = new Date();
    const since =
      q.window === undefined || q.window === 'all'
        ? null
        : new Date(now.getTime() - q.window * 24 * 60 * 60 * 1000);

    const notifications = await this.prisma.notification.findMany({
      where: {
        tenantId: t,
        eventType: 'probe.question',
        ...(since ? { createdAt: { gte: since } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
      select: {
        id: true,
        recipientUserId: true,
        payload: true,
        status: true,
        responseStatus: true,
        expiresAt: true,
        createdAt: true,
        respondedAt: true,
      },
    });

    const recipientIds = Array.from(new Set(notifications.map((n) => n.recipientUserId)));
    const persons = recipientIds.length
      ? await this.prisma.person.findMany({
          where: { tenantId: t, userId: { in: recipientIds } },
          select: { userId: true, name: true },
        })
      : [];
    const nameByUserId = new Map<string, string>();
    for (const p of persons) {
      if (p.userId) nameByUserId.set(p.userId, p.name);
    }

    const counts: Record<ProbeControlStateDto, number> = {
      answered: 0,
      read_silent: 0,
      unseen: 0,
      expired: 0,
    };

    const items: ProbeControlItemDto[] = notifications.map((n) => {
      const state = ProbeController.deriveState({
        status: n.status,
        responseStatus: n.responseStatus,
        expiresAt: n.expiresAt,
        now,
      });
      counts[state] += 1;
      const payload = (n.payload as Record<string, unknown> | null) ?? {};
      const question =
        typeof payload.question === 'string' && payload.question.trim().length > 0
          ? payload.question
          : 'Вопрос Коры';
      const endRef = state === 'answered' && n.respondedAt ? n.respondedAt : now;
      const waitingDays = Math.max(
        0,
        Math.floor((endRef.getTime() - n.createdAt.getTime()) / (24 * 60 * 60 * 1000)),
      );
      return {
        notificationId: n.id,
        question,
        recipientName: nameByUserId.get(n.recipientUserId) ?? null,
        askedAt: n.createdAt.toISOString(),
        expiresAt: n.expiresAt?.toISOString() ?? null,
        state,
        waitingDays: state === 'answered' ? 0 : waitingDays,
      };
    });

    return { items, counts };
  }

  static deriveState(args: {
    status: string;
    responseStatus: string | null;
    expiresAt: Date | null;
    now: Date;
  }): ProbeControlStateDto {
    if (args.responseStatus === 'answered' || args.status === 'responded') {
      return 'answered';
    }
    if (
      args.responseStatus === 'expired' ||
      (args.expiresAt != null && args.expiresAt.getTime() < args.now.getTime())
    ) {
      return 'expired';
    }
    if (
      args.status === 'read' &&
      (args.responseStatus === 'pending' || args.responseStatus == null)
    ) {
      return 'read_silent';
    }
    return 'unseen';
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
