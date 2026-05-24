import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PushSubscription as PrismaPushSubscription } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/typed-config.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { PushSubscriptionView } from '../dto/push-subscription.dto';

/**
 * PushSubscriptionsService — CRUD над `PushSubscription`.
 *
 * Используется:
 *   - REST POST/DELETE/GET `/api/v1/me/push-subscriptions` (controller).
 *   - WebPushSender для list-перед-отправкой и markFailure при 410/404.
 *   - PushCleanupCron для batch-удаления протухших подписок.
 *
 * Идемпотентность создания обеспечивается @@unique([userId, endpoint]) в
 * `prisma/schema.prisma` + `upsert` в `subscribe`. Повторный POST с тем же
 * endpoint обновляет `lastSeenAt` / `userAgent` / `expiresAt`, но не плодит
 * дубликаты.
 */
@Injectable()
export class PushSubscriptionsService {
  private readonly logger = new Logger(PushSubscriptionsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  /**
   * Upsert по @@unique([userId, endpoint]). Возвращает запись (с id) — нужно
   * controller'у, чтобы отдать клиенту 200 + { id }.
   */
  async subscribe(args: {
    tenantId: string;
    userId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    userAgent?: string;
    expiresAt?: Date | null;
  }): Promise<PrismaPushSubscription> {
    const data = {
      tenantId: args.tenantId,
      userId: args.userId,
      endpoint: args.endpoint,
      p256dh: args.p256dh,
      auth: args.auth,
      userAgent: args.userAgent ?? null,
      expiresAt: args.expiresAt ?? null,
      lastSeenAt: new Date(),
      failureCount: 0,
    };
    const sub = await this.prisma.pushSubscription.upsert({
      where: {
        userId_endpoint: { userId: args.userId, endpoint: args.endpoint },
      },
      create: data,
      update: {
        // tenantId не меняем (хотя в теории один и тот же user в разных Org
        // мог бы получить разный tenantId — но frontend шлёт `X-Org-Id` из
        // активной Org, и эта связь стабильна для текущей session).
        p256dh: args.p256dh,
        auth: args.auth,
        userAgent: args.userAgent ?? null,
        expiresAt: args.expiresAt ?? null,
        lastSeenAt: new Date(),
        // failureCount сбрасываем — пользователь явно повторил подписку,
        // значит браузер живой.
        failureCount: 0,
      },
    });
    return sub;
  }

  /**
   * Удаление одной подписки по endpoint. Делаем `deleteMany`, чтобы запрос
   * был идемпотентным (HTTP DELETE) — отсутствующая запись не приводит к ошибке.
   */
  async unsubscribe(args: {
    userId: string;
    endpoint: string;
  }): Promise<{ deleted: number }> {
    const res = await this.prisma.pushSubscription.deleteMany({
      where: { userId: args.userId, endpoint: args.endpoint },
    });
    return { deleted: res.count };
  }

  /**
   * Список подписок текущего user — для отображения в UI «мои устройства».
   * Без чувствительных полей (p256dh, auth) — фильтрует controller через
   * `toView` ниже.
   */
  async listMine(args: { userId: string }): Promise<PrismaPushSubscription[]> {
    return this.prisma.pushSubscription.findMany({
      where: { userId: args.userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Список подписок per user — используется WebPushSender перед рассылкой.
   * Tenant-фильтр явный: одна подписка живёт в контексте одной Org.
   */
  async listForUser(args: {
    tenantId: string;
    userId: string;
  }): Promise<PrismaPushSubscription[]> {
    return this.prisma.pushSubscription.findMany({
      where: { tenantId: args.tenantId, userId: args.userId },
    });
  }

  /**
   * Инкремент failureCount + удаление при достижении порога. Вызывается
   * WebPushSender при 410/404 от push-сервиса.
   *
   * Возвращает финальный счётчик и флаг, удалена ли запись (для логов).
   */
  async markFailure(args: {
    subscriptionId: string;
  }): Promise<{ failureCount: number; deleted: boolean }> {
    const max = this.cfg.push.maxFailures;
    const updated = await this.prisma.pushSubscription.update({
      where: { id: args.subscriptionId },
      data: { failureCount: { increment: 1 } },
      select: { id: true, failureCount: true },
    });
    if (updated.failureCount >= max) {
      await this.prisma.pushSubscription.delete({
        where: { id: args.subscriptionId },
      });
      this.logger.log(
        `markFailure: подписка ${args.subscriptionId} удалена (failureCount=${updated.failureCount}, max=${max})`,
      );
      return { failureCount: updated.failureCount, deleted: true };
    }
    return { failureCount: updated.failureCount, deleted: false };
  }

  /**
   * Обновление lastSeenAt после успешной отправки. Используется WebPushSender.
   */
  async markSuccess(args: { subscriptionId: string }): Promise<void> {
    await this.prisma.pushSubscription.update({
      where: { id: args.subscriptionId },
      data: { lastSeenAt: new Date(), failureCount: 0 },
    });
  }

  /**
   * Маппер БД → публичный view (без чувствительных ключей).
   */
  toView(sub: PrismaPushSubscription): PushSubscriptionView {
    return {
      id: sub.id,
      endpoint: sub.endpoint,
      userAgent: sub.userAgent,
      lastSeenAt: sub.lastSeenAt.toISOString(),
      createdAt: sub.createdAt.toISOString(),
    };
  }
}
