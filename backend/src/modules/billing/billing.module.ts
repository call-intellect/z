/**
 * BillingModule — биллинг (Subscription/Invoice/Provider).
 *
 * **Фаза 4a (текущая, ТЗ §14):** провайдер-абстракция и pure-сервисы. Без
 * controllers, без cron, без EventEmitter-handlers. Цель — заложить
 * фундамент и протестировать формулы цены и FSM подписки.
 *
 * **Фаза 4b:** SubscriptionService (БД), InvoiceService, ManualBillingService,
 * BillingCycleCron, контроллеры.
 *
 * **Фаза 5+:** TochkaBillingProvider + OAuth + webhook.
 *
 * Зависимости через @Global модули:
 *   - PrismaService — @Global, auto-imported (SubscriptionService 4b).
 *   - EventEmitterModule.forRoot() — глобально в AppModule.
 *
 * Источник: plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §7 + §14.
 */

import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { TypedConfigService } from '../../common/config/index';

import { BILLING_PROVIDER } from './billing.types';
import { ManualBillingProvider } from './providers/manual-billing.provider';
import { InvoiceNumberService } from './services/invoice-number.service';
import { SeatService } from './services/seat.service';

/**
 * Фабрика выбора провайдера. Возвращает `ManualBillingProvider` если:
 *   - `BILLING_PROVIDER=manual` (по умолчанию), либо
 *   - `FEATURE_BILLING_TOCHKA=false` (kill-switch при сохранённом
 *     `BILLING_PROVIDER=tochka`).
 *
 * В Фазе 5 фабрика будет также инжектить `TochkaBillingProvider` и
 * возвращать его если `provider === 'tochka' && features.tochka`.
 *
 * ConfigService инжектится для совместимости с typed-config API в Z
 * (TypedConfigService — обёртка над ним). Это позволяет использовать
 * фабрику и в тестах без полного DI-контейнера.
 */
function provideBillingProvider(
  manual: ManualBillingProvider,
  cfg: TypedConfigService,
) {
  const wantsTochka =
    cfg.billing.provider === 'tochka' && cfg.billing.features.tochka;
  if (wantsTochka) {
    // Фаза 5: вернуть TochkaBillingProvider. Пока — fallback на manual.
    // Логируется при старте модуля.
    return manual;
  }
  return manual;
}

@Module({
  imports: [],
  providers: [
    // Pure-сервисы (Фаза 4a).
    SeatService,
    InvoiceNumberService,
    // Провайдеры.
    ManualBillingProvider,
    {
      provide: BILLING_PROVIDER,
      inject: [ManualBillingProvider, TypedConfigService, ConfigService],
      useFactory: (manual: ManualBillingProvider, cfg: TypedConfigService) =>
        provideBillingProvider(manual, cfg),
    },
  ],
  exports: [SeatService, InvoiceNumberService, BILLING_PROVIDER],
})
export class BillingModule {}
