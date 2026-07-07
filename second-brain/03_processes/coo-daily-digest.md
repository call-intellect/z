---
name: coo-daily-digest
title: Ежедневный отчёт операционного директора (AI-COO)
trigger_type: cron
status_overall: implemented
last_audited: 2026-05-29
owners_human:
  - продакт операционного директора
related_plans:
  - plans/archive/2026-05-25-sba-beta-8-3-coo-daily-and-doelka.md
related_projects:
  - 01_projects/director-dashboard.md
  - 01_projects/ai-jobs.md
  - 01_projects/workers-queues.md
---

# Ежедневный отчёт операционного директора (AI-COO)

> **Как читать:** разделы 1–4 — для не-программиста. Раздел 5 — для разработчика. Номера шагов синхронизированы.

## 1. О чём это (бытовой рассказ)

Каждое утро в 07:00 по Москве платформа «прочитывает» весь прошедший день и сама пишет владельцу и операционному директору короткий **отчёт о пульсе компании** — не сухой дамп цифр, а связный текст в стиле «как прошёл день». Это утренний свод: руководитель начинает день с готовой картины, а не читает отчёт глубокой ночью. Что было в чек-инах команды (зелёные/жёлтые/красные настроения), какие новые блокеры появились, какие обещания просрочены, какие цели сдвинулись, какие инсайты-проблемы всплыли впервые, какие решения приняли.

Этот отчёт — первая ласточка AI-операционного директора. Он не управляет вместо человека, но **позволяет владельцу за минуту понять «что происходит в компании»**, не открывая десяток дашбордов и не дёргая людей. Отчёт приходит в Telegram (если включена доставка) и параллельно лежит на странице `/dashboard/operations/daily` для тех, кто хочет посмотреть детали — графики причин проблем, оценку зрелости компании по доменам.

В отличие от других процессов, здесь **почти всё реализовано как задумано**. Это самый «зрелый» процесс из трёх эталонных — ТЗ от 2026-05-25 закрыто полностью, три волны (бэкенд + причинная карта + виджет зрелости) задеплоены и описаны в рефлексии. Точки роста: проверить интеграцию ссылок в сайдбаре и админ-тумблеры в платформе.

## 2. Что запускает (триггер)

- **Тип:** cron-расписание.
- **Что инициирует:** наступление 07:00 МСК (Europe/Moscow) — каждое утро.
- **Технический источник:** `@Cron('0 7 * * *', { timeZone: 'Europe/Moscow' })` в `OperationsDailyDigestCron`, плюс ручной endpoint `POST /api/v1/dashboard/operations/daily-digest/generate?date=YYYY-MM-DD` для отладки/перегенерации.

## 3. Шаги процесса (общий список)

1. **Сработал cron в 07:00 МСК**, платформа решает: фича включена глобально или нет (через тумблер `AdminSetting`).
2. **Для каждой компании по очереди** платформа собирает данные за прошедший день — чек-ины, новые блокеры, просроченные обещания, сдвинутые цели, новые сигналы-проблемы, принятые решения.
3. **Считаются базовые показатели** — доли зелёных/жёлтых/красных настроений, топ-3 самых тревожных чек-инов, разрезы инсайтов по причинам (8 категорий).
4. **LLM пишет связный текст отчёта** — markdown на 200-450 слов плюс отдельное короткое саммари в 3-4 предложения.
5. **Отчёт сохраняется в базу** (одна запись на компанию на дату), записывается путь промпта-маршрута для трассировки модели.
6. **Если включён тумблер доставки** — отчёт отправляется в Telegram всем, у кого роль `owner` или `coo` (роль `admin` исключена — это IT-роль, не бизнес-stakeholder); параллельно создаётся in-app уведомление.
7. **Утром владелец читает отчёт** в Telegram или открывает страницу `/dashboard/operations/daily` с полной версией, графиками и кнопкой «перегенерировать».

## 4. Что получается на выходе

- **Запись в БД:** `DailyOperationsDigest` (одна на пару `tenantId + dateLocal`).
- **В Telegram:** `coo` + `owner` получают короткое саммари (с обрезкой до 2000 символов на лимит Telegram).
- **В платформе:** in-app `Notification` с типом `operations.daily_digest`.
- **Страница UI:** `/dashboard/operations/daily` — picker даты, короткое саммари, markdown полного отчёта, 6 счётчиков-метрик, списки сущностей, кнопка перегенерации (видна admin/super_admin).
- **Виджеты на главной операционной странице:** `CauseCategoryMapWidget` (8 категорий причин), `MaturityWidget` (кольцевой индикатор зрелости + слабые/сильные домены).

## 5. Технический разрез (по шагам)

| # | Шаг | Что делает технически | Где живёт код | Очередь / cron / эндпоинт | Записывает в БД | Статус |
|---|---|---|---|---|---|---|
| 1 | Cron-триггер | `@Cron('0 7 * * *', { timeZone: 'Europe/Moscow' })`, перед запуском проверяет `AdminSetting('operations.daily_digest.enabled')` (fallback ENV `COO_DAILY_DIGEST_ENABLED`, default `true`) через `TypedConfigService.getDynamic()` | `backend/src/modules/operations/workers/operations-daily-digest.cron.ts:26` | cron `0 7 * * *` МСК (Europe/Moscow) + ручной `POST /api/v1/dashboard/operations/daily-digest/generate` | — | ✅ |
| 2 | Сбор данных по Org | Цикл по Org с фичей; вычисление окна `[dayStart, dayEnd]` в UTC для МСК-даты; параллельно 6 SQL: `DailyCheckIn` (топ-3 красных), `IdeaBlock` (новые блокеры), `IdeaBlock` (просроченные commitment), `Goal` (со сменой статуса), `Insight` (severity='high'), `Decision` | `backend/src/modules/operations/services/daily-digest.service.ts:259..443` (`aggregate`), `operations-daily-digest.cron.ts:120` | inline в cron | (читает) | ✅ |
| 3 | Базовые показатели | Доли green/yellow/red, топ-3 красных чек-инов, агрегация по `causeCategory` (8 категорий: process_gap, tooling, role_skill, communication, priority, resource_constraint, external, unknown); зрелость считается отдельным cron'ом | `daily-digest.service.ts (computeMetrics)`, `backend/src/modules/company-foundation/workers/maturity-scorer.cron.ts` (отдельный cron `0 5 * * *` для `coo_company_maturity_score`) | inline + параллельный cron | — | ✅ |
| 4 | LLM-вызов | taskType `operations-daily-digest` с цепочкой deepseek-v4-pro → gpt-5.4-mini → kie/gemini-3.1-pro (маршрут «День компании v2 Ф5», `patch-daily-digest-route-deepseek-pro-gpt-kie.ts`); промпт версии `prompt-v1`; вход — `DailyDigestAggregates`; выход — markdown 200-450 слов + `---SHORT_SUMMARY---` + 3-4 предложения; `maxTokens=4000`; при отказе LLM — `buildFallbackDigestMarkdown()` с `llmTaskRouteId=null` | `daily-digest.service.ts:168..198`, промпт `backend/src/modules/operations/prompts/daily-digest.prompt.ts:1..215` | LLM-router | — (готовит payload для шага 5) | ✅ |
| 5 | Сохранение в БД | `upsert` по `[tenantId, dateLocal]`: `bodyMarkdown`, `metricsJson`, `sourcesJson`, `llmTaskRouteId`, `shortSummary`; **deliveredAt не обнуляется** при повторной генерации | `daily-digest.service.ts:201` | — | `DailyOperationsDigest` (`backend/prisma/schema.prisma:5954..5980`) | ✅ |
| 6 | Доставка в Telegram + in-app | Через `ConversationalService.sendNotification(eventType='operations.daily_digest')`; получатели — все Membership роли `owner`+`coo` (НЕ `admin`); тумблер `operations.daily_digest.deliver_to_telegram` (default false); shortSummary обрезается до 1999 символов; in-app уведомление параллельно | `operations-daily-digest.cron.ts:214..275` (`notifyRecipients`), `conversational.service.ts` | `conversational.send` | `Notification`, `DailyOperationsDigest.deliveredAt` | ✅ |
| 7 | Просмотр пользователем | 3 REST + страница: `GET /api/v1/dashboard/operations/daily-digest?date=YYYY-MM-DD` (контроллер, RBAC `coo|owner|admin|super_admin`), `GET .../latest`, `POST .../generate` (только admin/super_admin) | `backend/src/modules/operations/controllers/daily-digest.controller.ts:54,81,103`, `frontend/app/(authenticated)/dashboard/operations/daily/page.tsx`, `DailyDigestClient.tsx:1..408` | REST | — | ✅ |

### 5.1 Структура данных

```
Cron 07:00 МСК (Europe/Moscow)
  ↓
for each Org (где включена фича):
  ↓
DailyDigestAggregates {
  totalCheckIns, green/yellow/redShare,
  topRedCheckIns[], newBlockers[], overdueCommitments[],
  goals: {completed, failed, activated},
  newHighInsights[], decisions[]
}
  ↓ LLM operations-daily-digest
{ bodyMarkdown, shortSummary, llmTaskRouteId }
  ↓ upsert
DailyOperationsDigest(tenantId, dateLocal) — UNIQUE
  ↓ ConversationalService.sendNotification
Notification (in-app) + outbound в conversational.send → Telegram (если тумблер)
  ↓
DailyOperationsDigest.deliveredAt
```

### 5.2 LLM-вызовы

| Шаг | taskType | Primary | Fallback | Где промпт | Версия |
|---|---|---|---|---|---|
| 4 | `operations-daily-digest` | deepseek-v4-pro | gpt-5.4-mini → kie/gemini-3.1-pro | `backend/src/modules/operations/prompts/daily-digest.prompt.ts` | `prompt-v1` |

### 5.3 Обогащённые секции дайджеста (v2)

Помимо базового набора (green/yellow/red, топ-3 красных, `causeCategory`) `DailyOperationsDigestDto` отдаёт дополнительные секции (`backend/src/modules/operations/dto/daily-digest.dto.ts`):
- **Вердикт по осям** — `verdict.axes` (team / clients / execution): краткая оценка по каждому направлению.
- **Кто выделился / кому тяжело** — `whoShined[]` / `whoStruggled[]` (по чек-инам и активности людей).
- **Клиенты под риском** — `customersAtRisk[]`.
- **Хронические блокеры** — `chronicBlockers[]`, мост из процесса детекции блокеров (`blocker-synthesis`).
- **Недельный тренд** — `trend[]` (динамика day-over-day) + `letter[]` (нарративное «письмо руководителю», `letterJson`).
- **Очередь действий** — `pending-actions` (через `PendingActionsModule`), решения, требующие внимания.

Секции покрыты спеками `daily-digest.who-shined.spec.ts`, `daily-digest.chronic-blockers.spec.ts`, `daily-digest.trend.spec.ts`.

## 6. Точки отказа и наблюдаемость

**Prometheus метрики** (зарегистрированы в `backend/src/common/metrics/business-metrics.service.ts:2057..2084,4751..4820`):
- `coo_daily_digest_generated_total{tenant_top}` — Counter, успешные генерации
- `coo_daily_digest_failed_total{tenant_top, reason}` — Counter, reason ∈ `exception|aggregation_failed|llm_failed|notify_failed`
- `coo_daily_digest_delivered_total{tenant_top, channel}` — Counter, channel ∈ `conversational|telegram`
- `coo_daily_digest_age_seconds{tenant_top}` — Gauge, возраст последнего отчёта (тревога при >25 ч)
- `coo_insights_by_cause_total{tenant_top, cause}` — Gauge, 8 категорий + unknown
- `coo_company_maturity_score{tenant_top}` — Gauge, 0..1

**BullMQ очереди:**
- `conversational.send` — исходящие сообщения в Telegram и in-app

**Тумблеры (`AdminSetting`):**
- `operations.daily_digest.enabled` — глобальное включение фичи (fallback ENV `COO_DAILY_DIGEST_ENABLED`, default `true`)
- `operations.daily_digest.deliver_to_telegram` — доставка в Telegram (fallback ENV `COO_DAILY_DIGEST_DELIVER_TO_TELEGRAM`, default `false`)

**Логи:** `OperationsDailyDigestCron`, `DailyDigestService`.

**Кнопки админки:**
- Перегенерация: `POST /api/v1/dashboard/operations/daily-digest/generate?date=YYYY-MM-DD` (только admin/super_admin), кнопка на странице `/dashboard/operations/daily`.
- Тумблеры: должны быть в `/admin/platform/settings` → «COO-операции» (см. расхождение в разделе 8).

**Известные риски:**
- Если LLM-цепочка отвалится — `buildFallbackDigestMarkdown()` сохранит шаблонный markdown без LLM-обогащения, `llmTaskRouteId=null` — это сигнал для аудита.
- Длинная цепочка `for ... of orgs` без батчинга — на большом числе компаний может становиться медленной. Сейчас не критично (компаний мало).

## 7. Связанные процессы

- [[raw-event-to-graph]] — источник данных для `IdeaBlock(signalType='blocker'/'commitment')`, `Insight`, `Decision` (всё, что собирается в шаге 2).
- [[specialist-3-5-insights]] — источник `Insight.severity='high'` и `causeCategory`.
- [[specialist-3-3-decisions]] — источник `Decision.decidedAt`.
- [[notification-dispatch]] — Шаг 6 здесь использует общий dispatcher.
- [[operations-weekly-monthly-digest]] — родственные своды за неделю/месяц (кластер «Пульс и дайджесты»); daily — не единственный дайджест-процесс.
- [[personal-daily-brief]] — утренний персональный бриф C1/C2 (тот же кластер проактивных сводок).

## 8. Расхождения «задумано vs реализовано»

**Заложено в ТЗ — реализовано полностью (Wave 1, 2, 3):**
- Wave 1: cron + service + LLM + REST + frontend + Telegram delivery — ✅
- Wave 2: `causeCategory` в overview + `CauseCategoryMapWidget` + фильтр insights — ✅
- Wave 3: `MaturityWidget` (SVG-кольцо + top/weakest domains) — ✅

**Требует проверки в коде:**
- **Ссылка «Ежедневный отчёт» в сайдбаре** — в ТЗ упомянута, в `AppShell`-сайдбаре статус не подтверждён.
- **Блок-превью на главной `/dashboard/operations`** — должен показывать последний отчёт; реализация через `OperationsDashboardClient` есть, но интеграция с `/latest` endpoint не верифицирована точечно.
- **Admin-панель тумблеры** — в ТЗ описаны переключатели на `/admin/platform/settings` → раздел «COO-операции»; страница админ-настроек существует ([[01_projects/admin-settings]]), но конкретные тумблеры этой фичи не верифицированы.

**Не описано в ТЗ, но реализовано:**
- **Tracing model через `llmTaskRouteId`** — поле в `DailyOperationsDigest`, формат `prompt-v1+<model>`; помогает понять, какая модель сгенерировала каждый отчёт.
- **`buildFallbackDigestMarkdown()`** — code-fallback на случай отказа всей LLM-цепочки. Шаблонный отчёт лучше, чем ничего.
- **`deliveredAt` не обнуляется при upsert** — повторная регенерация не пере-доставляет в Telegram, нужна явная перегенерация через endpoint.

**Связи с другими процессами:**
- `coo_company_maturity_score` считается отдельным cron'ом `0 5 * * *` (08:00 МСК) в `maturity-scorer.cron.ts`, **не внутри** этого процесса. На UI зрелость отображается на той же странице, но как независимая метрика.
- `coo_insights_by_cause_total` рассчитывается в `OperationsDashboardService.overview()` (недельное окно), **не внутри** daily-digest. На странице `/dashboard/operations/daily` используется метрика последнего пересчёта.

## 9. История изменений процесса

| Дата | Что изменилось | Коммит/рефлексия |
|---|---|---|
| 2026-05-29 | Карточка создана | этот документ |
| 2026-05-25 | Wave 3: `MaturityWidget` frontend | `c087b2f` |
| 2026-05-25 | Wave 2: backend `causeCategory` + maturity | `471cfbb` |
| 2026-05-25 | Wave 1: backend ежедневного отчёта | `a9c0a96` |
