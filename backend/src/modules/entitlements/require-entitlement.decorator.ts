import { SetMetadata } from '@nestjs/common';

import type { FeatureKey } from './tier-config';

/**
 * Метаданные декоратора `@RequireEntitlement` (Фаза 12).
 * `EntitlementGuard` читает их через `Reflector.getAllAndOverride`.
 */
export const REQUIRE_ENTITLEMENT_KEY = 'requireEntitlement';

/**
 * Декоратор, помечающий контроллер/метод как требующий конкретной фичи tier'а.
 * Можно ставить на класс или на отдельный handler — Nest объединяет через
 * `getAllAndOverride([handler, class])`.
 *
 * Пример:
 *   ```ts
 *   @RequireEntitlement('feature.theme')
 *   @Controller('themes')
 *   export class ThemesController { ... }
 *   ```
 *
 * Если на запросе нет декоратора — `EntitlementGuard` пропустит его (transparent).
 */
export const RequireEntitlement = (feature: FeatureKey): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRE_ENTITLEMENT_KEY, feature);
