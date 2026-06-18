import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { TypedConfigService } from '../../common/config/index';
import { PrismaService } from '../../common/prisma/prisma.service';
import { S3Service } from '../recordings/s3.service';

@Injectable()
export class RetentionExtrasCron {
  private readonly logger = new Logger(RetentionExtrasCron.name);
  private static readonly AUDIT_LOG_RETENTION_DAYS = 365;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(S3Service) private readonly s3: S3Service,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sweep(): Promise<void> {
    const summary = {
      webhookDeliveries: 0,
      exports: 0,
      shareViews: 0,
      apiAccessLogs: 0,
      auditLogs: 0,
      meetings: 0,
      users: 0,
      cards: 0,
    };
    try {
      summary.webhookDeliveries = await this.purgeWebhookDeliveries();
      summary.exports = await this.purgeExports();
      summary.shareViews = await this.purgeShareViews();
      summary.apiAccessLogs = await this.purgeApiAccessLogs();
      summary.auditLogs = await this.purgeAuditLogs();
      summary.meetings = await this.hardDeleteMeetings();
      summary.users = await this.hardDeleteUsers();
      summary.cards = await this.hardDeleteCards();
      const total = Object.values(summary).reduce((s, n) => s + n, 0);
      if (total > 0) {
        this.logger.debug(summary, 'Retention extras: проход завершён');
      }
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'Retention extras: непойманная ошибка',
      );
    }
  }

  private async purgeWebhookDeliveries(): Promise<number> {
    const days = this.cfg.retention.webhookDeliveryDays;
    const before = new Date(Date.now() - days * 86_400_000);
    const r = await this.prisma.webhookDelivery.deleteMany({
      where: { createdAt: { lt: before } },
    });
    return r.count;
  }

  private async purgeExports(): Promise<number> {
    const now = new Date();
    const expired = await this.prisma.export.findMany({
      where: { expiresAt: { lt: now }, status: { not: 'expired' } },
      take: 100,
    });
    let count = 0;
    for (const e of expired) {
      try {
        if (e.s3Key) {
          await this.s3.delete([e.s3Key]).catch(() => undefined);
        }
        await this.prisma.export.update({
          where: { id: e.id },
          data: { status: 'expired', s3Key: null },
        });
        count += 1;
      } catch (err) {
        this.logger.warn(
          {
            exportId: e.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'export retention: ошибка',
        );
      }
    }
    return count;
  }

  private async purgeShareViews(): Promise<number> {
    const days = this.cfg.retention.shareViewDays;
    const before = new Date(Date.now() - days * 86_400_000);
    const r = await this.prisma.meetingShareView.deleteMany({
      where: { viewedAt: { lt: before } },
    });
    return r.count;
  }

  private async purgeApiAccessLogs(): Promise<number> {
    const days = this.cfg.retention.apiAccessLogDays;
    const before = new Date(Date.now() - days * 86_400_000);
    const r = await this.prisma.apiAccessLog.deleteMany({
      where: { createdAt: { lt: before } },
    });
    return r.count;
  }

  private async purgeAuditLogs(): Promise<number> {
    const before = new Date(Date.now() - RetentionExtrasCron.AUDIT_LOG_RETENTION_DAYS * 86_400_000);
    const r = await this.prisma.auditLog.deleteMany({
      where: { createdAt: { lt: before } },
    });
    return r.count;
  }

  private async hardDeleteMeetings(): Promise<number> {
    const grace = this.cfg.retention.softDeleteGraceDays;
    const before = new Date(Date.now() - grace * 86_400_000);
    const r = await this.prisma.meeting.deleteMany({
      where: { deletedAt: { lt: before } },
    });
    return r.count;
  }

  private async hardDeleteUsers(): Promise<number> {
    const grace = this.cfg.retention.softDeleteGraceDays;
    const before = new Date(Date.now() - grace * 86_400_000);
    const r = await this.prisma.user.deleteMany({
      where: { deletedAt: { lt: before } },
    });
    return r.count;
  }

  private async hardDeleteCards(): Promise<number> {
    const grace = this.cfg.retention.softDeleteGraceDays;
    const before = new Date(Date.now() - grace * 86_400_000);
    const r = await this.prisma.card.deleteMany({
      where: { deletedAt: { lt: before } },
    });
    return r.count;
  }
}
