---
title: Z-Admin — карта страниц
updated: 2026-05-25
---

# Z-Admin (super_admin)

Список фактически работающих страниц админки. Полная карта сайдбара — в
[frontend/app/(authenticated)/admin/navigation.ts](../../frontend/app/(authenticated)/admin/navigation.ts).

## AI и модели

### `/admin/llm-routes` — Управление роутами LLM

Страница для super_admin: таблица всех ~80 `taskType` (типов задач LLM) с
цепочкой моделей primary → secondary → tertiary. Позволяет менять провайдера
и модель для любого taskType без правки seed-скриптов.

- **API:** `GET / PUT /api/v1/admin/llm-routes` —
  `backend/src/modules/admin/llm-routes/llm-routes.controller.ts`.
- **Защита:** `CookieAuthGuard` + `SuperAdminGuard`. Не-super_admin получает
  403 → UI показывает `AdminForbidden`.
- **Фронт:**
  - `frontend/app/(authenticated)/admin/llm-routes/page.tsx`
  - `frontend/app/(authenticated)/admin/llm-routes/LlmRoutesClient.tsx`
  - `frontend/app/(authenticated)/admin/llm-routes/EditRouteDialog.tsx`
  - `frontend/src/api/admin-llm-routes.api.ts`
  - `frontend/src/domain/admin-llm-route.ts`
  - `frontend/src/hooks/useLlmRoutes.ts`
- **Особенности:**
  - Поддерживается оба формата записи `LlmTaskRoute`: нормализованный
    (по `tier`) и legacy (`providers` JSON-массив).
  - После сохранения роут получает `editedByAdmin=true` — seed-скрипты его
    больше не перезатирают (см. `safe-seed-rules`).
  - Для DeepSeek-Pro в модалке предупреждение про автоконвертацию
    `json_schema → tools` (ТЗ `deepseek-pro-output-format-fix`).
- **ТЗ:** [plans/tz/2026-05-25-admin-llm-routes-frontend.md](../../plans/tz/2026-05-25-admin-llm-routes-frontend.md).
