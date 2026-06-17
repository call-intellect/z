import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/typed-config.service';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { ConversationalService } from '../../conversational/conversational.service';
import { ChannelBindingPreferencesSchema } from '../../conversational/types/preferences.schema';
import { tenantTopOf } from '../../dialog-layer/utils/tenant-top';
import {
  getLocalDate,
  getLocalHour,
  isWithinQuietHours,
} from '../../operations/utils/local-date';
import type { PendingActionSource } from '../services/pending-actions.service';
import { PendingActionsService } from '../services/pending-actions.service';

/**
 * Action Center B3 (2026-06-02) — PendingActionsReminderCron.
 *
 * Источник: plans/tz Action Center, Фаза B3 — повторяющиеся Telegram-
 * напоминания о pending-подтверждениях.
 *
 * Образец — `conversational/adapters/telegram-bot/telegram-digest.cron.ts`:
 * hourly tick + per-user TZ + Redis dedup `SET NX EX` + per-user try/catch +
 * глобальный канал (`Channel.tenantId IS NULL` → membership).
 *
 * Алгоритм (см. константы ниже):
 *   1. Берём verified telegram-binding'и (kind=telegram_bot, verifiedAt не null,
 *      channel.status=active).
 *   2. Резолвим tenantId (`channel.tenantId ?? membership`) и `Person.timezone`.
 *   3. Гейт по слот-часам: локальный час пользователя ∈ {9,12,15,18,21}.
 *      Иначе — тихий skip (без метрики).
 *   4. Уважаем quiet hours / pause: читаем `ChannelBinding.preferences`
 *      (`ChannelBindingPreferencesSchema`). Если `disabledUntil` в будущем или
 *      локальное время в `quietHours` — skip.
 *   5. Redis dedup per слот: `pending_reminder:${userId}:${tenantId}:${localDate}:${slotHour}`
 *      (TTL ~4ч), `SET NX EX`.
 *   6. `getCount`; если total===0 → skip (никаких пустых напоминаний). Иначе
 *      `getList(limit=5)` для строк сводки + расчёт urgentCount.
 *   7. Отправка детерминированным шаблоном (БЕЗ LLM) через
 *      `sendNotification(eventType='system.message', preferredChannelKinds=['telegram_bot'])`.
 *
 * Эскалация (упрощённо): owner/admin уже видят все pending (привилегированные
 * провайдеры B0) → получают напоминание как обычные telegram-пользователи. В
 * сводке выделяем `urgentCount` (severity==='urgent' среди показанных). Явного
 * «добавить owner к чужому item» не делаем — owner и так покрыт count/list.
 *
 * Telegram-доставка: шлём как `system.message` с title/body (markdown) — этот
 * eventType уже умеет рендерить Telegram-адаптер (как telegram-digest.cron).
 * Отдельный eventType `actions.reminder` зарегистрирован в registry/policy для
 * единообразия и валидации, но для рендера используем проверенный путь.
 */
@Injectable()
export class PendingActionsReminderCron {
  private readonly logger = new Logger(PendingActionsReminderCron.name);

  /** Максимум пользователей в одной обработке (защита от runaway). */
  static readonly MAX_USERS_PER_RUN = 5_000;

  /** Сколько items максимум показываем в сводке. */
  static readonly LIST_LIMIT = 5;

  /** Redis key prefix + TTL для idempotency (per слот). */
  static readonly DEDUP_KEY_PREFIX = 'pending_reminder';
  /** ~4 часа — чуть больше шага (3ч), покрывает TZ-shift в пределах слота. */
  static readonly DEDUP_TTL_SEC = 4 * 3600;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
    @Inject(PendingActionsService)
    private readonly pendingActions: PendingActionsService,
    @Inject(TypedConfigService)
    private readonly cfg: TypedConfigService,
  ) {}

  @Cron('0 * * * *')
  async reminderTick(): Promise<void> {
    try {
      const stats = await this.run();
      this.logger.log(stats, 'pending-actions-reminder: цикл завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'pending-actions-reminder: непойманная ошибка',
      );
    }
  }

  /**
   * Публичный метод для тестов / ручного триггера. `now` — для unit-тестов.
   */
  async run(now: Date = new Date()): Promise<{
    candidates: number;
    sent: number;
    empty: number;
    deduped: number;
    errors: number;
    skippedSlot: number;
    skippedQuiet: number;
  }> {
    const bindings = await this.prisma.channelBinding.findMany({
      where: {
        verifiedAt: { not: null },
        channel: { kind: 'telegram_bot', status: 'active' },
      },
      include: { channel: true },
      take: PendingActionsReminderCron.MAX_USERS_PER_RUN,
    });
    if (bindings.length === 0) {
      return {
        candidates: 0,
        sent: 0,
        empty: 0,
        deduped: 0,
        errors: 0,
        skippedSlot: 0,
        skippedQuiet: 0,
      };
    }

    // Batch-резолв Person.timezone (по ключу userId:tenantId).
    const personRows = await this.prisma.person.findMany({
      where: {
        deletedAt: null,
        userId: { in: bindings.map((b) => b.userId) },
      },
      select: { userId: true, tenantId: true, timezone: true },
    });
    const timezoneByKey = new Map<string, string | null>();
    for (const p of personRows) {
      if (!p.userId) continue;
      timezoneByKey.set(`${p.userId}:${p.tenantId}`, p.timezone);
    }

    // Глобальный канал (Channel.tenantId IS NULL) → tenantId через membership
    // (один user = одна Org). Batch-резолв заранее.
    const userIdsWithoutTenant = bindings
      .filter((b) => b.channel.tenantId === null)
      .map((b) => b.userId);
    const membershipByUser = new Map<string, string>();
    if (userIdsWithoutTenant.length > 0) {
      const memberships = await this.prisma.membership.findMany({
        where: { userId: { in: userIdsWithoutTenant } },
        orderBy: { joinedAt: 'asc' },
        select: { userId: true, orgId: true },
      });
      for (const m of memberships) {
        if (!membershipByUser.has(m.userId)) {
          membershipByUser.set(m.userId, m.orgId);
        }
      }
    }

    // Слот-часы вычисляются динамически из admin-editable крутилок
    // (cfg.pendingActions). Дефолты 9/21/3 → [9,12,15,18,21].
    const slotHours = buildSlotHours(
      this.cfg.pendingActions.reminderWindowStartHour,
      this.cfg.pendingActions.reminderWindowEndHour,
      this.cfg.pendingActions.reminderStepHours,
    );

    let sent = 0;
    let empty = 0;
    let deduped = 0;
    let errors = 0;
    let skippedSlot = 0;
    let skippedQuiet = 0;

    for (const binding of bindings) {
      const userId = binding.userId;
      const tenantId =
        binding.channel.tenantId ?? membershipByUser.get(userId) ?? null;
      if (!tenantId) {
        skippedSlot++; // нет Org-контекста — тихий skip
        continue;
      }
      const tenantTop = tenantTopOf(tenantId);
      const tz = timezoneByKey.get(`${userId}:${tenantId}`) ?? null;
      const localHour = getLocalHour(now, tz);

      // Гейт по слот-часам — вне слота тихий skip без метрики и без Redis.
      if (!slotHours.includes(localHour)) {
        skippedSlot++;
        continue;
      }

      // Уважение тихих часов / паузы (preferences binding'а).
      const prefs = this.readPreferences(binding.preferences);
      if (prefs.disabledUntil) {
        const until = new Date(prefs.disabledUntil);
        if (Number.isFinite(until.getTime()) && until > now) {
          skippedQuiet++;
          continue;
        }
      }
      if (isWithinQuietHours(now, tz, prefs.quietHours)) {
        skippedQuiet++;
        continue;
      }

      const localDate = getLocalDate(now, tz);
      const dedupKey = `${PendingActionsReminderCron.DEDUP_KEY_PREFIX}:${userId}:${tenantId}:${localDate}:${localHour}`;

      try {
        const setResult = await this.redis.client.set(
          dedupKey,
          '1',
          'EX',
          PendingActionsReminderCron.DEDUP_TTL_SEC,
          'NX',
        );
        if (setResult !== 'OK') {
          deduped++;
          this.metrics.incPendingReminderSent({ tenantTop, result: 'dedup' });
          continue;
        }

        const count = await this.pendingActions.getCount({ tenantId, userId });
        if (count.total === 0) {
          empty++;
          this.metrics.incPendingReminderSent({ tenantTop, result: 'empty' });
          continue;
        }

        const list = await this.pendingActions.getList({
          tenantId,
          userId,
          limit: PendingActionsReminderCron.LIST_LIMIT,
        });
        const urgentCount = list.items.filter(
          (i) => i.severity === 'urgent',
        ).length;
        const lines = list.items.map(
          (i) => `${i.severity === 'urgent' ? '🔴 ' : '• '}${i.title}`,
        );
        const actionUrl = '/actions';

        const body = buildReminderBody({
          total: count.total,
          bySource: count.bySource,
          urgentCount,
          lines,
          actionUrl,
        });

        await this.conversational.sendNotification({
          tenantId,
          recipientUserId: userId,
          eventType: 'system.message',
          payload: {
            title: '🔔 Ждёт вашего подтверждения',
            body,
          },
          dataClass: 'internal',
          preferredChannelKinds: ['telegram_bot'],
          critical: false,
        });
        this.metrics.incPendingReminderSent({ tenantTop, result: 'sent' });
        sent++;
      } catch (err) {
        errors++;
        this.metrics.incPendingReminderSent({ tenantTop, result: 'error' });
        this.logger.warn(
          {
            tenantId,
            userId,
            err: err instanceof Error ? err.message : String(err),
          },
          'pending-actions-reminder: пользователь — error, продолжаем',
        );
      }
    }

    return {
      candidates: bindings.length,
      sent,
      empty,
      deduped,
      errors,
      skippedSlot,
      skippedQuiet,
    };
  }

  /** Безопасное чтение preferences-blob binding'а (fallback — {}). */
  private readPreferences(raw: unknown): {
    quietHours?: string;
    disabledUntil?: string;
  } {
    if (!raw || typeof raw !== 'object') return {};
    const parsed = ChannelBindingPreferencesSchema.safeParse(raw);
    if (!parsed.success) {
      this.logger.warn(
        'pending-actions-reminder: невалидный preferences-blob — используем дефолт',
      );
      return {};
    }
    return parsed.data;
  }
}

// ─────────────────────────── private helpers ────────────────────────────

/** Слоты-часы из окна [start..end] с шагом step (включая end). */
function buildSlotHours(start: number, end: number, step: number): number[] {
  const out: number[] = [];
  for (let h = start; h <= end; h += step) out.push(h);
  return out;
}

const SOURCE_LABEL: Record<PendingActionSource, string> = {
  curation: 'Решения/карточки',
  conflict: 'Конфликты',
  intake: 'Задачи',
  probe: 'Вопросы',
  task_closure: 'Задачи к закрытию',
  task_review: 'Задачи под вопросом',
};

/**
 * Детерминированный шаблон тела напоминания (БЕЗ LLM). Markdown, безопасно
 * рендерится Telegram-адаптером как system.message.
 */
function buildReminderBody(args: {
  total: number;
  bySource: Record<PendingActionSource, number>;
  urgentCount: number;
  lines: string[];
  actionUrl: string;
}): string {
  const breakdown = (
    [
      'curation',
      'conflict',
      'intake',
      'probe',
      'task_closure',
      'task_review',
    ] as PendingActionSource[]
  )
    .map((s) => `${SOURCE_LABEL[s]} — ${args.bySource[s]}`)
    .join(', ');

  const headline =
    args.urgentCount > 0
      ? `Ждёт вашего подтверждения: ${args.total} (срочных — ${args.urgentCount}).`
      : `Ждёт вашего подтверждения: ${args.total}.`;

  const parts: string[] = [headline, breakdown];
  if (args.lines.length > 0) {
    parts.push('', ...args.lines);
  }
  parts.push('', `Открыть: ${args.actionUrl}`);
  return parts.join('\n');
}
