---
type: execution-plan
phase: 8
feature: knowledge-core — дашборд директора (owner-вид)
status: in_progress
date: 2026-05-10
---

# Фаза 8 — execution

Реализация по [plans/tz/2026-05-10-phase-8-director-dashboard.md](tz/2026-05-10-phase-8-director-dashboard.md).
Текущий слайс — backend (шаги 1-2). Frontend (шаги 3-5) и документация (шаг 6) — следующая итерация.

## Backend

- [x] **Шаг 1 — модуль `dashboard` + сервис + контроллер.**
  - `backend/src/modules/dashboard/dashboard.module.ts`.
  - `services/director-dashboard.service.ts` — `getDirectorView({tenantId, period})`. Внутри 6 параллельных запросов через `Promise.all` (newThemes, newSignals, signalCounters, activeThemes, hotEntities (RAW SQL), openQuestions). Кэш через `AdminCacheService`, ключ `dashboard:director:${tenantId}:${period}`, TTL 60s. `narrativeSummary = null` (заглушка).
  - `dto/director-dashboard.dto.ts` — Zod-схема query + типы DTO.
  - `director-dashboard.controller.ts` — `GET /api/v1/dashboard/director?period=week|month` под `CookieAuthGuard + TenantGuard + RbacService.canViewDirectorDashboard`.
  - Регистрация в `AppModule`.
- [x] **Шаг 1.bis — `RbacService.canViewDirectorDashboard(userId, tenantId)`.** Обёртка над `loadContext` с проверкой `role IN ('owner','admin')` ИЛИ `isSuperAdmin=true`.
- [x] `bun run typecheck` — зелёный.
- [x] Коммит `feat(knowledge-core): фаза 8 шаг 1 — DirectorDashboardService + GET /api/v1/dashboard/director` (`37e54d0`).

- [x] **Шаг 2 — `narrativeSummary` LLM-часть.**
  - `prompts/dashboard-summary.prompt.ts` — system prompt + builder для user-сообщения (топ-3 темы, топ-5 сигналов, счётчики, топ-3 сущности, топ-3 вопроса).
  - `DirectorDashboardService.getNarrativeSummary` — вызов `LlmRouterService.call({taskType: 'dashboard-summary', ...})`, на fail/timeout → `null`. Если виджеты пусты (totalSignals=0 && totalThemes=0) — `null` без LLM-вызова.
  - Кэш narrative: ключ `dashboard:director:narrative:${tenantId}:${period}`, TTL 24h через `AdminCacheService`.
  - Cron `@Cron('0 6 * * *')` `invalidateNarrativeCron` — `cache.invalidate('dashboard:director:narrative:')`.
  - `backend/scripts/patch-dashboard-summary-route.ts` — findFirst+create (защита admin-edited): если запись уже есть, `[skipped]`.
- [x] `bun run typecheck` — зелёный.
- [x] Patch-script запущен — `[created] cmozlirez0001j7k5ci8eroqo`, идемпотентность проверена повторным запуском.
- [x] Коммит `feat(knowledge-core): фаза 8 шаг 2 — narrativeSummary LLM (taskType=dashboard-summary)`.

## Не входит (этого слайса)

- Шаги 3-6 ТЗ — frontend domain/api, DirectorDashboardClient, OrgChatPanel, документация.
- Обновления `second-brain/` — оркестратор делает.

## Открытые вопросы / отклонения

- `LlmRouterService` метод называется `call`, не `invoke` (в ТЗ указан `invoke`). Используем фактическое имя метода.
- `dashboard-summary` route уже создан seed-скриптом `seed-llm-task-routes-knowledge-core.ts` (Фаза 0). patch-script в шаге 2 — идемпотентный upsert (если запись уже есть — `update: {}` оставляет её нетронутой).
