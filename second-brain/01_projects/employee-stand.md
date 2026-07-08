# Стенд сотрудника (`/me`) — универсальный task-centric дашборд

> Статус: **в проде** (бэкенд + фронт готовы; доработка «followup» 2026-07-08 применена). Ветки `work/2026-07-02` → `work/2026-07-07`.
> Планы: аналитика источников [`plans/analysis/2026-07-06-employee-stand-datasources.md`](../../plans/analysis/2026-07-06-employee-stand-datasources.md) · блюпринт [`plans/architecture/2026-07-06-employee-stand.md`](../../plans/architecture/2026-07-06-employee-stand.md) (approved) · ТЗ [`plans/tz/2026-07-06-employee-stand.md`](../../plans/tz/2026-07-06-employee-stand.md) · followup-ТЗ [`plans/tz/2026-07-08-employee-stand-followup.md`](../../plans/tz/2026-07-08-employee-stand-followup.md).

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
- **Фаза 2:** 6 крутилок AdminSetting (`me.tasks.doneWindowDays`, `operations.personal_day_narrative.{enabled,morning_hour}`, `operations.self_signals.plan_not_closing_streak_days`, `knowledge.expertise.self_{max_blocks_scanned,top_k}`). ⚠️ Крутилка часа письма переименована `evening_hour`→`morning_hour` в followup 2026-07-08 (idempotent-patch + реестр + сид).
- **Фаза 3 (агент письма):** `personal-day-narrative` — промпт (`operations/prompts/`), taskType в `LlmRouter`, `PersonalDayNarrativeService` (пакет 6 источников + LLM с fallback + upsert), `PersonalDayNarrativeCron`, DTO, `GET /me/day-letter` + `POST /me/day-letter/:id/opened`. Проверен экспериментом на «Стреле». ⚠️ После followup 2026-07-08 письмо шлётся **утром про вчера** (см. §«Доработка (followup)»).
- **Фаза 4:** борд задач `GET /me/tasks/buckets` (`IssuesService.findMyTaskBuckets` — 4 букета) · `GET /me/tasks/method-capture-pending` + запись `methodCapturedAt` из probe (`ProbeResponseHandler`) · `GET /me/load` + `/me/stuck` (`MyExecutionDashboardController`, self-срез) · `GET /me/check-ins/plan-signal` (`DailyCheckInService.getPlanNotClosingStreak`) · `GET /me/expertise` (`PersonExpertiseService`, авторство через `IdeaBlockEvidence.authorPersonId`).

## Что построено (Фаза 5 — весь backend `/me/*`)
- `GET /me/night-ledger` (Кора за ночь: авто-черновики + задачи из встреч self + ответы клона) · `GET /me/requires-you` (**решения-без-задачи + мои просроченные обещания** — отдельным эндпоинтом, НЕ через pending-actions: интеграция в общий inbox сильно связана — enum/bySource/snoozed/confirm-switch — отложена, фронт совмещает с probe/intake) · `GET /me/clone-impact` (окупаемость клона) · `GET /me/company-blockers` (лента компании + isMine) + `GET /me/company-ideas` (топ + myIdeasThisMonth).

## Фронт (Фаза 6)
Экран **`/me/stand`** (`app/(authenticated)/me/stand/`): обложка-письмо (вердикт+4 оси+секции) · борд задач 4 колонки (карточка → `Link /issues/{id}`, **клик→трекер работает**) · «требует тебя» · «Кора за ночь» · ленты блокеров (isMine выделен) / идей · трастовый футер. API-слой `src/api/me-stand.api.ts` + домен `src/domain/me-stand.ts` (12 вызовов, SWR по `currentOrgId`). Токены oklch (accent уже мятный — совпадает с прототипом). Typecheck 0 ошибок.

## Посадка и навигация (сделано)
- **Вход сотрудника → сразу стенд:** login (не-суперадмин) → `/dashboard` → `DashboardRouter` разводит по роли: рядовой (`manager`/`coo`) → `/me/stand`, босс (`owner`/`admin`) → директорский дашборд. То же после онбординг-смены пароля. ⚠️ Побочно: босс теперь приземляется на директорский дашборд (был журнал встреч) — это его «домой» (лого сайдбара тоже ведёт на `/dashboard`).
- **Меню сотрудника:** в `MY_SECTION` (roles: manager) старый пункт `/me` «Сегодня» заменён на **`/me/stand` «Мой день»**; мобильный таб `today` тоже → `/me/stand`. Старый /me-хаб убран из меню сотрудника (остаётся у лидеров в `PERSONAL_SECTION`). nav-тест 8/8.

## Доработка (followup, 2026-07-08)
ТЗ [`plans/tz/2026-07-08-employee-stand-followup.md`](../../plans/tz/2026-07-08-employee-stand-followup.md), 3 фазы (коммиты `20f4173a` P0 · `e8ac4a31` P1 · `b61d38ca` P2).

- **P0 — письмо «Твой день» перенесено на УТРО про ВЧЕРА.** Было: вечер (крутилка `evening_hour`≈20 МСК), рассказ про сегодня. Стало: **утро** (крутилка `operations.personal_day_narrative.morning_hour`, дефолт 7), разбор **вчерашнего** дня. Крон `PersonalDayNarrativeCron` — `@Cron('0 * * * *', {name:'personal-day-narrative-morning'})`: ежечасный тик, тело работает только в `morning_hour` по таймзоне person, фильтр `relationship='employee' AND userId!=null`, `packageRef = now−24ч` (задачи-вчера/план-факт), а overdue-обещания и «неделя вклада» — от реального `now`. **Итог прохода теперь `logger.log`** (`{generated,skippedOutsideWindow,errors,total}`) + top-level `try/catch`→`logger.error` — раньше итог логировался на `debug` (в проде подавлен) → крон работал «молча», дыра наблюдаемости. Промпт → **`personal-day-v2`** («вчерашний день»; статичный кэш-safe префикс). Контроллер `GET /me/day-letter` дефолт даты → **вчера**. Крутилка `evening_hour`→`morning_hour` (реестр + сид + idempotent-patch `patch-personal-day-narrative-morning-hour.ts`). Новый скрипт `backend/scripts/force-personal-day-narrative.ts` — ручной запуск генерации по SSH (`--tenant`/`--person`/`--all`/`--date`/`--force`).
- **P1 — фронт стенда «на твоей стороне» + «ты двигаешь» + ленты компании.** Бэкенд был готов с Фаз 4–5, не хватало UI. Добавлены блоки **«Кора на твоей стороне»** (`/me/load`, `/me/stuck`, `/me/check-ins/plan-signal`) и **«Ты двигаешь»** (вклад из письма + `/me/clone-impact` + `/me/expertise`). Значок **«🎤 расскажи как делал»** на закрытых задачах с `method-capture-pending`. **Блокеры и идеи компании продублированы с директорского дашборда** — общие примитивы `GlassCard`/`CardTitle`/`StatusPill` из `ui/components/dashboard/modern`, self-scope `/me/company-blockers`+`/me/company-ideas`, пометки «твой»/«твоя» + счётчик идей за месяц.
- **P1 — фикс переатрибуции обещаний.** Обещание из встречи **без говорящего** (диаризация не дала спикера) больше НЕ вешается на загрузившего встречу — source-зависимый guard в `block-ingest.worker.ts` (для чата `authorUserId` сохраняется, гард только для meeting-источника без speaker).
- **P2 (безопасная часть):** баннер «не отчитался за вчера» над бордом (по вечернему чек-ину) + ссылка «Все задачи →».

## Осталось (опц. follow-ups)
**P2-интерактив ОТЛОЖЕН** (нужны продуктовые решения владельца): мутирующие кнопки «Требует тебя» (Ответить / Завести / Перенести), «Напомнить» на блокерах, инлайн-чекбокс «готово» на карточке задачи. Прочее: интеграция requires-you в pending-actions (единый inbox); приватность-гейт закрытых групп для company-blockers (владелец решил «показывать всё»).

## Связи
Директорский дашборд — [[director-dashboard]] (образец агента `operations-daily-digest`). Захват метода → клоны (мостик probe→skill). Роль сотрудника = `manager` (не `member`).
