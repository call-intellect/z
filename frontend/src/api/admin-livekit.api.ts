/**
 * API-клиент для `/admin/integrations/livekit` — обзор медиа-стека LiveKit.
 * Фаза 6 редизайна Z-Admin.
 *
 * Контракт backend: `AdminLivekitController` под префиксом
 * `/api/v1/admin/integrations/livekit`. Защита — `SuperAdminGuard`.
 *
 * На момент создания фронта бэкенд готовится параллельно — при отсутствии
 * эндпоинтов клиент получит 404, UI покажет `AdminEmpty`.
 */

import { apiClient } from './api-client';
import type {
  LivekitOverviewApiDto,
  LivekitSfuHealthApiDto,
  LivekitEgressOverviewApiDto,
  LivekitTurnHealthApiDto,
} from '@/domain/admin-livekit';

const BASE = '/api/v1/admin/integrations/livekit';

export const adminLivekitApi = {
  /** Полный сводный статус (sfu / egress / turn). */
  overview: (): Promise<LivekitOverviewApiDto> =>
    apiClient.get<LivekitOverviewApiDto>(BASE),

  /** SFU: active rooms, participants, load. */
  sfu: (): Promise<LivekitSfuHealthApiDto> =>
    apiClient.get<LivekitSfuHealthApiDto>(`${BASE}/sfu`),

  /** Egress: список текущих jobs. */
  egress: (): Promise<LivekitEgressOverviewApiDto> =>
    apiClient.get<LivekitEgressOverviewApiDto>(`${BASE}/egress`),

  /** TURN: builtin/external + ping. */
  turn: (): Promise<LivekitTurnHealthApiDto> =>
    apiClient.get<LivekitTurnHealthApiDto>(`${BASE}/turn`),
};
