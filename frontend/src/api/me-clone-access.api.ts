/**
 * ТЗ 2026-05-26 §2.6 — клиент для `GET /api/v1/me/clone-access`.
 *
 * Возвращает массивы id-ов клонов, к которым у текущего пользователя есть
 * активный CloneAccessGrant в текущем тенанте (orgId передаётся через
 * `X-Org-Id` заголовок). Используется фронтом для оптимистичной фильтрации
 * карточек в маркетплейсе клонов (`useMyCloneAccess()` hook).
 *
 * Backend контракт — `MyCloneAccessResponseDto`
 *   (см. backend/src/modules/clones/dto/clone-access-grant.dto.ts).
 */

import { apiClient } from './api-client';
import { orgHeaders } from './admin-helpers';

export interface MyCloneAccessResponseApi {
  /** personId-ы активных person-грантов. */
  personClones: string[];
  /** roleId-ы активных role-грантов. */
  roleClones: string[];
  /** ISO момента ответа (UI кеширует с этим штампом). */
  fetchedAt: string;
}

export const meCloneAccessApi = {
  /** Активные гранты текущего пользователя в этом тенанте. */
  get: (orgId: string) =>
    apiClient.get<MyCloneAccessResponseApi>('/api/v1/me/clone-access', {
      headers: orgHeaders(orgId),
    }),
};
