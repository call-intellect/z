/**
 * BillingEventService — лог биллинговых событий в `BillingEventLog`.
 *
 * Назначение:
 *   - Дедуп webhook'ов от провайдера по `externalEventId` (формат
 *     `<eventType>:<operationId>:<status>`).
 *   - Аудит всех биллинговых операций (admin activate, manual mark-paid, ...).
 *   - Возможность переиграть события (replay) если упал side-effect.
 *
 * НЕ заменяет EventEmitter — событие, эмитнутое через bus, и запись в логе
 * это две разные ответственности.
 *
 * См. plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §6 + §13.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  type BillingEventLog,
  type BillingProviderName,
} from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';

export interface LogEventInput {
  eventType: string;
  tenantId?: string | null;
  subscriptionId?: string | null;
  invoiceId?: string | null;
  providerName?: BillingProviderName | null;
  /** Сформированный из payload идентификатор для дедупа (см. парс webhook). */
  externalEventId?: string | null;
  /**
   * audit Б4 (2026-05-29): JWT-jti webhook'а от Точки. Уникальный в БД —
   * повторный insert с тем же jti приводит к P2002, который мы ловим и
   * возвращаем `duplicate=true`. Атомарная защита от race-condition,
   * которой нет у findFirst+create.
   */
  jti?: string | null;
  payload: Prisma.InputJsonValue;
  /** Сразу пометить событие как processed. По умолчанию 'received'. */
  markProcessed?: boolean;
  tx?: Prisma.TransactionClient;
}

@Injectable()
export class BillingEventService {
  private readonly logger = new Logger(BillingEventService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Записать событие. Возвращает запись + флаг `duplicate=true` если событие
   * с таким `externalEventId` уже было (по `BillingEventLog.externalEventId`
   * индексу) — в этом случае новой записи НЕ создаём.
   */
  async log(
    input: LogEventInput,
  ): Promise<{ event: BillingEventLog; duplicate: boolean }> {
    const runner = input.tx ?? this.prisma;

    // audit Б4: атомарный путь — пытаемся CREATE сразу. P2002 на jti
    // (или на externalEventId, когда добавим unique в Б7) → duplicate=true.
    // Это убирает TOCTOU между findFirst + create при параллельных webhook'ах.
    try {
      const event = await runner.billingEventLog.create({
        data: {
          eventType: input.eventType,
          tenantId: input.tenantId ?? null,
          subscriptionId: input.subscriptionId ?? null,
          invoiceId: input.invoiceId ?? null,
          providerName: input.providerName ?? null,
          externalEventId: input.externalEventId ?? null,
          jti: input.jti ?? null,
          payload: input.payload,
          status: input.markProcessed ? 'processed' : 'received',
          processedAt: input.markProcessed ? new Date() : null,
        },
      });
      return { event, duplicate: false };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // unique-конфликт (jti). Достаём существующую запись и возвращаем
        // duplicate=true, чтобы caller отработал idempotent.
        const lookup = input.jti
          ? { jti: input.jti }
          : input.externalEventId
            ? {
                externalEventId: input.externalEventId,
                providerName: input.providerName ?? undefined,
              }
            : null;
        if (lookup) {
          const existing = await runner.billingEventLog.findFirst({
            where: lookup,
            orderBy: { createdAt: 'desc' },
          });
          if (existing) {
            this.logger.warn(
              `Webhook duplicate detected (jti=${input.jti ?? '-'}, externalEventId=${input.externalEventId ?? '-'}) — skip`,
            );
            return { event: existing, duplicate: true };
          }
        }
      }
      throw err;
    }
  }

  /** Помечает событие как processed (для двухфазных обработчиков). */
  async markProcessed(
    eventId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const runner = tx ?? this.prisma;
    await runner.billingEventLog.update({
      where: { id: eventId },
      data: { status: 'processed', processedAt: new Date() },
    });
  }

  /** Помечает событие как failed (с error-payload в payload.error). */
  async markFailed(
    eventId: string,
    error: unknown,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const runner = tx ?? this.prisma;
    const errorMessage = error instanceof Error ? error.message : String(error);
    await runner.billingEventLog.update({
      where: { id: eventId },
      data: { status: 'failed', payload: { error: errorMessage } },
    });
  }
}
