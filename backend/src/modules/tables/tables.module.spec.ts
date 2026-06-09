import 'reflect-metadata';

import { describe, expect, it } from 'vitest';

import { PendingPatchesController } from './controllers/pending-patches.controller';
import { TablesController } from './controllers/tables.controller';
import { TablesModule } from './tables.module';

/**
 * Регресс-гард порядка регистрации контроллеров в TablesModule.
 *
 * `PendingPatchesController` (@Controller('api/v1/tables') + @Get('pending-patches'))
 * и `TablesController` (@Controller('api/v1/tables') + @Get(':id')) делят базовый
 * путь. Express матчит маршруты в порядке регистрации: если динамический `:id`
 * зарегистрирован раньше статического `pending-patches`, то
 * `GET /api/v1/tables/pending-patches` уходит в `:id="pending-patches"` и отдаёт
 * 404 `table_not_found`. Поэтому PendingPatchesController обязан идти ПЕРВЫМ.
 *
 * Тест читает метаданные @Module (ключ MODULE_METADATA.CONTROLLERS === 'controllers')
 * и фиксирует относительный порядок — без поднятия БД/Nest-приложения.
 */
describe('TablesModule controller registration order', () => {
  it('registers PendingPatchesController before TablesController (static `pending-patches` must beat dynamic `:id`)', () => {
    const controllers = Reflect.getMetadata('controllers', TablesModule) as unknown[];
    expect(controllers).toBeDefined();
    const pendingIdx = controllers.indexOf(PendingPatchesController);
    const tablesIdx = controllers.indexOf(TablesController);
    expect(pendingIdx).toBeGreaterThanOrEqual(0);
    expect(tablesIdx).toBeGreaterThanOrEqual(0);
    expect(pendingIdx).toBeLessThan(tablesIdx);
  });
});
