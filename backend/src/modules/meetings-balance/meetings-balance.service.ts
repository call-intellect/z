/**
 * MeetingsBalanceService — накопительный баланс встреч.
 *
 * Заменяет старую месячную квоту `meetings_per_month`. Ключевые отличия:
 *   - НЕ обнуляется в конце месяца — баланс копится.
 *   - НЕТ потолка (если 5 месяцев не пользовались — 750 встреч можно слить).
 *   - Грантуется при активации/продлении подписки (см. ManualBillingService
 *     Фаза 4) или вручную через admin-эндпоинт.
 *
 * Формула стартового гранта (см. ТЗ §10):
 *   meetingsGrant = 150 + seatsExtra * 5
 *
 * Атомарность `consume`:
 *   Используем `$executeRaw UPDATE ... WHERE balance >= amount`. PG row-lock
 *   гарантирует что concurrent consume не уйдёт в минус. Если update
 *   зацепил 0 строк — либо `MeetingsBalance` нет, либо баланс < amount.
 *
 * fail-open на инфра-ошибках:
 *   Если БД упала в момент `consume()`, мы НЕ блокируем создание встречи —
 *   это решение унаследовано от старой `checkMeetingsMonthlyQuota` в
 *   meetings.service.ts. Бизнес-приоритет: лучше дать встречу бесплатно,
 *   чем заблокировать клиента из-за инфра-сбоя.
 *
 * См. plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §10.
 */

import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';

/** Базовый стартовый грант: 150 встреч/мес у плана `tier_standard`. */
export const BASE_MEETINGS_GRANT = 150;
/** Доп. встречи на каждое доп. место сверх базы. */
export const PER_EXTRA_SEAT_MEETINGS_GRANT = 5;

/** Pure helper — расчёт стартового/ежемесячного гранта. */
export function calculateMeetingsGrant(seatsExtra: number): number {
  return BASE_MEETINGS_GRANT + Math.max(0, seatsExtra) * PER_EXTRA_SEAT_MEETINGS_GRANT;
}

export interface MeetingsBalanceView {
  balance: number;
  totalGranted: number;
  totalConsumed: number;
  lastGrantedAt: Date | null;
}

@Injectable()
export class MeetingsBalanceService {
  private readonly logger = new Logger(MeetingsBalanceService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Текущий баланс Org. Если записи нет — возвращает 0/нулевые поля
   * (НЕ создаём здесь, чтобы не давать «магический» баланс по чтению).
   */
  async getBalance(tenantId: string): Promise<MeetingsBalanceView> {
    const row = await this.prisma.meetingsBalance.findUnique({
      where: { tenantId },
    });
    if (!row) {
      return { balance: 0, totalGranted: 0, totalConsumed: 0, lastGrantedAt: null };
    }
    return {
      balance: row.balance,
      totalGranted: row.totalGranted,
      totalConsumed: row.totalConsumed,
      lastGrantedAt: row.lastGrantedAt,
    };
  }

  /**
   * Начислить встречи. Idempotency на стороне вызывающего: НЕ должен
   * вызываться повторно для одного и того же события (активация / продление).
   *
   * Создаёт запись MeetingsBalance если её ещё нет.
   */
  async grant(tenantId: string, amount: number): Promise<void> {
    if (amount <= 0) return;
    await this.prisma.meetingsBalance.upsert({
      where: { tenantId },
      create: {
        tenantId,
        balance: amount,
        totalGranted: amount,
        lastGrantedAt: new Date(),
      },
      update: {
        balance: { increment: amount },
        totalGranted: { increment: amount },
        lastGrantedAt: new Date(),
      },
    });
    this.logger.log(`Granted ${amount} meetings to org=${tenantId}`);
  }

  /**
   * Списать `amount` встреч. Атомарно через `executeRaw UPDATE ... WHERE
   * balance >= amount`. При недостатке — `ForbiddenException`.
   *
   * fail-open: если БД упала с не-Prisma-known ошибкой — пробрасываем
   * как есть (NestJS отдаст 500). Это сознательно: ForbiddenException
   * = «недостаточно баланса», 500 = «инфра сбой» (UI отдельно покажет).
   */
  async consume(tenantId: string, amount = 1): Promise<void> {
    if (amount <= 0) return;
    // tenant_id хранится как TEXT (Org.id — cuid, не uuid) — без каста.
    const affected = await this.prisma.$executeRaw`
      UPDATE meetings_balance
         SET balance = balance - ${amount},
             total_consumed = total_consumed + ${amount},
             updated_at = NOW()
       WHERE tenant_id = ${tenantId}
         AND balance >= ${amount}
    `;
    if (affected === 0) {
      this.logger.warn(
        `MeetingsBalance.consume: недостаточно баланса для org=${tenantId} (нужно ${amount})`,
      );
      throw new ForbiddenException(
        'Закончились встречи в текущем балансе. Доплатите тариф или дождитесь продления подписки.',
      );
    }
  }
}
