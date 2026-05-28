import { SetMetadata } from '@nestjs/common';

/**
 * Метаданные декоратора `@RequireSubscription`.
 * `SubscriptionGuard` читает их через `Reflector.getAllAndOverride`.
 */
export const REQUIRE_SUBSCRIPTION_KEY = 'requireSubscription';

/**
 * Декоратор, помечающий контроллер/метод как требующий активной подписки
 * (`Subscription.status === 'ACTIVE'`).
 *
 * Можно ставить на класс (все методы) или на отдельный handler — Nest
 * объединяет через `getAllAndOverride([handler, class])`.
 *
 * Пример:
 *   ```ts
 *   @RequireSubscription()
 *   @Post()
 *   async createProject(@Body() dto: CreateProjectDto) { ... }
 *   ```
 *
 * Если на запросе нет декоратора — `SubscriptionGuard` пропустит его
 * (transparent). Это позволяет постепенно применять guard к отдельным
 * эндпоинтам.
 *
 * Источник: plans/tz/2026-05-28-paywall-no-trial.md §3.3.
 */
export const RequireSubscription = (): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRE_SUBSCRIPTION_KEY, true);
