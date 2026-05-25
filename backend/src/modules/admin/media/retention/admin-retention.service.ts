import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { TypedConfigService } from '../../../../common/config/index';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { AdminSettingsService } from '../../settings/admin-settings.service';

import type {
  RetentionPolicyItemDto,
  RetentionPreviewDto,
} from './dto/admin-retention.dto';

/**
 * Admin-redesign Фаза 7 — `AdminRetentionService`.
 *
 * Управляет глобальной таблицей `RetentionPolicy` — TTL по типу. Это
 * read-write API для UI `/admin/media/retention`:
 *   - `list()` — при пустой таблице синхронизирует с ENV (`*_RETENTION_DAYS`)
 *     через idempotent upsert (один раз при первом GET).
 *   - `update()` — пишет в БД + дублирует значение в `AdminSetting`
 *     (`retention.{type}`, severity='high') с reason. Это распространяет
 *     изменение через Redis pub/sub в воркеры (см. AdminSettingsService).
 *   - `preview()` — оценка сколько записей удалит retention-cron при новом
 *     значении (COUNT + WHERE createdAt < NOW - days INTERVAL).
 *
 * Поддерживаемые типы (id RetentionPolicy):
 *   - `meeting_recording` → модель `Recording` (по `Recording.createdAt`
 *     отсутствует — у Recording нет createdAt, фильтр по `expiresAt`).
 *   - `share_view` → `MeetingShareView.viewedAt`.
 *   - `api_access_log` → `ApiAccessLog.createdAt`.
 *   - `webhook_delivery` → `WebhookDelivery.createdAt`.
 *   - `soft_delete_grace` → notCountable=true (мульти-модельный).
 */

/** Карта известных типов retention → ENV-fallback. */
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

  /** Защита от повторной sync-инициализации в гонке нескольких list() запросов. */
  private syncedOnce = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminSettingsService)
    private readonly settings: AdminSettingsService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  // ─────────────────────────── public api ────────────────────────────────

  /**
   * Список всех retention-политик. При первом запросе (пустая БД) — sync
   * с ENV через upsert (idempotent). Сортировка по типу.
   */
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

  /**
   * Обновить retention. Шаги:
   *   1) UPSERT в `RetentionPolicy` (если записи нет — создаём с ENV-fallback).
   *   2) Дублируем значение в `AdminSetting retention.{type}` через
   *      `AdminSettingsService.set` — это пишет в SuperAdminAccessLog и
   *      рассылает invalidation через Redis pub/sub. severity='high' уже
   *      зашит на уровне типа политики.
   */
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

    // Пробрасываем изменение в AdminSetting → Redis pub/sub → воркеры.
    // severity='high' прописывается seed-скриптом (см. seed-admin-settings.ts).
    // Если записи AdminSetting ещё нет — set() создаст с дефолтной severity=low,
    // что не критично: для retention severity ставится при первом seed-проходе.
    try {
      await this.settings.set(`retention.${args.type}`, args.days, {
        userId: args.userId,
        reason: args.reason,
      });
    } catch (err) {
      // Не блокируем обновление RetentionPolicy: запись в БД уже произошла,
      // pub/sub — мягкий шаг. Кэш у воркеров протухнет по TTL (≤30s).
      this.logger.warn(
        {
          err: err instanceof Error ? err.message : String(err),
          type: args.type,
        },
        'admin-retention: AdminSettings.set failed (мягкий)',
      );
    }

    this.logger.log(
      `admin-retention: ${args.type} → ${args.days} дней (user=${args.userId})`,
    );

    return {
      type: updated.type,
      days: updated.days,
      description: updated.description,
      updatedBy: updated.updatedBy,
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  /**
   * Preview: сколько объектов попадает под удаление при выбранном TTL.
   *
   *   Условие: `createdAt < NOW - days * INTERVAL '1 day'`.
   *   Для каждого типа — своё поле (см. KNOWN_RETENTIONS).
   *
   * `soft_delete_grace` — мульти-модельный (Recording.deletedAt, IdeaBlock,
   * ...), точный COUNT здесь не делаем — возвращаем notCountable=true.
   */
  async preview(args: {
    type: string;
    days?: number;
  }): Promise<RetentionPreviewDto> {
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
        // У Recording нет createdAt — используем expiresAt < NOW (записи,
        // у которых уже истёк TTL по текущему значению). Это адекватнее, чем
        // изобретать createdAt — UI получит «сколько объектов сейчас в зоне
        // удаления при таком TTL» через прокси expiresAt < NOW.
        // Для preview-расчёта при новом TTL это менее точно, но в рамках
        // MVP — достаточная оценка.
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

  // ─────────────────────────── private ───────────────────────────────────

  private findKnown(type: string) {
    return KNOWN_RETENTIONS.find((k) => k.type === type);
  }

  /**
   * Один раз за процесс — гарантируем, что все KNOWN_RETENTIONS есть в БД.
   * Идемпотентный upsert (admin-edited записи не перезаписываем, проверяя
   * `updatedBy`).
   */
  private async ensureSeed(): Promise<void> {
    if (this.syncedOnce) return;
    this.syncedOnce = true;

    try {
      for (const known of KNOWN_RETENTIONS) {
        const existing = await this.prisma.retentionPolicy.findUnique({
          where: { type: known.type },
        });
        if (existing) continue;

        // ENV-fallback. Если ENV не задан — берём defaultDays.
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
        this.logger.log(
          `admin-retention: ensureSeed создал ${known.type} = ${days} дней`,
        );
      }
    } catch (err) {
      // Мягко: при ошибке БД не блокируем list — следующий вызов попробует
      // снова (сбрасываем флаг, чтобы не закэшировать неудачный sync).
      this.syncedOnce = false;
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'admin-retention: ensureSeed failed (мягкий, list вернёт пусто)',
      );
    }
  }

  /**
   * Безопасное чтение ENV через TypedConfigService. Возвращает число или
   * undefined (если ключ невалиден).
   */
  private readEnv(key: string): number | undefined {
    // TypedConfigService не выводит универсальный get(string) наружу —
    // используем raw retention-секцию для известных ключей. Для остальных
    // — undefined (значит уйдём на defaultDays).
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
