import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { ProactiveNotification } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * SBA δ-2 — REST-сервис под `/api/v1/me/proactive-notifications`.
 *
 *   - listMine — возвращает ProactiveNotification, адресованные текущему user'у.
 *     По дефолту скрывает dismissed; query `includeDismissed=true` показывает все.
 *   - dismiss  — пользователь помечает уведомление как «не показывать».
 *     Идемпотентно (повторный dismiss — no-op).
 */
@Injectable()
export class ProactiveNotificationsService {
  private readonly logger = new Logger(ProactiveNotificationsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  async listMine(args: {
    tenantId: string;
    userId: string;
    includeDismissed?: boolean;
    limit?: number;
  }): Promise<ProactiveNotification[]> {
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
    return this.prisma.proactiveNotification.findMany({
      where: {
        tenantId: args.tenantId,
        userId: args.userId,
        ...(args.includeDismissed === true
          ? {}
          : { dismissedAt: null }),
      },
      orderBy: { emittedAt: 'desc' },
      take: limit,
    });
  }

  async dismiss(args: {
    tenantId: string;
    userId: string;
    id: string;
  }): Promise<ProactiveNotification> {
    const row = await this.prisma.proactiveNotification.findUnique({
      where: { id: args.id },
    });
    if (!row || row.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'proactive_notification_not_found',
          message: 'Проактивное уведомление не найдено',
        },
      });
    }
    if (row.userId !== args.userId) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'not_recipient',
          message: 'Это уведомление адресовано другому пользователю',
        },
      });
    }
    if (row.dismissedAt) {
      return row;
    }
    const updated = await this.prisma.proactiveNotification.update({
      where: { id: row.id },
      data: { dismissedAt: new Date() },
    });
    this.metrics.incProactiveDismissed({ rule: row.ruleType });
    this.logger.log(
      { id: row.id, ruleType: row.ruleType, userId: args.userId },
      'proactive: пользователь отклонил уведомление',
    );
    return updated;
  }
}
