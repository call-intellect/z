import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import webpush from 'web-push';

import { TypedConfigService } from '../../../common/config/typed-config.service';

import { PushSubscriptionsService } from './push-subscriptions.service';

/**
 * WebPushSender — обёртка над npm `web-push`. Отвечает за фактическую отправку
 * push-уведомлений конкретному user'у по всем его активным подпискам.
 *
 * No-VAPID graceful path:
 *   - Если `cfg.push.isSendEnabled === false` (нет хотя бы одного VAPID-ключа)
 *     → метод `sendToUser` сразу возвращает `{ delivered: 0, failed: 0 }` +
 *     одноразовый warn в лог. Это позволяет собирать подписки заранее, до
 *     настройки VAPID на проде.
 *
 * Failure handling (см. RFC 8030 §7.3):
 *   - 410 Gone / 404 Not Found → подписка протухла, инкрементим failureCount
 *     через `markFailure`. По достижении `cfg.push.maxFailures` запись удаляется.
 *   - Любая другая ошибка (5xx, network) — логируется, failureCount не трогаем
 *     (push-сервис может временно лежать; не выбрасываем рабочие подписки).
 */
@Injectable()
export class WebPushSender implements OnModuleInit {
  private readonly logger = new Logger(WebPushSender.name);
  private vapidSetUp = false;
  private warnedNoVapid = false;

  constructor(
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(PushSubscriptionsService)
    private readonly subs: PushSubscriptionsService,
  ) {}

  onModuleInit(): void {
    if (this.cfg.push.isSendEnabled) {
      // VAPID ключи присутствуют — настраиваем web-push.
      const pub = this.cfg.push.vapidPublicKey;
      const priv = this.cfg.push.vapidPrivateKey;
      if (pub && priv) {
        webpush.setVapidDetails(this.cfg.push.vapidSubject, pub, priv);
        this.vapidSetUp = true;
        this.logger.log(
          `WebPushSender готов к отправке (VAPID subject=${this.cfg.push.vapidSubject})`,
        );
      }
    } else {
      this.logger.warn(
        'WebPushSender: VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY не заданы — отправка push отключена (persistence работает).',
      );
    }
  }

  /**
   * Отправка push-уведомления на все активные подписки user'а.
   * Возвращает агрегат `{ delivered, failed }` — для логов / метрик worker'а.
   *
   * Параметр `url` пакуется в `data.url` payload'а — ServiceWorker откроет
   * вкладку с этим URL при клике на уведомление.
   */
  async sendToUser(args: {
    tenantId: string;
    userId: string;
    title: string;
    body: string;
    icon?: string;
    url?: string;
    extraData?: Record<string, unknown>;
  }): Promise<{ delivered: number; failed: number }> {
    if (!this.vapidSetUp) {
      if (!this.warnedNoVapid) {
        this.logger.warn(
          'sendToUser: VAPID не настроен — пропускаем отправку (warn один раз).',
        );
        this.warnedNoVapid = true;
      }
      return { delivered: 0, failed: 0 };
    }

    const list = await this.subs.listForUser({
      tenantId: args.tenantId,
      userId: args.userId,
    });
    if (list.length === 0) {
      return { delivered: 0, failed: 0 };
    }

    const payload = JSON.stringify({
      title: args.title,
      body: args.body,
      icon: args.icon ?? null,
      data: {
        ...(args.extraData ?? {}),
        ...(args.url ? { url: args.url } : {}),
      },
    });

    let delivered = 0;
    let failed = 0;

    for (const sub of list) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payload,
        );
        delivered++;
        await this.subs.markSuccess({ subscriptionId: sub.id });
      } catch (err) {
        failed++;
        const status =
          err &&
          typeof err === 'object' &&
          'statusCode' in err &&
          typeof (err as { statusCode?: unknown }).statusCode === 'number'
            ? ((err as { statusCode: number }).statusCode as number)
            : undefined;
        if (status === 410 || status === 404) {
          // Подписка протухла — markFailure (с авто-удалением при превышении).
          try {
            await this.subs.markFailure({ subscriptionId: sub.id });
          } catch (e) {
            this.logger.warn(
              { subId: sub.id, err: e instanceof Error ? e.message : String(e) },
              'sendToUser: markFailure упал — пропускаем',
            );
          }
        } else {
          this.logger.warn(
            {
              subId: sub.id,
              status,
              err: err instanceof Error ? err.message : String(err),
            },
            'sendToUser: ошибка отправки (не 410/404) — подписку не удаляем',
          );
        }
      }
    }
    return { delivered, failed };
  }
}
