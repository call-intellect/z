---
type: execution-plan
phase: 8
feature: knowledge-core — дашборд директора (owner-вид)
status: in_progress
date: 2026-05-10
---

# Фаза 8 — execution

Реализация по [plans/tz/2026-05-10-phase-8-director-dashboard.md](tz/2026-05-10-phase-8-director-dashboard.md).
Backend (шаги 1-2) + Frontend (шаги 3-5) — закрыты. Документация (шаг 6) — оркестратор.

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

## Frontend

- [x] **Шаг 3 — frontend domain + API-клиент.**
  - `frontend/src/domain/director-dashboard.ts` — типы `DirectorDashboardApi/Domain`, mapper, лейблы (`signalTypeLabel`, `entityTypeLabel`, `SIGNAL_COUNTERS_BUCKET_LABELS`/`COLORS`/`ORDER`). Включает опциональный `strategicAlignment` (Phase 9 — DTO уже расширен бэкендом, FE-виджет — отдельная фаза).
  - `frontend/src/api/dashboard.api.ts` — `dashboardApi.getDirectorView(period)`.
  - `frontend/src/domain/theme.ts` — добавлен публичный alias `parseBranchSafe` (переиспользуется в `director-dashboard.ts`).
- [x] `bun run typecheck` — зелёный.
- [x] Коммит `feat(knowledge-core): фаза 8 шаг 3 — frontend domain + dashboard.api` (`ad6caed`).

- [x] **Шаг 4 — frontend split: page + DirectorDashboardClient.**
  - `frontend/app/(authenticated)/dashboard/page.tsx` — server-обёртка с metadata, рендерит `<DashboardRouter>`.
  - `frontend/app/(authenticated)/dashboard/DashboardRouter.tsx` — client-компонент. На `useAuth().isLoading` — `null` (избегаем «прыжка» с manager-вида). Решает: `isSuperAdmin || currentOrgRole IN ('owner','admin')` → `<DirectorDashboardClient>`, иначе → существующий `<DashboardClient>` (manager-вид) — НЕ изменяется.
  - `frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx`:
    - State `data: DirectorDashboardDomain | null`, `loading`, `period: 'week'|'month'`, `error`. На mount + при смене `period` — fetch.
    - Header: приветствие, переключатель `Неделя | Месяц`, кнопка «Обновить» (рефетч).
    - Опциональный блок `narrativeSummary` (Sparkles + подпись «AI-сводка, может содержать ошибки»).
    - 5 виджетов на shadcn `Card`: «Что узнали за период» (две колонки — новые темы + новые сигналы), «Сигналы клиентов» (горизонтальная гистограмма по `signalCounters` + tooltip «Подборка vNext»), «Активные темы», «Главные сущности» (disabled-страница vNext, tooltip), «Открытые вопросы» (Q&A-формат).
    - Skeleton loading state на каждом виджете, empty state с подсказкой.
    - **Якорь для Phase 9 strategicAlignment widget:** комментарий `{/* TODO Phase 9 strategicAlignment widget here */}` сразу после 5-го виджета, перед AI-чатом — там будет рендериться 6-й виджет. `data.strategicAlignment` уже маппится в domain.
    - Inline AI-чат заменён на `<OrgChatPanel withHistory={false} height="400px">` (см. шаг 5).
- [x] `bun run typecheck` — зелёный.
- [x] Коммит `feat(knowledge-core): фаза 8 шаг 4 — frontend split + DirectorDashboardClient` (`097d1bf`).

- [x] **Шаг 5 — общий `<OrgChatPanel>` компонент.**
  - `frontend/src/ui/components/chat/OrgChatPanel.tsx` — props `{withHistory?, height?, placeholder?, intro?, className?}`. Использует `chatApi.askV2({scope:'org', query})` + `chatApi.historyGlobal()`. Graceful fallback на legacy `chatApi.sendGlobal` при `chat_v2_disabled`.
  - `frontend/app/(authenticated)/chat/ChatClient.tsx` — теперь тонкая обёртка над `<OrgChatPanel withHistory />`.
  - `<DirectorDashboardClient>` — внутри секции «Спросите про вашу компанию» рендерит `<OrgChatPanel withHistory={false} height="400px">`.
- [x] `bun run typecheck` — зелёный.
- [x] Коммит `refactor(knowledge-core): фаза 8 шаг 5 — общий <OrgChatPanel> переиспользуется в /chat и /dashboard` (`65d6405`).

## Не входит (этого слайса)

- Шаг 6 ТЗ — документация (`second-brain/`, обновление `module-map.md`/`frontend-pages.md`/`api-layer.md`/`director-dashboard.md`) — оркестратор делает в финальной рефлексии.

## Открытые вопросы / отклонения

- `LlmRouterService` метод называется `call`, не `invoke` (в ТЗ указан `invoke`). Используем фактическое имя метода.
- `dashboard-summary` route уже создан seed-скриптом `seed-llm-task-routes-knowledge-core.ts` (Фаза 0). patch-script в шаге 2 — идемпотентный upsert (если запись уже есть — `update: {}` оставляет её нетронутой).
- `bun run build` (frontend) красный из-за коллизии `app/(admin)/admin/page.tsx` vs `app/(authenticated)/admin/page.tsx` — обе route-группы резолвятся в `/admin`. **Это НЕ результат Фазы 8 frontend** — конфликт существовал и до моих правок (видимо появился при Phase 7 admin). `bun run typecheck` — зелёный (что является основным критерием в ТЗ). Фикс конфликта route-групп — отдельная задача (предположительно: удалить дублирующую `(admin)/admin/page.tsx` после миграции на `(authenticated)/admin`).
- Phase 9 хук в DirectorDashboardClient: domain-модель уже маппит `strategicAlignment`, в JSX виджетов есть комментарий-якорь `{/* TODO Phase 9 strategicAlignment widget here */}`. Frontend-агенту Phase 9 достаточно вставить в это место собственный `<StrategicAlignmentWidget data={data?.strategicAlignment} loading={loading}/>`.
