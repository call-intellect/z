/**
 * API-клиент для `/admin/platform/workers` — BullMQ inspector.
 * Фаза 8 редизайна Z-Admin.
 *
 * Контракт backend (`AdminWorkersController` под префиксом
 * `/api/v1/admin/workers`). Если эндпоинт ещё не реализован — UI получит 404
 * и упадёт в `AdminEmpty`.
 */

import { apiClient } from './api-client';
import type {
  WorkerQueueApiDto,
  WorkerQueueDetailApiDto,
} from '@/domain/admin-worker';

const BASE = '/api/v1/admin/workers/queues';

export const adminWorkersApi = {
  listQueues: (): Promise<WorkerQueueApiDto[]> =>
    apiClient.get<WorkerQueueApiDto[]>(BASE),

  queueDetail: (name: string): Promise<WorkerQueueDetailApiDto> =>
    apiClient.get<WorkerQueueDetailApiDto>(
      `${BASE}/${encodeURIComponent(name)}`,
    ),

  retryFailed: (name: string): Promise<{ ok: true; retried: number }> =>
    apiClient.post<{ ok: true; retried: number }>(
      `${BASE}/${encodeURIComponent(name)}/retry-failed`,
      {},
    ),

  pause: (name: string): Promise<{ ok: true; paused: boolean }> =>
    apiClient.post<{ ok: true; paused: boolean }>(
      `${BASE}/${encodeURIComponent(name)}/pause`,
      {},
    ),

  resume: (name: string): Promise<{ ok: true; paused: boolean }> =>
    apiClient.post<{ ok: true; paused: boolean }>(
      `${BASE}/${encodeURIComponent(name)}/resume`,
      {},
    ),

  removeJob: (queueName: string, jobId: string): Promise<{ ok: true }> =>
    apiClient.del<{ ok: true }>(
      `${BASE}/${encodeURIComponent(queueName)}/jobs/${encodeURIComponent(jobId)}`,
    ),
};
