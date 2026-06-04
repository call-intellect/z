/**
 * MeetingsBalanceService — накопительный баланс встреч.
 *
 * Заменяет старую месячную квоту `meetings_per_month`. Ключевые отличия:
 *   - НЕ обнуляется в конце месяца — баланс копится.
 *   - НЕТ потолка (если 5 месяцев не пользовались — 750 встреч можно слить).
 *   - Грантуется при активации/продлении подписки (см. ManualBillingService
 *     Фаза 4) или вручную через admin-эндпоинт.
 *
 * Формула стартового гранта (ТЗ 2026-05-27 §10 + 2026-05-31 §3.1):
 *   meetingsGrant = baseMeetingsGrant + max(0, seatsExtra) × perExtraSeatMeetingsGrant
 *
 * Параметры гранта живут в **AdminSetting** (ключи `billing.baseMeetingsGrant`
 * и `billing.perExtraSeatMeetingsGrant`) и редактируются super_admin через UI.
 * Дефолты — `DEFAULT_BASE_MEETINGS_GRANT` и `DEFAULT_PER_EXTRA_SEAT_MEETINGS_GRANT`
 * как code-fallback (см. ТЗ 2026-05-31-admin-plans-collapse-to-standard.md §3.1).
 *
 * Чтение через `TypedConfigService.getDynamic(...)`:
 *   - LRU-кэш 30s + Redis pub/sub `admin:setting:invalidate` → новый прайс
 *     видно во всех процессах за <1s.
 *   - При недоступности `AdminSettingsService` (минимальный bootstrap, тесты) —
 *     fallback на DEFAULT_*.
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
 * См. plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §10 и
 * plans/tz/2026-05-31-admin-plans-collapse-to-standard.md §3.1–3.2.
 */

import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../common/config';
import { PrismaService } from '../../common/prisma/prisma.service';

/** Базовый стартовый грант — code-fallback (60 000 ₽ / 150 встреч). */
const DEFAULT_BASE_MEETINGS_GRANT = 150;
/** Доп. встречи на каждое доп. место сверх базы — code-fallback. */
const DEFAULT_PER_EXTRA_SEAT_MEETINGS_GRANT = 5;

export interface MeetingsBalanceView {
  balance: number;
  totalGranted: number;
  totalConsumed: number;
  lastGrantedAt: Date | null;
}

@Injectable()
export class MeetingsBalanceService {
  private readonly logger = new Logger(MeetingsBalanceService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  /**
   * Базовый грант (число встреч на тарифе без доп. мест).
   * Читается из AdminSetting `billing.baseMeetingsGrant`, fallback — DEFAULT_*.
   */
  async getBaseMeetingsGrant(): Promise<number> {
    return this.cfg.getDynamic<number>(
      'billing.baseMeetingsGrant',
      undefined,
      DEFAULT_BASE_MEETINGS_GRANT,
    );
  }

  /**
   * Доп. грант за каждое доп. место.
   * Читается из AdminSetting `billing.perExtraSeatMeetingsGrant`, fallback — DEFAULT_*.
   */
  async getPerExtraSeatMeetingsGrant(): Promise<number> {
    return this.cfg.getDynamic<number>(
      'billing.perExtraSeatMeetingsGrant',
      undefined,
      DEFAULT_PER_EXTRA_SEAT_MEETINGS_GRANT,
    );
  }

  /**
   * Стартовый/ежемесячный грант встреч:
   *   meetingsGrant = base + max(0, seatsExtra) × perSeat
   *
   * Оба параметра читаются параллельно через `Promise.all`. После прогрева
   * LRU-кэша обе ветки возвращают синхронно из памяти.
   */
  async calculateMeetingsGrant(seatsExtra: number): Promise<number> {
    const [base, perSeat] = await Promise.all([
      this.getBaseMeetingsGrant(),
      this.getPerExtraSeatMeetingsGrant(),
    ]);
    return base + Math.max(0, seatsExtra) * perSeat;
  }

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
   * Списать `amount` встреч. Атомарно: один `UPDATE ... WHERE balance >= amount`
   * (Prisma `updateMany` с условием — ровно такой SQL). При недостатке —
   * `ForbiddenException`.
   *
   * Раньше тут был `$executeRaw UPDATE meetings_balance`, но модель
   * `MeetingsBalance` не имеет `@@map`, поэтому реальная таблица называется
   * `MeetingsBalance` (camelCase) — raw-запрос падал с
   * `relation "meetings_balance" does not exist`, и баланс НИКОГДА не списывался
   * (ошибка глоталась fail-open в caller'е). Переход на типизированный Prisma —
   * как в `grant` — лечит это без миграции схемы.
   *
   * fail-open: если БД упала с не-Prisma-known ошибкой — пробрасываем
   * как есть (NestJS отдаст 500). Это сознательно: ForbiddenException
   * = «недостаточно баланса», 500 = «инфра сбой» (UI отдельно покажет).
   */
  async consume(tenantId: string, amount = 1): Promise<void> {
    if (amount <= 0) return;
    const { count: affected } = await this.prisma.meetingsBalance.updateMany({
      where: { tenantId, balance: { gte: amount } },
      data: {
        balance: { decrement: amount },
        totalConsumed: { increment: amount },
      },
    });
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
