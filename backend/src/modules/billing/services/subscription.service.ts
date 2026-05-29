/**
 * SubscriptionService — CRUD + FSM-переходы подписки.
 *
 * Главные правила (ТЗ §7 + §14):
 *   - Никаких прямых `prisma.subscription.update({status: ...})` в проекте.
 *     Любая смена `status` идёт через `transition()` — он проверяет FSM и
 *     пишет `SubscriptionEvent`.
 *   - События в `EventEmitter2` отправляются fire-and-forget ПОСЛЕ
 *     транзакции — если эмит упал, БД-операция уже зафиксирована.
 *   - `forceStatus()` — обход FSM для super_admin'а (с обязательным reason).
 *     Записывает eventType='status_forced' для аудита.
 *
 * Источник: plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §7.1.
 */

import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  Prisma,
  type Subscription,
  type SubscriptionStatus,
} from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { SubscriptionEventType } from '../billing.types';
import {
  BillingEvent,
  type SubscriptionExpiredPayload,
  type SubscriptionSeatsChangedPayload,
} from '../events/billing.events';

import { assertCanTransition } from './subscription-fsm';

export interface TransitionOptions {
  /** Новый статус. */
  to: SubscriptionStatus;
  /** Кто инициировал (admin/system). NULL для cron. */
  byUserId?: string | null;
  /** Обязательно для админских действий. */
  reason?: string | null;
  /** Произвольные данные для `SubscriptionEvent.payload`. */
  payload?: Prisma.JsonObject;
  /**
   * Принудительный переход (обход FSM). Использовать только из админ-эндпоинта
   * `force-status` (требует super_admin + reason).
   */
  force?: boolean;
  /**
   * Внешняя prisma-транзакция. Если не передана, сервис делает свою.
   */
  tx?: Prisma.TransactionClient;
}

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
  ) {}

  /** Получить подписку Org. NULL если у Org ещё нет записи Subscription. */
  async getByTenant(tenantId: string): Promise<Subscription | null> {
    return this.prisma.subscription.findUnique({ where: { tenantId } });
  }

  /** Найти или бросить 404. */
  async getByTenantOrFail(tenantId: string): Promise<Subscription> {
    const sub = await this.getByTenant(tenantId);
    if (!sub) {
      throw new NotFoundException(`Подписка для tenantId=${tenantId} не найдена`);
    }
    return sub;
  }

  /**
   * Создаёт начальную запись Subscription со status=DEMO для свежей Org.
   * Идемпотентно: если запись уже есть — возвращает её без вторичной записи.
   * Принимает опциональный `tx`, чтобы вписаться в транзакцию вызывающего
   * (например, OrgsService.createForOwner внутри AccountsService.register).
   */
  async ensureDemo(
    tenantId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Subscription> {
    const client = tx ?? this.prisma;
    const existing = await client.subscription.findUnique({
      where: { tenantId },
    });
    if (existing) return existing;

    const created = await client.subscription.create({
      data: { tenantId },
    });
    // Пишем событие 'created' (без эмита EventEmitter — это создание, не
    // активация). Реф-комиссия не триггерится.
    await client.subscriptionEvent.create({
      data: {
        subscriptionId: created.id,
        eventType: SubscriptionEventType.CREATED,
        payload: { initial: true },
      },
    });
    return created;
  }

  /**
   * Переход статуса с обязательной FSM-валидацией.
   *
   * Эмитит соответствующее BillingEvent после успешной записи. НЕ ставит
   * `currentPeriodStart`/`End` — это ответственность вызывающего сервиса
   * (ManualBillingService / RecurringChargeCron). Принимает явный
   * `payload.dataPatch` для одновременного update полей (период, seatsExtra,
   * autoRenew и т.п.) — атомарно с FSM-переходом.
   */
  async transition(
    tenantId: string,
    options: TransitionOptions & {
      /** Дополнительные поля для update (period, seats, autoRenew, ...). */
      dataPatch?: Prisma.SubscriptionUncheckedUpdateInput;
    },
  ): Promise<Subscription> {
    const runner = options.tx ?? this.prisma;
    const current = await runner.subscription.findUnique({ where: { tenantId } });
    if (!current) {
      throw new NotFoundException(`Подписка для tenantId=${tenantId} не найдена`);
    }

    // FSM check (skip только для force).
    if (!options.force) {
      assertCanTransition(current.status, options.to);
    }

    const patch = options.dataPatch ?? {};

    const updated = await runner.subscription.update({
      where: { id: current.id },
      data: {
        ...patch,
        status: options.to,
      },
    });

    const eventType = options.force
      ? SubscriptionEventType.STATUS_FORCED
      : this.statusToEventType(options.to, current.status);

    await runner.subscriptionEvent.create({
      data: {
        subscriptionId: updated.id,
        eventType,
        payload: {
          fromStatus: current.status,
          toStatus: options.to,
          ...(options.payload ?? {}),
        },
        byUserId: options.byUserId ?? null,
        reason: options.reason ?? null,
      },
    });

    // Fire-and-forget эмит соответствующих BillingEvent (не блокируем основной поток).
    this.emitForTransition(updated, current.status, options.to);

    return updated;
  }

  /**
   * Установить число доп. мест. Идёт через transition() со status=ACTIVE
   * (от текущего ACTIVE → ACTIVE — same-status, FSM не сработает; но
   * мы хотим записать SubscriptionEvent SEATS_CHANGED).
   *
   * Если запись seatsExtra совпадает — no-op (не пишем событие).
   */
  async setSeatsExtra(args: {
    tenantId: string;
    newSeatsExtra: number;
    byUserId: string;
    reason: string;
  }): Promise<Subscription> {
    const current = await this.getByTenantOrFail(args.tenantId);
    if (current.seatsExtra === args.newSeatsExtra) return current;

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.subscription.update({
        where: { id: current.id },
        data: { seatsExtra: args.newSeatsExtra },
      });
      await tx.subscriptionEvent.create({
        data: {
          subscriptionId: u.id,
          eventType: SubscriptionEventType.SEATS_CHANGED,
          payload: {
            seatsExtraBefore: current.seatsExtra,
            seatsExtraAfter: args.newSeatsExtra,
          },
          byUserId: args.byUserId,
          reason: args.reason,
        },
      });
      return u;
    });

    const payload: SubscriptionSeatsChangedPayload = {
      tenantId: updated.tenantId,
      subscriptionId: updated.id,
      seatsExtraBefore: current.seatsExtra,
      seatsExtraAfter: updated.seatsExtra,
    };
    void this.safeEmit(BillingEvent.SUBSCRIPTION_SEATS_CHANGED, payload);

    return updated;
  }

  // ──────────────────────── private ────────────────────────

  private statusToEventType(
    to: SubscriptionStatus,
    _from: SubscriptionStatus,
  ): string {
    switch (to) {
      case 'ACTIVE':
        // Различие paid/bonus определяется в ManualBillingService — там
        // используется отдельный transition с payload.paymentMode и
        // конкретный SubscriptionEventType (ACTIVATED_PAID/BONUS).
        // Для прямого вызова transition с to=ACTIVE считаем как RENEWED.
        return SubscriptionEventType.RENEWED;
      case 'PAST_DUE':
        return SubscriptionEventType.PAST_DUE;
      case 'SUSPENDED':
        return SubscriptionEventType.SUSPENDED;
      case 'CANCELED':
        return SubscriptionEventType.CANCELED;
      case 'EXPIRED':
        return SubscriptionEventType.EXPIRED;
      case 'DEMO':
        return SubscriptionEventType.CREATED;
    }
  }

  private emitForTransition(
    sub: Subscription,
    fromStatus: SubscriptionStatus,
    toStatus: SubscriptionStatus,
  ): void {
    if (fromStatus === toStatus) return;
    if (toStatus === 'EXPIRED') {
      const payload: SubscriptionExpiredPayload = {
        tenantId: sub.tenantId,
        subscriptionId: sub.id,
      };
      void this.safeEmit(BillingEvent.SUBSCRIPTION_EXPIRED, payload);
    } else if (toStatus === 'PAST_DUE') {
      void this.safeEmit(BillingEvent.SUBSCRIPTION_PAST_DUE, {
        tenantId: sub.tenantId,
        subscriptionId: sub.id,
      });
    }
    // ACTIVE-эмиты идут из ManualBillingService (там есть paymentMode/период).
  }

  private async safeEmit(eventName: string, payload: unknown): Promise<void> {
    try {
      await this.events.emitAsync(eventName, payload);
    } catch (err) {
      this.logger.warn(
        `BillingEvent ${eventName}: emit упал: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
