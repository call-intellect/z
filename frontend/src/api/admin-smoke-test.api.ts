/**
 * AdminSmokeTest API — клиент для smoke-тестов LLM-провайдеров.
 *
 * Контракт сервера (появится в Фазе 3, бэкенд-часть):
 *   POST /api/v1/admin/ai/smoke-test/:provider      → SmokeTestRunApi
 *   POST /api/v1/admin/ai/smoke-test/all            → { runs: SmokeTestRunApi[] }
 *   GET  /api/v1/admin/ai/smoke-test/history        → { items: SmokeTestRunApi[] }
 *   GET  /api/v1/admin/ai/smoke-test/status         → { providers: ProviderStatus[] }
 */
import { apiClient } from './api-client';

/**
 * Известные провайдеры, для которых поддерживается smoke-test.
 * Соответствует списку из ТЗ Фазы 3.
 */
export const ADMIN_SMOKE_TEST_PROVIDERS = [
  'openai',
  'deepseek',
  'anthropic',
  'ollama',
  'vox',
  'minimax',
  'grsai',
  'kie',
] as const;

export type AdminSmokeTestProvider = (typeof ADMIN_SMOKE_TEST_PROVIDERS)[number];

export type SmokeTestRunApi = {
  id?: string;
  provider: AdminSmokeTestProvider | string;
  status: 'ok' | 'fail';
  latencyMs: number | null;
  ranAt: string;
  message?: string | null;
};

export type AdminSmokeTestStatusApi = {
  providers: Array<{
    provider: AdminSmokeTestProvider | string;
    lastRun?: SmokeTestRunApi | null;
  }>;
};

export const adminSmokeTestApi = {
  /** Запуск smoke-теста для одного провайдера. */
  run: (provider: AdminSmokeTestProvider | string) =>
    apiClient.post<SmokeTestRunApi>(
      `/api/v1/admin/ai/smoke-test/${encodeURIComponent(provider)}`,
      {},
    ),

  /** Запуск smoke-теста для всех провайдеров. */
  runAll: () =>
    apiClient.post<{ runs: SmokeTestRunApi[] }>(
      '/api/v1/admin/ai/smoke-test/all',
      {},
    ),

  /** Журнал последних запусков. */
  history: (limit = 50) =>
    apiClient.get<{ items: SmokeTestRunApi[] }>(
      `/api/v1/admin/ai/smoke-test/history?limit=${limit}`,
    ),

  /** Текущее состояние по каждому провайдеру (последний run). */
  status: () =>
    apiClient.get<AdminSmokeTestStatusApi>(
      '/api/v1/admin/ai/smoke-test/status',
    ),
};
