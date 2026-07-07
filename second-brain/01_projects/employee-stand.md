# Стенд сотрудника (`/me`) — универсальный task-centric дашборд

> Статус: **в работе** (бэкенд ~60%, фронт не начат). Ветка `work/2026-07-02`.
> Планы: аналитика источников [`plans/analysis/2026-07-06-employee-stand-datasources.md`](../../plans/analysis/2026-07-06-employee-stand-datasources.md) · блюпринт [`plans/architecture/2026-07-06-employee-stand.md`](../../plans/architecture/2026-07-06-employee-stand.md) (approved) · ТЗ [`plans/tz/2026-07-06-employee-stand.md`](../../plans/tz/2026-07-06-employee-stand.md).

## Что это
Пересобранный стенд рядового сотрудника (роль `manager`) по образцу директорского дашборда, но про одного человека и про задачи. Всё = `Issue`. Три слоя: **обложка-письмо «Твой день»** → **борд задач по состояниям** → **ленты блокеров/идей в конце**. Плюс «Кора за ночь», «на твоей стороне», «ты двигаешь». Прототип — `scratchpad/site/index.html` (директорское стекло).

## Ключевые решения
- **Письмо — веером по одному на человека** (не один общий запрос): изоляция приватности + влезает в токены + устойчивость к сбою. Общий **статический системный префикс кэшируется** (DeepSeek prompt-cache, цена 1/10); веер идёт подряд, чтобы кэш был тёплым.
- **Письмо на `deepseek-v4-pro`** (маршрут `personal-day-narrative`): flash нестабильно соблюдает строгую json_schema (эксперимент на «Стреле»: 3/6 сломанных → PRO 6/6 полных).
- **Никакого настроения/конфликтов в письме** — данные физически не кладутся в пакет + запрет в промпте (`stripSentimentForRole` не нарушаем).
- **Вход письма = разобранный слой графа + AI-резюме встреч человека** (не сырые чаты): commitments/blockers/voice/tasks/checkins/meetings/load/contribution по personId/userId.
- **Ленты блокеров/идей компании открыты рядовому** (решение владельца) — с гейтом приватности закрытых групп.

## Что построено (Фазы 0–4b)
- **Фаза 0 (хотфикс безопасности):** закрыт обход RBAC в `PendingActionsService.confirm{intake,conflict}` (теперь `canWrite`) + `IntakePendingProvider` показывает рядовому только свои suggested intake. Тесты 54/54.
- **Фаза 1 (миграция):** модель `PersonalDayNarrative` + `Issue.methodCapturedAt`. ⚠️ AGE search_path — `SET search_path TO public` в migration.sql (см. [[prisma-migration-age-searchpath]]).
- **Фаза 2:** 6 крутилок AdminSetting (`me.tasks.doneWindowDays`, `operations.personal_day_narrative.{enabled,evening_hour}`, `operations.self_signals.plan_not_closing_streak_days`, `knowledge.expertise.self_{max_blocks_scanned,top_k}`).
- **Фаза 3 (агент письма):** `personal-day-narrative` — промпт (`operations/prompts/`), taskType в `LlmRouter`, `PersonalDayNarrativeService` (пакет 6 источников + LLM с fallback + upsert), `PersonalDayNarrativeCron`, DTO, `GET /me/day-letter` + `POST /me/day-letter/:id/opened`. Проверен экспериментом на «Стреле».
- **Фаза 4:** борд задач `GET /me/tasks/buckets` (`IssuesService.findMyTaskBuckets` — 4 букета) · `GET /me/tasks/method-capture-pending` + запись `methodCapturedAt` из probe (`ProbeResponseHandler`) · `GET /me/load` + `/me/stuck` (`MyExecutionDashboardController`, self-срез) · `GET /me/check-ins/plan-signal` (`DailyCheckInService.getPlanNotClosingStreak`) · `GET /me/expertise` (`PersonExpertiseService`, авторство через `IdeaBlockEvidence.authorPersonId`).

## Что построено (Фаза 5 — весь backend `/me/*`)
- `GET /me/night-ledger` (Кора за ночь: авто-черновики + задачи из встреч self + ответы клона) · `GET /me/requires-you` (**решения-без-задачи + мои просроченные обещания** — отдельным эндпоинтом, НЕ через pending-actions: интеграция в общий inbox сильно связана — enum/bySource/snoozed/confirm-switch — отложена, фронт совмещает с probe/intake) · `GET /me/clone-impact` (окупаемость клона) · `GET /me/company-blockers` (лента компании + isMine) + `GET /me/company-ideas` (топ + myIdeasThisMonth).

## Фронт (Фаза 6)
Экран **`/me/stand`** (`app/(authenticated)/me/stand/`): обложка-письмо (вердикт+4 оси+секции) · борд задач 4 колонки (карточка → `Link /issues/{id}`, **клик→трекер работает**) · «требует тебя» · «Кора за ночь» · ленты блокеров (isMine выделен) / идей · трастовый футер. API-слой `src/api/me-stand.api.ts` + домен `src/domain/me-stand.ts` (12 вызовов, SWR по `currentOrgId`). Токены oklch (accent уже мятный — совпадает с прототипом). Typecheck 0 ошибок.

## Посадка и навигация (сделано)
- **Вход сотрудника → сразу стенд:** login (не-суперадмин) → `/dashboard` → `DashboardRouter` разводит по роли: рядовой (`manager`/`coo`) → `/me/stand`, босс (`owner`/`admin`) → директорский дашборд. То же после онбординг-смены пароля. ⚠️ Побочно: босс теперь приземляется на директорский дашборд (был журнал встреч) — это его «домой» (лого сайдбара тоже ведёт на `/dashboard`).
- **Меню сотрудника:** в `MY_SECTION` (roles: manager) старый пункт `/me` «Сегодня» заменён на **`/me/stand` «Мой день»**; мобильный таб `today` тоже → `/me/stand`. Старый /me-хаб убран из меню сотрудника (остаётся у лидеров в `PERSONAL_SECTION`). nav-тест 8/8.

## Осталось (опц. follow-ups)
Интеграция requires-you в pending-actions (единый inbox); приватность-гейт закрытых групп для company-blockers (владелец решил «показывать всё»); детализация UI-карточек «на твоей стороне»/«ты двигаешь» (эндпоинты load/stuck/plan-signal/expertise/clone-impact готовы); Playwright-сверка с прототипом (нужен dev-сервер + тест-логин).

## Связи
Директорский дашборд — [[director-dashboard]] (образец агента `operations-daily-digest`). Захват метода → клоны (мостик probe→skill). Роль сотрудника = `manager` (не `member`).
