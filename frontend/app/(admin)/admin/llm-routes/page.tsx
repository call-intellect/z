import type { Metadata } from 'next';

import { LlmRoutesClient } from './LlmRoutesClient';

export const metadata: Metadata = {
  title: 'Управление роутами LLM — Z-Admin',
};

/**
 * `/admin/llm-routes` — управление цепочкой моделей primary → secondary →
 * tertiary для каждого taskType (super_admin-only). Источник правды на бэке —
 * `LlmTaskRoute` (модели LLM по типам задач), API контроллер —
 * `backend/src/modules/admin/llm-routes/llm-routes.controller.ts`.
 *
 * Защита роли: бэкенд возвращает 403 для не-super_admin. Frontend ловит это
 * как `ApiError.code === 'forbidden'` и показывает `AdminForbidden`.
 *
 * См. ТЗ: `plans/tz/2026-05-25-admin-llm-routes-frontend.md`.
 */
export default function AdminLlmRoutesPage() {
  return <LlmRoutesClient />;
}
