---
title: Z-Admin — карта страниц
updated: 2026-05-26
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

### `/admin/clones` — Доступы к клонам (2026-05-26)

Страница для `owner` / `admin` Org: управление гранатами `CloneAccessGrant` (выдача, soft-revoke, продление срока действия). Создана 2026-05-26 в рамках Фазы 7 §9 clone-respond v2.

- **API:** 5 endpoints под `/api/v1/admin/clones/access-grants` (см. [api-layer.md](api-layer.md) §Clones admin), guard `OrgAdminGuard` + `AdminAuditInterceptor` (severity `high` — `reason` обязателен для grant/revoke/extend).
- **Защита:** `CookieAuthGuard` + `OrgAdminGuard`. Permission-gate во фронте через `useAuth` (поверх backend).
- **Фронт:**
  - `frontend/app/(authenticated)/admin/clones/page.tsx`
  - `frontend/app/(authenticated)/admin/clones/ClonesAccessClient.tsx`
  - `frontend/app/(authenticated)/admin/clones/CreateGrantDialog.tsx` — поиск member'а через `orgMembersApi.search` (debounce 250 мс), выбор role-клона из `useClones`, опц. `expiresAt` под кнопкой «Дополнительно».
  - `frontend/app/(authenticated)/admin/clones/RevokeGrantDialog.tsx` — подтверждение soft-revoke с danger-кнопкой.
  - `frontend/app/(authenticated)/admin/clones/ExtendGrantDialog.tsx` — `datetime-local` + чекбокс «бессрочно».
  - `frontend/src/api/admin-clones.api.ts` — 5 методов (list / create / revoke / extend / listByClone).
  - `frontend/src/domain/admin-clone-access-grant.ts` — типы + мапперы + русские лейблы для статус-chip («Активен» / «Отозван» / «Истёк»).
- **Навигация:** новый пункт «Доступы к клонам» (иконка `ShieldCheck`) в разделе «AI и модели» admin-навигации (`frontend/app/(authenticated)/admin/navigation.ts`).
- **Особенности:**
  - Фильтры — `cloneType` select, поиск по имени получателя, toggle «только активные».
  - Таблица с enriched-полями: `cloneLabel`, `userName` / `userEmail`, `grantedBy`, статус, `expiresAt` или «бессрочно».
  - Server-side pagination (`page` + `pageSize=50`).
  - Re-grant поверх revoked — физическое удаление старой записи в транзакции (audit остаётся в `AdminAuditLog`).
  - При `grant` уведомление получателя — `eventType=clone.access_granted` (in-app + Telegram через `ConversationalService`). Notification-failure не откатывает grant (warn-log).
- **ТЗ:** [plans/tz/2026-05-26-clone-access-grant-admin-api.md](../../plans/tz/2026-05-26-clone-access-grant-admin-api.md) + frontend часть в [plans/tz/2026-05-26-clones-marketplace-frontend.md](../../plans/tz/2026-05-26-clones-marketplace-frontend.md) §2-§3.

## Обратная связь

### `/admin/feedback` — Канал обратной связи + AI-кластеризация

Дашборд блоков (`FeedbackTopic`) с процентами по объёму items. Только для super_admin Z (фича глобальная — фидбэк адресован команде Z, а не Org'е).

- **API:** `GET /api/v1/admin/feedback/topics` + items + actions + `POST /admin/feedback/digest/run` (см. [api-layer.md](api-layer.md)).
- **Защита:** `CookieAuthGuard` + `SuperAdminGuard`.
- **Фронт:**
  - `frontend/app/(authenticated)/admin/feedback/page.tsx`
  - `frontend/app/(authenticated)/admin/feedback/FeedbackDashboardClient.tsx`
  - `frontend/app/(authenticated)/admin/feedback/[topicId]/` — детальная карточка блока + items + действия
  - `frontend/app/(authenticated)/admin/feedback/components/` — диалоги rename / merge / archive (Phase 8)
  - `frontend/src/api/admin-feedback.api.ts`
  - `frontend/src/domain/admin-feedback.ts`
- **Особенности:**
  - Дашборд показывает блоки в порядке убывания % от общего числа items.
  - Действия: rename / merge (склейка с другим topic) / archive / unarchive.
  - Отдельная страница «Failed-сообщения» (`GET /admin/feedback/messages/failed`) — сообщения, на которых AI 3+ раза падал.
  - Ручной запуск ночного прогона — `POST /admin/feedback/digest/run` (BullMQ-job в очередь `core.feedback-digest`).
- **ТЗ:** [plans/tz/2026-05-25-user-feedback-with-ai-clustering.md](../../plans/tz/2026-05-25-user-feedback-with-ai-clustering.md). Полная заметка фичи — [[feedback]].
