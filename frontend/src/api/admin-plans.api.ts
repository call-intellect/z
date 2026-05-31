/**
 * API-клиент тарифа продукта Z (Z-Admin).
 *
 * После collapse-to-standard (ТЗ 2026-05-31) остался **один** read-only
 * эндпоинт `GET /api/v1/admin/orgs/plans/current` — снимок единого тарифа
 * `tier_standard`. CRUD-методы (`list/create/update/remove/usage`) удалены
 * вместе с бэкенд-контроллером — цена и параметры пакета редактируются через
 * `/api/v1/admin/settings/billing.*` (см. `admin-settings.api.ts`).
 */

import { apiClient } from './api-client';
import type { PlanSnapshotApi } from '@/domain/admin-plan';

export const adminPlansApi = {
  /** Снимок текущего тарифа: цена/мест/встреч + features/quotas + COUNT Org. */
  getCurrent: () =>
    apiClient.get<PlanSnapshotApi>('/api/v1/admin/orgs/plans/current'),
};
