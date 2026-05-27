import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  type Channel,
  type ChannelBinding,
  type ChannelStatus,
  Prisma,
} from '@prisma/client';

import { TypedConfigService } from '../../../../common/config/index';
import { CryptoService } from '../../../../common/crypto/crypto.service';
import { BusinessMetricsService } from '../../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { RedisService } from '../../../../common/redis/redis.service';
import { TelegramApiClient } from '../../../conversational/adapters/telegram-bot/telegram-api-client';
import { TelegramProxyAdminClient } from '../../../conversational/adapters/telegram-bot/telegram-proxy-admin.client';
import { TELEGRAM_GLOBAL_CHANNEL_UPDATED_TOPIC } from '../../../conversational/topics';

import type {
  BindingRowDto,
  BindingsPageDto,
  BindingStatus,
  ListBindingsQueryDto,
  TelegramBotSettingsResponseDto,
  TelegramProxyPingResponseDto,
  UpdateTemplatesDto,
} from './admin-telegram-bot.dto';

/**
 * Глобальный канал: `Channel WHERE tenantId IS NULL AND kind='telegram_bot'`.
 * (см. ТЗ §3 п.14 и §5; partial unique index гарантирует не более одной такой
 * строки на kind).
 */
const TELEGRAM_GLOBAL_CHANNEL_KIND = 'telegram_bot' as const;

/**
 * Дефолтные шаблоны сообщений бота. Используются как fallback, если
 * `Channel.config.templates.*` не задано админом. Тексты — на русском
 * (правило `feedback_admin_ui_russian_only.md`).
 */
const DEFAULT_TEMPLATES = {
  welcome:
    'Готово! Аккаунт привязан. Теперь сюда будут приходить вопросы и уведомления Коры. Просто напишите текст, голос или пришлите документ.',
  notLinked:
    'Вы не привязаны к компании. Попросите руководителя выслать вам ссылку-приглашение в кабинет.',
  employeeOffboarded:
    'Вы отключены от компании «{{orgName}}». Доступ к её данным закрыт. Если это ошибка — свяжитесь с руководителем.',
  orgFrozen:
    'Ваша компания «{{orgName}}» временно заморожена. Когда работа возобновится, бот снова станет доступен.',
} as const;

/** Считаем привязку «inactive» после стольких дней без входящих. */
const INACTIVE_THRESHOLD_DAYS = 30;

/**
 * Ключ Redis в котором health-cron хранит булев результат пинга
 * прокси. См. `TelegramProxyHealthCron` (Фаза 5).
 */
export const TELEGRAM_PROXY_HEALTHY_REDIS_KEY = 'tg:proxy:healthy';

/**
 * AdminTelegramBotService (β-9 Phase 4).
 *
 * Управляет глобальным каналом Telegram-бота из админки Z. Записывает токен
 * и webhook-секрет в зашифрованном виде через `CryptoService` в
 * `Channel.config`. Никогда не возвращает токен наружу в plain — отдаёт
 * только метаданные (`tokenIsSet`, `tokenLastChars`).
 *
 * Список привязок — только метаданные (см. продуктовый принцип №1 —
 * содержимое переписки сотрудников super-admin'у не видно).
 */
@Injectable()
export class AdminTelegramBotService {
  private readonly logger = new Logger(AdminTelegramBotService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CryptoService) private readonly crypto: CryptoService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(TelegramApiClient) private readonly tgApi: TelegramApiClient,
    @Inject(TelegramProxyAdminClient)
    private readonly proxyAdmin: TelegramProxyAdminClient,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  // ─────────────────────────────── settings ────────────────────────────

  /**
   * Получить текущие настройки глобального канала. Если канала ещё нет —
   * вернём `channelExists=false` с дефолтными шаблонами; админ потом
   * установит токен — и канал создастся.
   */
  async getSettings(): Promise<TelegramBotSettingsResponseDto> {
    const channel = await this.findGlobalChannel();
    this.metrics.incAdminTelegramBotAction({ action: 'settings_read' });

    const proxyHealthy = await this.readProxyHealthy();

    if (!channel) {
      return {
        channelExists: false,
        channelId: null,
        tokenIsSet: false,
        tokenLastChars: null,
        webhookUrl: this.computeWebhookUrl(),
        webhookSecretIsSet: false,
        botUsername: null,
        status: 'disabled',
        brokenReason: null,
        templates: { ...DEFAULT_TEMPLATES },
        proxy: {
          enabled: this.cfg.telegramProxy.enabled,
          apiBase: this.cfg.telegramProxy.apiBase,
          healthy: proxyHealthy,
          botId: null,
          registeredAt: null,
          lastSyncError: null,
        },
        updatedAt: new Date().toISOString(),
      };
    }

    const config = this.readConfig(channel);
    const decryptedToken = config.tokenEnc
      ? this.tryDecrypt(config.tokenEnc)
      : '';
    const tokenLastChars = decryptedToken
      ? this.maskToken(decryptedToken)
      : null;

    const raw = (channel.config as Record<string, unknown> | null) ?? {};
    const proxyBotId =
      typeof raw['proxyBotId'] === 'string' ? (raw['proxyBotId'] as string) : null;
    const proxyRegisteredAt =
      typeof raw['proxyRegisteredAt'] === 'string'
        ? (raw['proxyRegisteredAt'] as string)
        : null;
    const proxyLastSyncError =
      typeof raw['proxyLastSyncError'] === 'string' && raw['proxyLastSyncError']
        ? (raw['proxyLastSyncError'] as string)
        : null;

    return {
      channelExists: true,
      channelId: channel.id,
      tokenIsSet: decryptedToken.length > 0,
      tokenLastChars,
      webhookUrl: this.computeWebhookUrl(),
      webhookSecretIsSet: !!config.webhookSecretEnc,
      botUsername: config.botUsername ?? null,
      status: channel.status,
      brokenReason: channel.brokenReason,
      templates: this.mergeTemplates(config.templates),
      proxy: {
        enabled: this.cfg.telegramProxy.enabled,
        apiBase: this.cfg.telegramProxy.apiBase,
        healthy: proxyHealthy,
        botId: proxyBotId,
        registeredAt: proxyRegisteredAt,
        lastSyncError: proxyLastSyncError,
      },
      updatedAt: channel.updatedAt.toISOString(),
    };
  }

  // ─────────────────────────────── ping ────────────────────────────────

  /**
   * Синхронный пинг прокси из админки («Проверить прокси сейчас»). Не
   * пишет в Channel.config — это диагностика. Сам результат не
   * кэширует; health-cron хранит долгосрочный статус отдельно.
   */
  async pingProxy(): Promise<TelegramProxyPingResponseDto> {
    if (!this.cfg.telegramProxy.enabled) {
      return {
        ok: false,
        status: 0,
        durationMs: 0,
        error: 'TELEGRAM_PROXY_ENABLED=false — прокси выключен',
      };
    }
    const r = await this.proxyAdmin.ping();
    return {
      ok: r.ok,
      status: r.status,
      durationMs: r.durationMs,
      error: r.error ?? null,
    };
  }

  // ─────────────────────────────── token ───────────────────────────────

  async updateToken(args: { token: string }): Promise<TelegramBotSettingsResponseDto> {
    const trimmed = args.token.trim();
    // Дополнительно валидируем доступность токена через getMe — это и
    // удобство админу, и защита от опечатки. Если Telegram отверг — даём
    // понятное сообщение и не пишем токен.
    try {
      await this.tgApi.getMe({ token: trimmed });
    } catch (err) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'telegram_token_invalid',
          message: `Telegram отверг токен: ${err instanceof Error ? err.message : 'неизвестная ошибка'}`,
        },
      });
    }

    const tokenEnc = this.crypto.encrypt(trimmed);
    const botUsername = await this.fetchBotUsernameSafe(trimmed);

    // Auto-register в прокси (2026-05-26): убирает необходимость двойного
    // клика «Установить токен → Перенастроить webhook» и patch-скрипта на
    // bootstrap. Best-effort: если прокси не отвечает — токен всё равно
    // сохраняется, ошибка пишется в `proxyLastSyncError`. Юзер увидит её
    // в админке и сможет нажать «Перенастроить webhook» вручную позже.
    let proxyPatch: Record<string, unknown> = {};
    let webhookSecretToPersist: string | undefined;
    let autoRegisterOutcome: 'skipped' | 'ok' | 'failed' = 'skipped';

    if (this.cfg.telegramProxy.enabled) {
      const reg = await this.autoRegisterInProxy({ token: trimmed });
      autoRegisterOutcome = reg.outcome;
      proxyPatch = reg.patch;
      webhookSecretToPersist = reg.webhookSecretToPersist;
    }

    const channel = await this.upsertGlobalChannel((existingConfig) => ({
      ...existingConfig,
      botToken: tokenEnc,
      ...(botUsername ? { botUsername } : {}),
      ...(webhookSecretToPersist ? { webhookSecret: webhookSecretToPersist } : {}),
      ...proxyPatch,
    }));

    this.logger.log(
      `admin: глобальный Telegram-токен обновлён channelId=${channel.id} botUsername=${botUsername ?? 'unknown'} autoRegister=${autoRegisterOutcome}`,
    );
    this.metrics.incAdminTelegramBotAction({ action: 'token_changed' });
    if (autoRegisterOutcome === 'ok') {
      this.metrics.incAdminTelegramBotAction({ action: 'webhook_reset' });
    }
    await this.publishChannelUpdated({ channelId: channel.id, reason: 'token_changed' });
    return this.getSettings();
  }

  /**
   * Auto-register бота в прокси при `updateToken`. Best-effort:
   * исключение НЕ бросает, а возвращает patch для записи в `Channel.config`
   * (включая `proxyLastSyncError` при провале).
   *
   * Контракт:
   *   - Существующий `webhookSecret` переиспользуется (не ротируется), чтобы
   *     не обнулять активные подписки Telegram без явного действия юзера
   *     («Перенастроить webhook»).
   *   - Если webhookSecret в `Channel.config` ещё не задан — генерируем
   *     новый, кладём в `webhookSecretToPersist` (шифрованный) для записи.
   *   - На успех `upsertBot` — пишем `proxyBotId`, `proxyRegisteredAt`,
   *     `proxyLastSyncError=null`, `webhookUrl=<computed>`.
   *   - На fail — только `proxyLastSyncError=<message>`. Токен всё равно
   *     сохранится в основном upsert.
   */
  private async autoRegisterInProxy(args: {
    token: string;
  }): Promise<{
    outcome: 'ok' | 'failed';
    patch: Record<string, unknown>;
    webhookSecretToPersist?: string;
  }> {
    // Существующий secret вытаскиваем из current Channel (если есть).
    const existing = await this.findGlobalChannel();
    const existingSecretEnc = existing
      ? this.readConfig(existing).webhookSecretEnc
      : '';
    let secret = '';
    if (existingSecretEnc) {
      secret = this.tryDecrypt(existingSecretEnc);
    }
    let webhookSecretToPersist: string | undefined;
    if (!secret) {
      secret = this.generateWebhookSecret();
      webhookSecretToPersist = this.crypto.encrypt(secret);
    }

    const targetUrl = this.computeWebhookUrl();
    try {
      const info = await this.proxyAdmin.upsertBot({
        token: args.token,
        secretToken: secret,
        targetUrl,
      });
      return {
        outcome: 'ok',
        webhookSecretToPersist,
        patch: {
          proxyBotId: info.id,
          proxyRegisteredAt: new Date().toISOString(),
          proxyLastSyncError: null,
          webhookUrl: targetUrl,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        { err: message },
        'admin updateToken: авто-регистрация в прокси не удалась; токен сохранён, юзеру нужно повторить через «Перенастроить webhook»',
      );
      return {
        outcome: 'failed',
        webhookSecretToPersist,
        patch: {
          proxyLastSyncError: message,
        },
      };
    }
  }

  // ─────────────────────────────── webhook ────────────────────────────

  /**
   * Перенастроить webhook: генерим новый secret, регистрируем (или
   * обновляем) бота в прокси `telegram.crossmark.ru`. После успеха
   * прокси сам вызывает `setWebhook` у Telegram, указывая свой
   * `/webhook/<secret>` как URL. Без токена — 400.
   *
   * Legacy-режим (`TELEGRAM_PROXY_ENABLED=false`, для dev и аварийного
   * rollback) — старое поведение: дёргаем `setWebhook` напрямую через
   * `TelegramApiClient`.
   *
   * См. ТЗ plans/tz/2026-05-26-telegram-via-crossmark-proxy.md §3 п.9 и §7.
   */
  async resetWebhook(args?: {
    webhookUrl?: string;
  }): Promise<TelegramBotSettingsResponseDto> {
    const channel = await this.findGlobalChannel();
    if (!channel) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'channel_not_configured',
          message: 'Глобальный канал ещё не создан. Сначала установите токен.',
        },
      });
    }
    const config = this.readConfig(channel);
    const token = config.tokenEnc ? this.tryDecrypt(config.tokenEnc) : '';
    if (!token) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'token_not_set',
          message:
            'Токен бота не установлен. Сначала задайте токен — потом перенастройте webhook.',
        },
      });
    }

    const newSecret = this.generateWebhookSecret();
    const webhookUrl = (args?.webhookUrl ?? this.computeWebhookUrl()).trim();
    if (!/^https:\/\//i.test(webhookUrl)) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'webhook_url_invalid',
          message: 'Webhook URL должен начинаться с https://',
        },
      });
    }

    const useProxy = this.cfg.telegramProxy.enabled;
    let proxyBotId: string | undefined;
    let proxyRegisteredAt: string | undefined;
    let proxyLastSyncError: string | null = null;

    if (useProxy) {
      try {
        const info = await this.proxyAdmin.upsertBot({
          token,
          secretToken: newSecret,
          targetUrl: webhookUrl,
        });
        proxyBotId = info.id;
        proxyRegisteredAt = new Date().toISOString();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'неизвестная ошибка';
        proxyLastSyncError = message;
        throw new BadRequestException({
          ok: false,
          error: {
            code: 'telegram_proxy_upsert_failed',
            message: `Прокси отверг регистрацию бота: ${message}`,
          },
        });
      }
    } else {
      // Legacy direct mode: дёргаем setWebhook у Telegram сами.
      try {
        await this.tgApi.setWebhook({
          token,
          url: webhookUrl,
          secretToken: newSecret,
        });
      } catch (err) {
        throw new BadRequestException({
          ok: false,
          error: {
            code: 'telegram_set_webhook_failed',
            message: `Telegram отверг setWebhook: ${err instanceof Error ? err.message : 'неизвестная ошибка'}`,
          },
        });
      }
    }

    const newSecretEnc = this.crypto.encrypt(newSecret);
    const updated = await this.upsertGlobalChannel((existingConfig) => ({
      ...existingConfig,
      webhookSecret: newSecretEnc,
      webhookUrl,
      ...(proxyBotId ? { proxyBotId } : {}),
      ...(proxyRegisteredAt ? { proxyRegisteredAt } : {}),
      proxyLastSyncError,
    }));

    this.logger.log(
      `admin: webhook глобального Telegram-бота перенастроен на ${webhookUrl} (proxy=${useProxy ? 'on' : 'off'}${proxyBotId ? `, botId=${proxyBotId}` : ''})`,
    );
    this.metrics.incAdminTelegramBotAction({ action: 'webhook_reset' });
    await this.publishChannelUpdated({ channelId: updated.id, reason: 'webhook_reset' });
    return this.getSettings();
  }

  // ─────────────────────────────── templates ──────────────────────────

  async updateTemplates(
    dto: UpdateTemplatesDto,
  ): Promise<TelegramBotSettingsResponseDto> {
    const channel = await this.upsertGlobalChannel((existingConfig) => {
      const current =
        (existingConfig['templates'] as Record<string, string> | undefined) ??
        {};
      const merged: Record<string, string> = { ...current };
      if (dto.welcome !== undefined) merged['welcome'] = dto.welcome;
      if (dto.notLinked !== undefined) merged['notLinked'] = dto.notLinked;
      if (dto.employeeOffboarded !== undefined) {
        merged['employeeOffboarded'] = dto.employeeOffboarded;
      }
      if (dto.orgFrozen !== undefined) merged['orgFrozen'] = dto.orgFrozen;
      return { ...existingConfig, templates: merged };
    });

    this.logger.log(
      `admin: шаблоны глобального Telegram-бота обновлены channelId=${channel.id}`,
    );
    this.metrics.incAdminTelegramBotAction({ action: 'templates_updated' });
    await this.publishChannelUpdated({ channelId: channel.id, reason: 'templates_updated' });
    return this.getSettings();
  }

  // ─────────────────────────────── status ─────────────────────────────

  async setStatus(args: {
    status: 'active' | 'global_disabled';
  }): Promise<TelegramBotSettingsResponseDto> {
    const channel = await this.findGlobalChannel();
    if (!channel) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'channel_not_configured',
          message: 'Глобальный канал ещё не создан. Сначала установите токен.',
        },
      });
    }
    const nextStatus: ChannelStatus = args.status;
    await this.prisma.channel.update({
      where: { id: channel.id },
      data: { status: nextStatus },
    });
    this.logger.log(
      `admin: статус глобального Telegram-бота → ${nextStatus} (channelId=${channel.id})`,
    );
    this.metrics.incAdminTelegramBotAction({ action: 'status_toggled' });
    await this.publishChannelUpdated({ channelId: channel.id, reason: 'status_toggled' });
    return this.getSettings();
  }

  // ─────────────────────────────── bindings ───────────────────────────

  async listBindings(query: ListBindingsQueryDto): Promise<BindingsPageDto> {
    this.metrics.incAdminTelegramBotAction({ action: 'bindings_read' });

    const channel = await this.findGlobalChannel();
    if (!channel) {
      return {
        items: [],
        total: 0,
        page: query.page,
        pageSize: query.pageSize,
      };
    }

    const where: Prisma.ChannelBindingWhereInput = { channelId: channel.id };
    if (query.orgId) {
      where.user = { memberships: { some: { orgId: query.orgId } } };
    }
    if (query.status === 'bot_blocked') {
      where.preferences = {
        path: ['botBlocked'],
        equals: true,
      } as unknown as Prisma.JsonFilter;
    } else if (query.status === 'pending') {
      where.verifiedAt = null;
    } else if (query.status === 'linked') {
      where.verifiedAt = { not: null };
    }

    const [total, raws] = await this.prisma.$transaction([
      this.prisma.channelBinding.count({ where }),
      this.prisma.channelBinding.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
              memberships: {
                select: {
                  orgId: true,
                  org: { select: { name: true } },
                },
                orderBy: { joinedAt: 'asc' },
                take: 1,
              },
            },
          },
        },
        orderBy: { verifiedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    // Получаем счётчики deliveries (outbound) и notifications (inbound аналог
    // нам недоступен без сообщений; берём `verifiedAt` как момент привязки
    // и Notifications.responseStatus как маркер активности. Inbound «количество
    // сообщений» считаем через ChannelInboundLog если он есть, иначе как 0
    // — счётчики на проде накапливаются метриками Prometheus). Чтобы не
    // зависеть от ChannelInboundLog (его в схеме нет), считаем outbound через
    // `notificationDelivery.count` и inbound — через `notification.count` по
    // recipientUserId. Это даёт грубую оценку без раскрытия содержимого.
    const items: BindingRowDto[] = await Promise.all(
      raws.map(async (b) => {
        const [outboundCount, inboundCountAnswered, lastInbound] =
          await Promise.all([
            this.prisma.notificationDelivery.count({
              where: { channelBindingId: b.id },
            }),
            this.prisma.notification.count({
              where: {
                recipientUserId: b.userId,
                responseStatus: 'answered',
              },
            }),
            this.prisma.notification.findFirst({
              where: {
                recipientUserId: b.userId,
                respondedAt: { not: null },
              },
              orderBy: { respondedAt: 'desc' },
              select: { respondedAt: true },
            }),
          ]);

        const status = this.computeBindingStatus({
          binding: b,
          lastInboundAt: lastInbound?.respondedAt ?? null,
        });

        const firstMembership = b.user?.memberships?.[0];
        return {
          id: b.id,
          orgId: firstMembership?.orgId ?? null,
          orgName: firstMembership?.org?.name ?? null,
          userId: b.userId,
          userEmail: b.user?.email ?? null,
          userName: b.user?.name ?? null,
          status,
          linkedAt: b.verifiedAt ? b.verifiedAt.toISOString() : null,
          lastInboundAt: lastInbound?.respondedAt
            ? lastInbound.respondedAt.toISOString()
            : null,
          inboundCount: inboundCountAnswered,
          outboundCount,
        };
      }),
    );

    // Дополнительный server-side фильтр по computed status, если query.status
    // — это `no_membership` или `inactive` (для них нет прямого SQL where).
    const filtered =
      query.status === 'no_membership' || query.status === 'inactive'
        ? items.filter((it) => it.status === query.status)
        : items;

    return {
      items: filtered,
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  // ─────────────────────────────── helpers ────────────────────────────

  /**
   * Публикует в Redis pub/sub `TELEGRAM_GLOBAL_CHANNEL_UPDATED_TOPIC`
   * для инвалидации in-process кэша глобального канала во всех
   * нодах/воркерах. ТЗ 2026-05-26 §2 — без этого после ротации
   * `webhookSecret` входящие webhook'и продолжат проверяться против
   * старого секрета до рестарта.
   *
   * Best-effort: если publish упал — пишем warn и продолжаем (config
   * уже сохранён в БД, после ближайшего рестарта подхватится).
   */
  private async publishChannelUpdated(args: {
    channelId: string;
    reason: string;
  }): Promise<void> {
    try {
      await this.redis.client.publish(
        TELEGRAM_GLOBAL_CHANNEL_UPDATED_TOPIC,
        JSON.stringify({ channelId: args.channelId, reason: args.reason }),
      );
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err), reason: args.reason },
        'admin telegram bot: publish channel:updated failed — subscribers получат стейл-кэш до рестарта',
      );
    }
  }

  private async findGlobalChannel(): Promise<Channel | null> {
    return this.prisma.channel.findFirst({
      where: { tenantId: null, kind: TELEGRAM_GLOBAL_CHANNEL_KIND },
    });
  }

  /**
   * Читает свежесть прокси из Redis (записывает `TelegramProxyHealthCron`).
   * `null` — cron ещё не отрабатывал; UI рисует серым «нет данных».
   */
  private async readProxyHealthy(): Promise<boolean | null> {
    try {
      const v = await this.redis.client.get(TELEGRAM_PROXY_HEALTHY_REDIS_KEY);
      if (v === '1' || v === 'true') return true;
      if (v === '0' || v === 'false') return false;
      return null;
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'admin telegram bot: не удалось прочитать прокси-health из Redis',
      );
      return null;
    }
  }

  /**
   * Создать или обновить глобальный канал. Принимает функцию-mutator,
   * которая получает текущий config (или `{}` если канала нет) и возвращает
   * новый config. Намеренно делаем upsert вручную через find + create/update,
   * потому что у нас составной partial-unique-index, а не объявленный
   * `@@unique` для NULL.
   */
  private async upsertGlobalChannel(
    mutateConfig: (cur: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<Channel> {
    const existing = await this.findGlobalChannel();
    if (existing) {
      const curConfig =
        (existing.config as Record<string, unknown> | null) ?? {};
      const nextConfig = mutateConfig(curConfig);
      return this.prisma.channel.update({
        where: { id: existing.id },
        data: { config: nextConfig as Prisma.InputJsonValue },
      });
    }
    const nextConfig = mutateConfig({});
    return this.prisma.channel.create({
      data: {
        tenantId: null,
        kind: TELEGRAM_GLOBAL_CHANNEL_KIND,
        direction: 'bidirectional',
        maxDataClass: 'internal',
        status: 'active',
        config: nextConfig as Prisma.InputJsonValue,
      },
    });
  }

  private readConfig(channel: Channel): {
    tokenEnc: string;
    webhookSecretEnc: string;
    botUsername?: string;
    templates: Record<string, string>;
  } {
    const raw =
      (channel.config as Record<string, unknown> | null) ?? {};
    const templatesRaw = raw['templates'];
    const templates: Record<string, string> =
      templatesRaw && typeof templatesRaw === 'object' && !Array.isArray(templatesRaw)
        ? (templatesRaw as Record<string, string>)
        : {};
    const botUsernameVal = raw['botUsername'];
    return {
      tokenEnc: String(raw['botToken'] ?? ''),
      webhookSecretEnc: String(raw['webhookSecret'] ?? ''),
      ...(typeof botUsernameVal === 'string' && botUsernameVal
        ? { botUsername: botUsernameVal }
        : {}),
      templates,
    };
  }

  private tryDecrypt(value: string): string {
    if (!value) return '';
    if (!this.crypto.isEncrypted(value)) {
      // На случай legacy plain-токенов до миграции — возвращаем как есть.
      return value;
    }
    try {
      return this.crypto.decrypt(value);
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'admin telegram bot: не удалось расшифровать токен/секрет — считаем пустым',
      );
      return '';
    }
  }

  private maskToken(token: string): string {
    if (token.length <= 4) return `****${token}`;
    return `****${token.slice(-4)}`;
  }

  private mergeTemplates(
    stored: Record<string, string>,
  ): TelegramBotSettingsResponseDto['templates'] {
    return {
      welcome: stored['welcome'] ?? DEFAULT_TEMPLATES.welcome,
      notLinked: stored['notLinked'] ?? DEFAULT_TEMPLATES.notLinked,
      employeeOffboarded:
        stored['employeeOffboarded'] ?? DEFAULT_TEMPLATES.employeeOffboarded,
      orgFrozen: stored['orgFrozen'] ?? DEFAULT_TEMPLATES.orgFrozen,
    };
  }

  private computeWebhookUrl(): string {
    const base = this.cfg.publicHostUrl.replace(/\/+$/, '');
    return `${base}/api/v1/webhooks/telegram-bot`;
  }

  private generateWebhookSecret(): string {
    // Telegram требует 1..256 символов из [A-Za-z0-9_-]. 32 hex символа — 128 бит энтропии.
    const bytes = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
      crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
    }
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  private async fetchBotUsernameSafe(token: string): Promise<string | null> {
    try {
      const me = await this.tgApi.getMe({ token });
      return me.username ?? null;
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'admin telegram bot: getMe failed после set-token (best-effort, продолжаю)',
      );
      return null;
    }
  }

  private computeBindingStatus(args: {
    binding: ChannelBinding & {
      user?: { memberships?: Array<{ orgId: string }> } | null;
    };
    lastInboundAt: Date | null;
  }): BindingStatus {
    const { binding, lastInboundAt } = args;
    const memberships = binding.user?.memberships ?? [];
    if (memberships.length === 0) return 'no_membership';
    if (!binding.verifiedAt) return 'pending';
    const prefs = binding.preferences as Record<string, unknown> | null;
    if (prefs && prefs['botBlocked'] === true) return 'bot_blocked';
    if (lastInboundAt) {
      const ageDays =
        (Date.now() - lastInboundAt.getTime()) / (24 * 3_600_000);
      if (ageDays > INACTIVE_THRESHOLD_DAYS) return 'inactive';
    } else if (binding.verifiedAt) {
      const ageDays =
        (Date.now() - binding.verifiedAt.getTime()) / (24 * 3_600_000);
      if (ageDays > INACTIVE_THRESHOLD_DAYS) return 'inactive';
    }
    return 'linked';
  }
}
