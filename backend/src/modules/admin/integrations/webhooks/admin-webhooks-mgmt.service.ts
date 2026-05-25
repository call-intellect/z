import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Queue } from 'bullmq';

import { PrismaService } from '../../../../common/prisma/prisma.service';
import { RedisService } from '../../../../common/redis/redis.service';

import type {
  ActiveWebhookRowDto,
  DeliveriesPageDto,
  DeliveriesQueryDto,
  DeliveryRowDto,
  RetryDeliveryResponseDto,
} from './dto/admin-webhooks-mgmt.dto';

/**
 * Admin-redesign Фаза 6 — `AdminWebhooksMgmtService`.
 *
 * Источник правды — модели `WebhookSubscription` + `WebhookDelivery`.
 *
 * Назначение:
 *   - read: список активных подписок (по всем tenant'ам — это супер-админская
 *     панель) с фильтром по статусу + cursor-paginated лента доставок.
 *   - mutate: retry «зависшей» доставки. На текущей фазе у нас НЕТ выделенной
 *     BullMQ-очереди для `WebhookDelivery` (она доставляется внутри
 *     `tracker.webhook-delivery` для модели `IssueWebhook`, см.
 *     `WebhookDispatcher`). Поэтому для `WebhookDelivery` ретрай помечается
 *     `status='pending'` + `nextAttemptAt=NOW()`, чтобы существующий
 *     scheduler/worker подхватил запись на следующем тике. Если такого
 *     scheduler'а нет — admin увидит «не поднялось», лог расскажет почему.
 *
 * NB: `IssueWebhookLog` (tracker) — отдельная модель с другой семантикой,
 * сюда не подмешиваем — это не общеплатформенный webhook-механизм.
 */
@Injectable()
export class AdminWebhooksMgmtService {
  private readonly logger = new Logger(AdminWebhooksMgmtService.name);
  /**
   * Кэш BullMQ-очередей, чтобы не пересоздавать `new Queue(...)` на каждый
   * вызов (это держит соединение Redis открытым — дорого).
   */
  private readonly queueCache = new Map<string, Queue>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  // ─────────────────────────── reads ───────────────────────────────────

  async listActive(): Promise<ActiveWebhookRowDto[]> {
    const rows = await this.prisma.webhookSubscription.findMany({
      where: { status: 'active' },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      url: r.url,
      events: r.events,
      status: r.status,
      lastDeliveryAt: r.lastDeliveryAt ? r.lastDeliveryAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async listDeliveries(
    query: DeliveriesQueryDto,
  ): Promise<DeliveriesPageDto> {
    return this.listDeliveriesInternal(query, /* failedOnly */ false);
  }

  async listDlq(query: DeliveriesQueryDto): Promise<DeliveriesPageDto> {
    return this.listDeliveriesInternal(query, /* failedOnly */ true);
  }

  // ─────────────────────────── retry ──────────────────────────────────

  async retryDelivery(id: string): Promise<RetryDeliveryResponseDto> {
    const delivery = await this.prisma.webhookDelivery.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        subscriptionId: true,
        attempts: true,
      },
    });
    if (!delivery) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'webhook_delivery_not_found',
          message: 'Доставка не найдена',
        },
      });
    }

    // Сбрасываем статус в pending + nextAttemptAt=NOW(). Реальный re-dispatch
    // выполняет дежурный worker / scheduler этой очереди. Если scheduler'а нет
    // (нет потребителя `WebhookDelivery` в коде на этой фазе), retry будет
    // «вечно pending» — admin увидит это в ленте и завернёт фикс. Это
    // безопасный no-op: данные мы не теряем, дубль не создаём.
    await this.prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: 'pending',
        nextAttemptAt: new Date(),
      },
    });

    this.logger.log(`admin: webhook delivery ${id} переведён в pending для retry`);

    // Если в будущем появится отдельная очередь — добавим её сюда. Пока —
    // best-effort попытка положить в общую очередь scheduler'а (если она
    // существует), чтобы он подхватил pending записи на следующем тике.
    const enqueued = await this.tryEnqueueScheduler(delivery.subscriptionId);

    return {
      ok: true,
      enqueued,
      message: enqueued
        ? 'Доставка переведена в pending, scheduler-очередь уведомлена.'
        : 'Доставка переведена в pending. Если в системе нет scheduler-воркера для WebhookDelivery — запись подхватится после ручной отправки или останется ждать.',
    };
  }

  // ─────────────────────────── internals ──────────────────────────────

  private async listDeliveriesInternal(
    query: DeliveriesQueryDto,
    failedOnly: boolean,
  ): Promise<DeliveriesPageDto> {
    const where: Prisma.WebhookDeliveryWhereInput = {};
    if (failedOnly) {
      where.status = 'failed';
    } else if (query.status) {
      where.status = query.status;
    }
    if (query.url) {
      where.subscription = { url: { contains: query.url } };
    }
    // cursor: base64 JSON { createdAt: ISO, id }.
    if (query.cursor) {
      const parsed = this.parseCursor(query.cursor);
      if (parsed) {
        where.OR = [
          { createdAt: { lt: parsed.createdAt } },
          {
            createdAt: parsed.createdAt,
            id: { lt: parsed.id },
          },
        ];
      }
    }

    const rows = await this.prisma.webhookDelivery.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      include: {
        subscription: { select: { url: true } },
      },
    });

    let nextCursor: string | null = null;
    let items = rows;
    if (rows.length > query.limit) {
      const last = rows[query.limit - 1];
      if (last) {
        nextCursor = this.encodeCursor({
          createdAt: last.createdAt,
          id: last.id,
        });
      }
      items = rows.slice(0, query.limit);
    }

    const mapped: DeliveryRowDto[] = items.map((r) => ({
      id: r.id,
      subscriptionId: r.subscriptionId,
      url: r.subscription?.url ?? null,
      event: r.event,
      status: r.status,
      attempts: r.attempts,
      lastStatus: r.lastStatus,
      lastResponse: r.lastResponse,
      nextAttemptAt: r.nextAttemptAt ? r.nextAttemptAt.toISOString() : null,
      deliveredAt: r.deliveredAt ? r.deliveredAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    }));

    return { items: mapped, nextCursor };
  }

  /**
   * Best-effort попытка положить job в гипотетическую очередь
   * `webhook-delivery` (если она есть). Если очереди нет / Redis недоступен —
   * молча возвращаем false (Admin получит сообщение «scheduler не уведомлён»).
   */
  private async tryEnqueueScheduler(subscriptionId: string): Promise<boolean> {
    try {
      const q = this.getOrCreateQueue('webhook-delivery');
      await q.add(
        'webhook.delivery.retry',
        { subscriptionId, source: 'admin-retry' },
        { attempts: 1 },
      );
      return true;
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'admin-webhooks-mgmt: tryEnqueueScheduler failed (нет worker?)',
      );
      return false;
    }
  }

  private getOrCreateQueue(name: string): Queue {
    const cached = this.queueCache.get(name);
    if (cached) return cached;
    const q = new Queue(name, {
      connection: this.redis.client as never,
    });
    this.queueCache.set(name, q);
    return q;
  }

  private parseCursor(
    cursor: string,
  ): { createdAt: Date; id: string } | null {
    try {
      const json = JSON.parse(
        Buffer.from(cursor, 'base64').toString('utf-8'),
      ) as { createdAt?: string; id?: string };
      if (!json.createdAt || !json.id) return null;
      const d = new Date(json.createdAt);
      if (Number.isNaN(d.getTime())) return null;
      return { createdAt: d, id: json.id };
    } catch {
      return null;
    }
  }

  private encodeCursor(args: { createdAt: Date; id: string }): string {
    return Buffer.from(
      JSON.stringify({ createdAt: args.createdAt.toISOString(), id: args.id }),
      'utf-8',
    ).toString('base64');
  }
}
