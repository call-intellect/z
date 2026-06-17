import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { TypedConfigService } from '../../../../common/config/index';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { AdminSettingsService } from '../../settings/admin-settings.service';

import type { RetentionPolicyItemDto, RetentionPreviewDto } from './dto/admin-retention.dto';

const KNOWN_RETENTIONS: Array<{
  type: string;
  envKey: string;
  defaultDays: number;
  description: string;
}> = [
  {
    type: 'meeting_recording',
    envKey: 'DEFAULT_RETENTION_DAYS',
    defaultDays: 30,
    description: 'Записи встреч (Recording)',
  },
  {
    type: 'share_view',
    envKey: 'SHARE_VIEW_RETENTION_DAYS',
    defaultDays: 90,
    description: 'Логи просмотров shared-ссылок (MeetingShareView)',
  },
  {
    type: 'api_access_log',
    envKey: 'API_ACCESS_LOG_RETENTION_DAYS',
    defaultDays: 30,
    description: 'Журнал API-обращений (ApiAccessLog)',
  },
  {
    type: 'webhook_delivery',
    envKey: 'WEBHOOK_DELIVERY_RETENTION_DAYS',
    defaultDays: 30,
    description: 'Журнал webhook-доставок (WebhookDelivery)',
  },
  {
    type: 'soft_delete_grace',
    envKey: 'SOFT_DELETE_GRACE_DAYS',
    defaultDays: 30,
    description: 'Льготный период после soft-delete (мульти-модельный)',
  },
];

@Injectable()
export class AdminRetentionService {
  private readonly logger = new Logger(AdminRetentionService.name);

  private syncedOnce = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminSettingsService)
    private readonly settings: AdminSettingsService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async list(): Promise<RetentionPolicyItemDto[]> {
    await this.ensureSeed();

    const rows = await this.prisma.retentionPolicy.findMany({
      orderBy: { type: 'asc' },
    });

    return rows.map((r) => ({
      type: r.type,
      days: r.days,
      description: r.description,
      updatedBy: r.updatedBy,
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async update(args: {
    type: string;
    days: number;
    reason: string;
    userId: string;
  }): Promise<RetentionPolicyItemDto> {
    const known = this.findKnown(args.type);
    if (!known) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'retention_type_unknown',
          message: `Тип retention "${args.type}" не поддерживается`,
        },
      });
    }

    const updated = await this.prisma.retentionPolicy.upsert({
      where: { type: args.type },
      update: {
        days: args.days,
        updatedBy: args.userId,
      },
      create: {
        type: args.type,
        days: args.days,
        description: known.description,
        updatedBy: args.userId,
      },
    });

    try {
      await this.settings.set(`retention.${args.type}`, args.days, {
        userId: args.userId,
        reason: args.reason,
      });
    } catch (err) {
      this.logger.warn(
        {
          err: err instanceof Error ? err.message : String(err),
          type: args.type,
        },
        'admin-retention: AdminSettings.set failed (мягкий)',
      );
    }

    this.logger.log(`admin-retention: ${args.type} → ${args.days} дней (user=${args.userId})`);

    return {
      type: updated.type,
      days: updated.days,
      description: updated.description,
      updatedBy: updated.updatedBy,
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  async preview(args: { type: string; days?: number }): Promise<RetentionPreviewDto> {
    const known = this.findKnown(args.type);
    if (!known) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'retention_type_unknown',
          message: `Тип retention "${args.type}" не поддерживается`,
        },
      });
    }

    const current = await this.prisma.retentionPolicy.findUnique({
      where: { type: args.type },
    });
    const currentDays = current?.days ?? known.defaultDays;
    const proposedDays = args.days ?? currentDays;
    const cutoff = new Date(Date.now() - proposedDays * 24 * 60 * 60 * 1000);

    let affectedCount = 0;
    let exampleIds: string[] = [];
    let notCountable = false;

    switch (args.type) {
      case 'meeting_recording': {
        affectedCount = await this.prisma.recording.count({
          where: { expiresAt: { lt: cutoff }, deletedAt: null },
        });
        const examples = await this.prisma.recording.findMany({
          where: { expiresAt: { lt: cutoff }, deletedAt: null },
          select: { id: true },
          orderBy: { expiresAt: 'asc' },
          take: 5,
        });
        exampleIds = examples.map((e) => e.id);
        break;
      }
      case 'share_view': {
        affectedCount = await this.prisma.meetingShareView.count({
          where: { viewedAt: { lt: cutoff } },
        });
        const examples = await this.prisma.meetingShareView.findMany({
          where: { viewedAt: { lt: cutoff } },
          select: { id: true },
          orderBy: { viewedAt: 'asc' },
          take: 5,
        });
        exampleIds = examples.map((e) => e.id);
        break;
      }
      case 'api_access_log': {
        affectedCount = await this.prisma.apiAccessLog.count({
          where: { createdAt: { lt: cutoff } },
        });
        const examples = await this.prisma.apiAccessLog.findMany({
          where: { createdAt: { lt: cutoff } },
          select: { id: true },
          orderBy: { createdAt: 'asc' },
          take: 5,
        });
        exampleIds = examples.map((e) => e.id);
        break;
      }
      case 'webhook_delivery': {
        affectedCount = await this.prisma.webhookDelivery.count({
          where: { createdAt: { lt: cutoff } },
        });
        const examples = await this.prisma.webhookDelivery.findMany({
          where: { createdAt: { lt: cutoff } },
          select: { id: true },
          orderBy: { createdAt: 'asc' },
          take: 5,
        });
        exampleIds = examples.map((e) => e.id);
        break;
      }
      case 'soft_delete_grace':
      default: {
        notCountable = true;
        break;
      }
    }

    return {
      type: args.type,
      currentDays,
      proposedDays,
      affectedCount,
      exampleIds,
      notCountable,
    };
  }

  private findKnown(type: string) {
    return KNOWN_RETENTIONS.find((k) => k.type === type);
  }

  private async ensureSeed(): Promise<void> {
    if (this.syncedOnce) return;
    this.syncedOnce = true;

    try {
      for (const known of KNOWN_RETENTIONS) {
        const existing = await this.prisma.retentionPolicy.findUnique({
          where: { type: known.type },
        });
        if (existing) continue;

        const envValue = this.readEnv(known.envKey);
        const days = envValue ?? known.defaultDays;

        await this.prisma.retentionPolicy.create({
          data: {
            type: known.type,
            days,
            description: known.description,
            updatedBy: null,
          },
        });
        this.logger.log(`admin-retention: ensureSeed создал ${known.type} = ${days} дней`);
      }
    } catch (err) {
      this.syncedOnce = false;
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'admin-retention: ensureSeed failed (мягкий, list вернёт пусто)',
      );
    }
  }

  private readEnv(key: string): number | undefined {
    const retention = this.cfg.retention;
    switch (key) {
      case 'DEFAULT_RETENTION_DAYS':
        return retention.defaultDays;
      case 'SHARE_VIEW_RETENTION_DAYS':
        return retention.shareViewDays;
      case 'API_ACCESS_LOG_RETENTION_DAYS':
        return retention.apiAccessLogDays;
      case 'WEBHOOK_DELIVERY_RETENTION_DAYS':
        return retention.webhookDeliveryDays;
      case 'SOFT_DELETE_GRACE_DAYS':
        return retention.softDeleteGraceDays;
      default:
        return undefined;
    }
  }
}
