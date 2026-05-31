/**
 * Smart Tables (2026-05-31) — integration e2e (HTTP + Postgres).
 *
 * Покрытие (по ТЗ §Фаза 0):
 *   1. POST /api/v1/tables → создать таблицу.
 *   2. POST /api/v1/tables/:id/properties → добавить колонку.
 *   3. POST /api/v1/tables/:id/rows { cells: { propId: 'Иван' } } → строка.
 *   4. GET /api/v1/tables/:id → 200, имя совпадает.
 *   5. GET /api/v1/tables/:id/properties → 200, длина 1.
 *   6. GET /api/v1/tables/:id/rows → 200, длина 1, cells прочитан.
 *   7. POST property cap+1 → 400 (TABLE_MAX_PROPS_PER_TABLE).
 *
 * Сейчас (2026-05-31) тесты — `it.skip(...)`:
 *   - dev Postgres офлайн на машине разработчика, поднимать testcontainers
 *     в рамках Фазы 0 непропорционально.
 *   - Unit-тесты сервисов (`*.service.spec.ts`) и smoke на CRUD верифицируют
 *     те же инварианты без реальной БД.
 *
 * TODO: убрать `.skip`, когда поднимется e2e-инфра для tables.
 */
import { describe, it } from 'vitest';

describe('Smart Tables CRUD (e2e)', () => {
  it.skip('создаёт таблицу, добавляет колонку, строку, читает', async () => {
    // Требует test-Postgres + bootstrapped Nest app — см. ТЗ §Фаза 0.
  });

  it.skip('отказывает при превышении TABLE_MAX_PROPS_PER_TABLE', async () => {
    // Требует test-Postgres + override ENV TABLE_MAX_PROPS_PER_TABLE=2.
  });
});
