---
type: reflection
date: 2026-05-25
distilled: false
---

# Редизайн админки Z — оркестрация Фаз 0-9

## Что было поставлено

Перестроить глобальную админку Z (`/admin/*`) из плоского сайдбара (~18 пунктов, разрозненные `/admin/usage/*`, `/admin/economics/*`, `/admin/ai-models/*`) в двухуровневый сайдбар на 8 категорий × 36 разделов с модульным блоком вкладок и Cmd+K-палитрой. Вынести ~140 тюнинг-ENV-переменных в БД (`AdminSetting`) с UI-редактированием. Добавить разделы, которых не было: журнал super_admin, инциденты, кроны, воркеры, тарифы (`Plan`), email-шаблоны, feature flags, RetentionPolicy, system-messages.

Источник: [`plans/tz/2026-05-25-admin-redesign-tz.md`](../../plans/tz/2026-05-25-admin-redesign-tz.md).

## Как решал

**Оркестрация:** 10 фаз (0-9), по 1 коммиту на фазу, 11 коммитов суммарно (0 — фундамент, 1-8 — функциональные категории, 9 — финальная полировка). На каждой фазе — 2 параллельных subagent'а (backend + frontend), затем факт-чек грепами в коде до commit.

**Память про лживых агентов** (`feedback_agents_can_lie_about_edits`): после каждого agent'а грепал ключевые маркеры в файлах (импорты, имена сервисов, контроллеры). Несколько раз ловил «галочки в TZ без реальных Edit'ов».

**Память про параллельные сессии** (`feedback_parallel_sessions_git_check`): перед каждой волной — `git fetch + git log --since=1h` на дубли с других Claude Code сессий.

**Память про многоволновую оркестрацию** (`feedback_orchestration_no_stop_between_waves`): зелёная верификация → commit → следующая волна в том же ответе; push после каждой фазы — с подтверждением владельца.

**Ключевые архитектурные решения:**
- `AdminSettingsService` поверх LRU TTL 30s (для security/retention — 5s) + Redis pub/sub канал `admin:setting:invalidate` — снимает деплой-зависимость для тюнинга без потери производительности.
- `TypedConfigService.getDynamic<T>(key, fallbackEnvKey?, default?)` — единая точка чтения; синхронный `get()` остался для bootstrap-критичных PORT/DATABASE_URL.
- `CronManagerService.onModuleInit()` после bootstrap читает `@Cron`-декораторы из `SchedulerRegistry` и переподписывает их при наличии БД-override. При ошибке БД — fallback на дефолты, ERROR-лог.
- BullMQ-инспектор через `@bullmq/api` (`getJobCounts`, `getFailed`, `Job.retry`, `Queue.pause/resume`). DLQ — отдельная вкладка (failed старше 24ч).
- Email-шаблоны: bootstrap-sync из `mail.templates.ts` → БД, валидация Handlebars-AST на save, обязательная тестовая отправка перед активацией.

**Phase 9 (финальная полировка):**
1. `/admin/ai-usage` → 308-redirect на `/admin/analytics/functions` (через `permanentRedirect`).
2. Удалён пункт «AI-вызовы (legacy)» из `navigation.ts` + неиспользуемый импорт `Bot`.
3. Унификация period-селекторов: UI-state переведён на `day/week/month` с mapper'ом `periodToApi` к legacy `24h/7d/30d` для API-вызова (`adminAiModelsApi.metrics` пока ждёт legacy). Затронут `RoutingDetailClient.tsx`.
4. Финальная миграция оставшихся `useEffect+useState+fetchData` на `useAdminQuery`: `PromptsListClient.tsx`, `AiModelsClient.tsx`.
5. Полное переписывание [admin-z-global.md](../01_projects/admin-z-global.md) под новую ИА.
6. Создание сопутствующих заметок: [admin-settings.md](../01_projects/admin-settings.md), [admin-crons.md](../01_projects/admin-crons.md), [admin-workers.md](../01_projects/admin-workers.md), [admin-content.md](../01_projects/admin-content.md).
7. Обновление [module-map.md](../02_architecture/module-map.md) (раздел «Admin Redesign — Фазы 0-9») и [api-layer.md](../01_projects/api-layer.md) (раздел «Admin (Z-Admin) — новые эндпоинты Фаз 0-9»).
8. Обновление [index.md](../index.md) — admin-z-global + 4 sub-bullet'а в раздел «Проекты».

## Что вышло

- **11 коммитов**, по 1 на фазу.
- **8 категорий × 36 разделов** в новом сайдбаре; все URL открываются без 404 (включая legacy 308-redirect'ы для `/admin/ai-usage`, `/admin/usage/*`, `/admin/economics`).
- **~140 ENV** мигрированы в `AdminSetting` (помечены `@deprecated` в env.schema.ts).
- **~150 unit/integration тестов passed**.
- Финальный typecheck чистый на обоих модулях (`backend && bun run typecheck`, `frontend && bun run typecheck`).
- Финальный build (`bun run build`) проходит на обоих модулях.
- Lint: фронт — 0 errors / 0 warnings; бэк — pre-existing baseline (110 errors, 1737 warnings; не от файлов редизайна).
- Phase 9 миграция: 2 файла переведены с `useEffect+useState` на `useAdminQuery` (PromptsListClient, AiModelsClient); period-селектор унифицирован в 1 файле (RoutingDetailClient — единственный, где UI-state был на `24h/7d/30d`; родительский TaskTypeDetailsClient не входил в scope Фазы 9 и оставлен как есть).

## Чему научился

**Для дистилляции в `02_architecture/code-pitfalls.md`:**
- Pattern «BD-override + LRU + Redis pub/sub + ENV-fallback» снимает деплой-зависимость для тюнинга без потери производительности. Работает для любых «крутилок» — порогов AI, лимитов, retention.
- `getDynamic` обязательно делать `async` и не ломать синхронный `get()` — bootstrap-критичные значения (PORT, DATABASE_URL) ДОЛЖНЫ быть синхронными.
- `CronManagerService` должен fallback на @Cron-декораторы при ошибке БД — иначе сломанная БД блокирует все cron-задачи. Дефолты всегда работают.
- Handlebars-шаблоны в БД — нужно валидировать AST на save через `handlebars.precompile()` + обязательно тестовая отправка до активации; иначе один невалидный шаблон сломает все письма.

**Для дистилляции в feedback (поведенческое):**
- При больших оркестрациях факт-чек после каждого agent'а через грепы — обязателен. `[x]` в TZ-файле не равно реальным правкам кода.
- Period-селекторы UI лучше держать на оси `day/week/month` (близкая к human-readable Russian), а к API-ожиданиям маппить через явный `periodToApi()` — это даёт независимость UI от legacy-API.
- Когда мигрируешь файл с `useEffect+useState+useCallback fetchData` на `useAdminQuery`, типичная ошибка — оставить `q.data ?? []` в зависимостях `useMemo`. Решение: оборачивать в свой `useMemo(() => q.data ?? [], [q.data])` для стабильной ссылки.

**Для дистилляции в `feedback_admin_redesign_lessons.md` (TBD при росте >1 повтора):**
- Паттерн «coordinate бэкенд+фронт через параллельных subagent'ов в рамках одной фазы» — работает, если выдержать: (1) детальный per-agent prompt с явным списком файлов, (2) явный re-Read после каждого Edit'а в agent'е, (3) git-status в отчёте, (4) факт-чек грепами после.
- AdminSettings + Redis pub/sub снимает деплой-зависимость для тюнинга — это архитектурный паттерн, который имеет смысл переиспользовать вне админки (например для feature flags на стороне `OrgEntitlement`).
