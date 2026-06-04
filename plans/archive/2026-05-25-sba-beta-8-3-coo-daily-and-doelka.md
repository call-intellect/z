---
type: tz
status: ready
feature: β-8.3 — Доделка операционного директора (ежедневный отчёт + интеграция causeCategory + виджет зрелости компании)
phase: beta-8.3
date: 2026-05-25
parent: plans/tz/2026-05-23-sba-beta-8-personal-relation-coo-checkin.md
related:
  - plans/tz/2026-05-24-sba-beta-8-1-coo-dobivka.md
  - plans/analysis/2026-05-23-ai-coo-readiness-analysis.md
  - backend/src/modules/operations/services/weekly-digest.service.ts
  - backend/src/modules/operations/services/operations-dashboard.service.ts
  - backend/src/modules/knowledge-core/services/specialist-3-5-insights.service.ts
  - backend/src/modules/company-foundation/workers/maturity-scorer.cron.ts
---

> 📦 **АРХИВ (аудит 2026-06-04): ✅ реализовано — 98%.**
> Все три фазы реализованы и подтверждены кодом (модель+миграция, cron, сервис, контроллер с 3 эндпоинтами, LLM taskType, 2 seed-скрипта, ENV, метрики, тесты, фронт-страница+виджеты+API/domain, навигация). Реализация прове
> Полный разбор: `plans/analysis/2026-06-04-tz-audit-reestr-i-prioritety.md`


# SBA β-8.3 — Доделка операционного директора

## 1. TL;DR

Три фазы:

- **Фаза 1.** Ежедневный отчёт COO (`DailyOperationsDigest`) — зеркало `WeeklyOperationsDigest`, окно один день, генерируется глобально в **01:00 МСК** (= 22:00 UTC), доступен на дашборде `/dashboard/operations/daily`, с тумблером рассылки в Telegram админу/директору.
- **Фаза 2.** Интеграция `Insight.causeCategory` во фронтенд: фильтр в API клиенте, цвет/группировка в виджете «Топ-5», новый виджет «Карта причин» на `/dashboard/operations`.
- **Фаза 3.** Виджет «Зрелость компании» на `/dashboard/operations` поверх существующего `CompanyProfile.maturityScore` и `FunctionalDomain.completeness`.

Все три фазы — поверх работающих модулей, без новых архитектурных слоёв. Срок — 1–1.5 недели одним разработчиком.

## 2. Цель и контекст

После реальности-чека 2026-05-25 (см. план-родитель и анализ готовности от 2026-05-23):

1. **Ежедневного отчёта COO в коде нет.** Есть недельный `WeeklyOperationsDigest` (β-8.1). Руководитель утром не получает резюме за вчерашний день в одном месте — приходится открывать четыре виджета и Telegram отдельно.
2. **β-4 `Insight.causeCategory` готова на backend, но фронт не использует.** Поле приходит из LLM с 8 значениями (`process_gap | tooling | role_skill | communication | priority | resource_constraint | external | unknown`), уходит в БД с индексом, отдаётся в REST. Но виджеты не группируют, дашборд COO не показывает «причинную карту» проблем недели.
3. **`CompanyProfile.maturityScore` есть, на COO-дашборде не виден.** `MaturityScorerCron` каждый день в 05:00 UTC пересчитывает зрелость по 8 базовым `FunctionalDomain`, а COO про это узнаёт, только если зайдёт на отдельную страницу `/maturity`.

Цель ТЗ — закрыть три эти дыры одним атомарным заходом.

## 3. Общие принятые решения

| # | Решение |
|---|---|
| 1 | Уровни доступа — единое право `dashboard_operations.read` для всех новых секций (как сейчас). Раздельные права — отдельным ТЗ потом. |
| 2 | Ежедневный отчёт публикуется **на дашборде** + рассылка в Telegram управляется тумблером (`AdminSetting`, без рестарта). |
| 3 | Время генерации ежедневного отчёта — **01:00 МСК (22:00 UTC), глобально**, не per-Org. ICP — РФ, к утру рабочего дня готово во всех часовых поясах страны. |
| 4 | Окно отчёта — «вчерашние сутки в МСК» (от `00:00` до `23:59` МСК предыдущего календарного дня). |
| 5 | Идемпотентность — `@@unique([tenantId, dateLocal])` (дата в МСК, формат `YYYY-MM-DD`). |
| 6 | Доставка в Telegram — через существующий `ConversationalService.sendNotification(eventType='operations.daily_digest')`, реализация подписки — α-1 (готово). |
| 7 | Управление рассылкой Telegram — динамическая настройка `operations.daily_digest.deliver_to_telegram` в `AdminSetting` (через `TypedConfigService.getDynamic`). По умолчанию `false`, чтобы Telegram не молотил сразу после раскатки. |
| 8 | Получатели Telegram-рассылки — все пользователи с ролью `coo`, `owner`, `admin` в данной Org. RBAC уже это покрывает (`canViewOperationsDashboard`). |
| 9 | При отказе LLM — сохраняем «сухой» вариант (структура без связного текста) с `llmTaskRouteId=null`, как в `WeeklyDigestService.generate`. |

## 4. Зависимости

- β-8 (`done`) — `OperationsDashboardService`, `DailyCheckIn`, RBAC роль `coo`.
- β-8.1 (`done`) — `WeeklyDigestService` (использовать как эталон).
- β-8.2 (`done`) — `CommitmentsService.listOpenForTenant` (источник для пункта «открытые обещания» в отчёте).
- α-1 (`done`) — `ConversationalService.sendNotification` + Telegram-канал.
- β-4 (`done` на backend) — `Insight.causeCategory` + REST `?cause_category=...`.
- α-9 (`done` на 90%) — `CompanyProfile.maturityScore` + `FunctionalDomain.completeness`.

---

# Фаза 1 — Ежедневный отчёт COO

## 1.1. Scope

**Входит:**
- Новая модель `DailyOperationsDigest` (зеркало `WeeklyOperationsDigest`, окно один день).
- Глобальный cron `operations-daily-digest.cron`, `@Cron('0 22 * * *')` (= 01:00 МСК).
- Новый LLM taskType `operations-daily-digest` (тройная цепочка).
- Сервис `DailyDigestService` с тем же двухстадийным принципом (агрегат → LLM).
- REST `GET /api/v1/dashboard/operations/daily-digest?date=YYYY-MM-DD` + admin `POST /generate`.
- Доставка в Telegram через `ConversationalService.sendNotification(eventType='operations.daily_digest')` — управляется `AdminSetting` `operations.daily_digest.deliver_to_telegram`.
- Тумблер `AdminSetting` `operations.daily_digest.enabled` (отдельно от ENV-флага, чтобы можно было «погасить» без рестарта).
- Frontend: новая страница `/dashboard/operations/daily` (рендер дайджеста с навигацией по датам) + блок «Вчерашний отчёт» на главной `/dashboard/operations` (краткая выжимка + ссылка на полный).
- В навигации (`frontend/src/ui/components/app-shell/Sidebar.tsx`) — в группе «Операции» новая ссылка «Ежедневный отчёт» рядом с «Недельная сводка».
- Промпт `operations-daily-digest` в `backend/src/modules/operations/prompts/daily-digest.prompt.ts`.
- Унификация: при рассылке через Telegram — markdown усекается до ~2000 символов (Telegram-лимит), полный текст всегда доступен на дашборде.

**Не входит:**
- Per-Org часовой пояс отчёта — отложено (РФ MVP).
- Дайджест отдельным пользователям (Daily for me / per-role) — отдельным ТЗ.
- Email-рассылка — отдельным ТЗ (после Phase 4 трекера, в той же email-инфраструктуре).
- Backfill старых дат — генерируем только начиная с даты раскатки.

## 1.2. Изменение схемы базы

```prisma
model DailyOperationsDigest {
  id              String   @id @default(cuid())
  tenantId        String
  /// YYYY-MM-DD — дата отчёта в МСК (день, ЗА который сделан отчёт).
  dateLocal       String   @db.VarChar(10)
  /// Связный текст комментария от LLM. Markdown (4-6 коротких разделов).
  /// При неудаче LLM — «сухой» вариант со структурой без связного текста.
  bodyMarkdown    String   @db.Text
  /// Структурированные показатели для виджетов: greenShare/yellowShare/redShare,
  /// topBlockers, openCommitments, completedGoals, missedGoals, ...
  metricsJson     Json
  /// Провенанс: id блокеров, чек-инов, обещаний, целей.
  sourcesJson     Json
  /// Идентификатор маршрута/модели LLM (`prompt-v1+<model>`). NULL при сухом fallback.
  llmTaskRouteId  String?
  /// Кратко (1 короткий параграф) — для Telegram-рассылки и блока на главной.
  shortSummary    String?  @db.Text
  /// Telegram-доставка прошла. NULL — ещё не доставлено или выключено.
  deliveredAt     DateTime?
  createdAt       DateTime @default(now())

  tenant Org @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@unique([tenantId, dateLocal])
  @@index([tenantId, dateLocal])
  @@map("daily_operations_digests")
}
```

## 1.3. Источники данных (агрегат)

Окно — `dateLocal` целиком в МСК. Запросы:

| Источник | Что берём |
|---|---|
| `DailyCheckIn` | За `dateLocal`: количество, разрез green/yellow/red, **топ-3 красных** (имя + первые 200 симв. `rawResponseText`, RBAC-фильтр для рассылки уже на стороне доставки). |
| `IdeaBlock signalType='blocker'` | Новые за вчера: топ-5 по severity (high → medium → low). |
| `IdeaBlock signalType='commitment' commitmentStatus IN ('open','asked')` | Просроченные на сегодня: топ-5 (от автора → recipient, `commitmentDueDate`). |
| `Goal` | Те, чей статус изменился вчера (`completed`/`abandoned`/`active`). |
| `Insight` | Новые `severity='high'` за вчера (с `causeCategory`). |
| `Decision` | Принятые / отвергнутые вчера (если есть). |

**Двухстадийная сборка** (как `WeeklyDigestService.aggregate` → `generate`):
1. SQL-агрегаты — быстро.
2. Один LLM-вызов `operations-daily-digest` — собрать связный комментарий + `shortSummary`.

## 1.4. Скрипты миграции

- `backend/scripts/seed-llm-task-routes-beta-8-3.ts` — регистрирует taskType `operations-daily-digest` (DeepSeek → OpenAI `gpt-5.4-nano` → Ollama `qwen3.5:9b`). Сверка с `01_projects/llm-providers-verified.md` обязательна.
- `backend/scripts/seed-admin-setting-daily-digest.ts` — регистрирует два ключа `AdminSetting` (`operations.daily_digest.enabled` = `true`, `operations.daily_digest.deliver_to_telegram` = `false`).
- `bun run prisma:push` после добавления модели + `bun run prisma:generate`.

## 1.5. REST API

`/api/v1/dashboard/operations` (расширение существующего контроллера):
- `GET /daily-digest?date=YYYY-MM-DD` — отдаёт сохранённый дайджест за дату; если её ещё нет — 404. Доступ — `coo | owner | admin | super_admin`.
- `GET /daily-digest/latest` — последний сохранённый. Удобно для блока «Вчерашний отчёт» на главной.
- `POST /daily-digest/generate?date=YYYY-MM-DD` — принудительная (пере)генерация. Доступ — `admin | super_admin`.

DTO `DailyOperationsDigestDto`:
```ts
{
  id: string;
  tenantId: string;
  dateLocal: string;        // YYYY-MM-DD
  bodyMarkdown: string;
  shortSummary: string | null;
  metrics: DailyDigestMetricsDto;
  sources: DailyDigestSourcesDto;
  llmTaskRouteId: string | null;
  deliveredAt: string | null;
  createdAt: string;
}
```

## 1.6. Cron и worker

**`operations-daily-digest.cron.ts`:**
- `@Cron('0 22 * * *')` (= 01:00 МСК ежедневно).
- Тумблер: `AdminSetting.operations.daily_digest.enabled` (через `TypedConfigService.getDynamic`); если `false` — лог `skip` и выход.
- Проход по всем активным `Org` (`deletedAt IS NULL`).
- Идемпотентность: `findUnique({ tenantId, dateLocal })` — если есть, пропуск.
- На каждую Org:
  1. Агрегат через `DailyDigestService.aggregate({ tenantId, dateLocal })`.
  2. LLM через `LlmRouterService.invoke({ taskType: 'operations-daily-digest', tenantId, payload })`.
  3. `prisma.dailyOperationsDigest.create(...)`.
  4. Если `AdminSetting.operations.daily_digest.deliver_to_telegram` = `true` — `ConversationalService.sendNotification({ eventType: 'operations.daily_digest', tenantId, recipientFilter: { roles: ['coo', 'owner', 'admin'] }, payload: { shortSummary, link: '/dashboard/operations/daily?date=...' } })`. Проставить `deliveredAt`.
- Best-effort на каждую Org: ошибка по одной не валит остальные.

**Сервис `DailyDigestService`** — зеркало `WeeklyDigestService`:
- `getStored(args: { tenantId, dateLocal })` — read.
- `getOrGenerate(args)` — read-or-build, идемпотентно.
- `generate(args)` — принудительно (admin).
- `aggregate(args)` — приватный метод сборки сырых показателей.

## 1.7. LLM taskType

```ts
{ taskType: 'operations-daily-digest', priority: 'primary',   provider: 'deepseek', model: 'deepseek-chat' }
{ taskType: 'operations-daily-digest', priority: 'secondary', provider: 'openai',   model: 'gpt-5.4-nano' }
{ taskType: 'operations-daily-digest', priority: 'tertiary',  provider: 'ollama',   model: 'qwen3.5:9b' }
```

Промпт `backend/src/modules/operations/prompts/daily-digest.prompt.ts`:
- Версия `prompt-v1`.
- На вход — `DailyDigestAggregates`.
- На выход — markdown 4-6 коротких разделов:
  1. Температура команды вчера + красные точки.
  2. Новые блокеры за день.
  3. Просроченные обещания (на кого ждём ответа).
  4. Что закрыли / что упустили из целей.
  5. Сигналы (новые high-severity insights).
  6. Что критично взять в руки сегодня (1-2 пункта).
- Дополнительно — `shortSummary` (3-4 предложения для Telegram и блока на главной).

Промпт редактируется из админки (PromptRegistry с code-fallback), как и `operations-weekly-digest`.

## 1.8. Доставка в Telegram

- `ConversationalService.sendNotification(eventType='operations.daily_digest')` — α-1 знает, в какой канал каждому пользователю Org доставлять (in_app / Telegram / email).
- Получатели — все user'ы Org с ролью `coo`, `owner`, `admin` (через RBAC).
- Тумблер `AdminSetting.operations.daily_digest.deliver_to_telegram` — глобальный (на платформу). Если `false`, ничего не отправляем (дайджест всё равно публикуется на дашборде).
- Per-Org override — не делаем (отложено).
- Текст сообщения: `shortSummary` + ссылка-deeplink на `/dashboard/operations/daily?date=YYYY-MM-DD`.

## 1.9. Права доступа

- Существующее право `dashboard_operations.read` покрывает все новые эндпоинты `daily-digest*`.
- Дополнительно — `dashboard_operations.regenerate` (write) для `admin` / `super_admin` на `POST /generate`. Уже есть в `policy.csv` для weekly — добавить аналогичную строку для daily.
- В RBAC `canViewOperationsDashboard` ничего не меняем.

## 1.10. Показатели Prometheus

- `coo_daily_digest_generated_total{tenant_top}` — счётчик удачных генераций.
- `coo_daily_digest_failed_total{tenant_top, reason}` — счётчик неудач.
- `coo_daily_digest_delivered_total{tenant_top, channel}` — счётчик удачных доставок (через `ConversationalService`).
- `coo_daily_digest_age_seconds{tenant_top}` — гейдж: «возраст» последнего дайджеста (now − createdAt). Тревога Grafana при > 25 часов.

## 1.11. Интерфейс

**Новая страница `/dashboard/operations/daily`** (`frontend/app/(authenticated)/dashboard/operations/daily/page.tsx` + `DailyDigestClient.tsx`):
- Date-picker: вчера / выбрать дату / навигация ←→.
- Карточка `shortSummary` сверху.
- Markdown-рендер `bodyMarkdown` (как у weekly).
- Структурированные виджеты ниже: температура за день, топ-блокеры, просроченные обещания, цели.
- Кнопка «Перегенерировать» (видна только admin / super_admin).
- Badge «Не доставлено в Telegram» — если `deliveredAt=null` и `deliver_to_telegram=true`.

**Блок «Вчерашний отчёт» на `/dashboard/operations`** (расширение `OperationsDashboardClient.tsx`):
- Карточка сверху над виджетами «пульса».
- Поля: дата отчёта (YYYY-MM-DD), `shortSummary`, ссылка «Открыть полный отчёт →».
- Если за вчера нет — текст «Отчёт ещё не сгенерирован, проверьте после 01:00 МСК».

**Навигация:** в `Sidebar.tsx` добавить ссылку «Ежедневный отчёт» в группе «Операции», между «Операции» и «Недельная сводка».

**Админка `/admin/platform/settings` — раздел «COO-операции»:**
- Тумблер «Ежедневный отчёт включён» (`operations.daily_digest.enabled`).
- Тумблер «Слать ежедневный отчёт в Telegram админу/директору» (`operations.daily_digest.deliver_to_telegram`).
- Описание под каждым: что включает, частота, кому уходит.

## 1.12. Переменные окружения

- `COO_DAILY_DIGEST_ENABLED: boolean (default true)` — fallback на ENV, если `AdminSetting` ещё не загружен.
- `COO_DAILY_DIGEST_DELIVER_TO_TELEGRAM: boolean (default false)` — fallback.
- `COO_DAILY_DIGEST_HOUR_UTC: number (default 22)` — час cron (UTC).

## 1.13. Связь с существующим кодом

- Новые файлы:
  - `backend/src/modules/operations/services/daily-digest.service.ts`
  - `backend/src/modules/operations/workers/operations-daily-digest.cron.ts`
  - `backend/src/modules/operations/prompts/daily-digest.prompt.ts`
  - `backend/src/modules/operations/dto/daily-digest.dto.ts`
  - `backend/src/modules/operations/controllers/daily-digest.controller.ts`
  - `frontend/app/(authenticated)/dashboard/operations/daily/page.tsx`
  - `frontend/app/(authenticated)/dashboard/operations/daily/DailyDigestClient.tsx`
  - `frontend/src/api/operations-daily-digest.api.ts`
  - `frontend/src/domain/operations-daily-digest.ts`
- Изменения:
  - `operations.module.ts` — провайдеры/контроллеры/экспорты.
  - `OperationsDashboardClient.tsx` — блок «Вчерашний отчёт».
  - `Sidebar.tsx` — пункт навигации.
  - `policy.csv` — строка `daily_digest.regenerate` для admin.

## 1.14. Тесты Фазы 1

- `daily-digest.service.spec.ts` — корректная сборка агрегатов из фикстур.
- `operations-daily-digest.cron.spec.ts` — идемпотентность (повторный запуск не создаёт второй дайджест), фильтр по тумблеру.
- `daily-digest.controller.spec.ts` — 404 на отсутствующую дату, права на `/generate`.
- Интеграционный: cron → агрегат → LLM mock → сохранение → отдача через REST.

## 1.15. DoD Фазы 1

- [ ] Модель `DailyOperationsDigest` в схеме, `bun run prisma:push` прошёл.
- [ ] Регистрация LLM taskType `operations-daily-digest`.
- [ ] Cron генерирует дайджест каждое утро, идемпотентно.
- [ ] REST GET / GET latest / POST /generate работают с правильными правами.
- [ ] Страница `/dashboard/operations/daily` рендерит дайджест + date-navigation.
- [ ] Блок «Вчерашний отчёт» на `/dashboard/operations` показывает `shortSummary` + ссылку.
- [ ] Тумблер `operations.daily_digest.deliver_to_telegram` реально включает/выключает рассылку.
- [ ] При отказе LLM сохраняется «сухой» вариант, badge на UI это показывает.
- [ ] `typecheck` / `lint` / тесты зелёные.

---

# Фаза 2 — Интеграция `causeCategory` во фронтенд + виджет «Карта причин»

## 2.1. Scope

**Входит:**
- В `frontend/src/api/insights.api.ts`: добавить `cause_category?: InsightCauseCategory` в `ListInsightsRequest` и `TopInsightsRequest`, прокинуть в query.
- В `frontend/src/domain/insight.ts` (или там, где DomainModel Insight): добавить поле `causeCategory` (8 значений).
- В виджете «Топ-5 повторяющихся проблем» (`InsightsTopWidget.tsx`): группировка/цвет по `causeCategory`, легенда, фильтр.
- Новый виджет «Карта причин недели» на `/dashboard/operations` — горизонтальные столбики, сколько insights в каждой категории (`process_gap`, `tooling`, ...) с возможностью кликнуть → отфильтровать `/insights?cause_category=...`.
- В `OperationsDashboardService.getOverview` — добавить блок `insightsByCauseCategory: Record<InsightCauseCategory, number>` (агрегат по 7 дням, severity ≥ medium).
- DTO `OperationsDashboardOverviewDto` расширить полем.
- Перевод значений на русский (UI label'ы): `process_gap` → «Процесс / процедура», `tooling` → «Инструменты», `role_skill` → «Роль / компетенция», `communication` → «Коммуникация», `priority` → «Приоритеты», `resource_constraint` → «Ресурсы», `external` → «Внешнее», `unknown` → «Не определено».

**Не входит:**
- Изменения backend-сохранения / промпта — там уже всё работает.
- Виджеты в `/dashboard` (CEO Dashboard) — отдельным ТЗ.

## 2.2. Связь с существующим кодом

- `frontend/src/api/insights.api.ts` — расширить query.
- `frontend/src/domain/insight.ts` — добавить поле + enum.
- `frontend/src/ui/components/dashboard/widgets/InsightsTopWidget.tsx` — группировка/цвет, фильтр через UI.
- `frontend/src/ui/components/admin/Insights/...` — если есть admin-таблица, тоже учесть фильтр.
- `backend/src/modules/operations/services/operations-dashboard.service.ts:getOverview` — добавить `fetchInsightsByCauseCategory(tenantId, days=7)`.
- `backend/src/modules/operations/dto/operations-dashboard.dto.ts` — расширить `OverviewDto`.
- Новый компонент `frontend/.../CauseCategoryMapWidget.tsx` — горизонтальные столбики.

## 2.3. Тесты Фазы 2

- `operations-dashboard.service.spec.ts` — фикстура с insights разных категорий, проверка агрегата.
- Frontend: snapshot/RTL на `CauseCategoryMapWidget` с тремя категориями.
- Backward-compat: если у insight `causeCategory=null`, виджет показывает категорию «Не определено».

## 2.4. DoD Фазы 2

- [ ] `/insights?cause_category=tooling` реально фильтрует — список и query передаются.
- [ ] Виджет «Топ-5» подсвечивает категории цветом, есть легенда.
- [ ] Новый виджет «Карта причин недели» на COO-дашборде показывает 8 столбиков (или меньше, если категорий нет) + кликабельность.
- [ ] Существующий тест-набор зелёный.

---

# Фаза 3 — Виджет «Зрелость компании» на COO-дашборде

## 3.1. Scope

**Входит:**
- В `OperationsDashboardService.getOverview` добавить блок `maturity: { score: number | null; lastCalcAt: string | null; weakestDomains: Array<{ slug, name, completeness }>; topDomains: Array<{ slug, name, completeness }> }`.
- Метод-helper `fetchMaturitySnapshot(tenantId)` — читает `CompanyProfile.maturityScore` + `FunctionalDomain` с `completeness IS NOT NULL`, сортирует по completeness ASC/DESC, отдаёт топ-3 «слабых» и топ-3 «сильных».
- DTO расширение.
- Новый виджет `MaturityWidget.tsx` на `/dashboard/operations`: круговой индикатор `maturityScore` (0..1 → 0..100%), две колонки «Слабые места» / «Сильные стороны» (по 3 домена), кнопка-ссылка «Подробнее → /maturity».
- Если `maturityScore=null` (cron ещё не отработал) — заглушка с подсказкой «расчёт зрелости — каждое утро в 05:00 UTC».

**Не входит:**
- Изменения логики `MaturityScorerCron` — он уже работает.
- Динамика maturity (history snapshots) — отдельным ТЗ.

## 3.2. Связь с существующим кодом

- `backend/src/modules/operations/services/operations-dashboard.service.ts` — добавить fetcher + блок в `overview`.
- `backend/src/modules/operations/dto/operations-dashboard.dto.ts` — расширить.
- Frontend: новый `MaturityWidget.tsx` + позиция в `OperationsDashboardClient.tsx` (под блоком «Вчерашний отчёт», над «Температурой команды»).

## 3.3. Тесты Фазы 3

- `operations-dashboard.service.spec.ts` — фикстуры `CompanyProfile.maturityScore=0.42` + `FunctionalDomain`'ы с разным completeness; проверка сортировки.
- Frontend: snapshot на пустое / заполненное состояние.

## 3.4. DoD Фазы 3

- [ ] На `/dashboard/operations` виден круговой индикатор зрелости и две колонки доменов.
- [ ] Клик на «Подробнее» уводит на `/maturity`.
- [ ] При отсутствии данных — корректная заглушка без падений.

---

# Общая часть

## Метрики Prometheus (сводка)

Фаза 1:
- `coo_daily_digest_generated_total{tenant_top}`
- `coo_daily_digest_failed_total{tenant_top, reason}`
- `coo_daily_digest_delivered_total{tenant_top, channel}`
- `coo_daily_digest_age_seconds{tenant_top}` (gauge)

Фаза 2:
- `coo_insights_by_cause_total{tenant_top, cause}` (gauge, обновляется при `getOverview`)

Фаза 3:
- `coo_company_maturity_score{tenant_top}` (gauge, обновляется при `getOverview`)

## Связь с зонтиком COO

Этот ТЗ закрывает три открытых пункта из [анализа готовности 2026-05-23](../analysis/2026-05-23-ai-coo-readiness-analysis.md):
- Часть 3 § M3 → β-4 интеграция `causeCategory` (Фаза 2).
- Часть 3 § S3 → виджет зрелости (Фаза 3).
- Новый пункт «ежедневный отчёт» (Фаза 1), не входил в исходный gap-анализ — выявлен по запросу владельца 2026-05-25.

После ТЗ остаются открытыми пункты (отдельные ТЗ потом):
- α-9 LLM-extraction миссии/видения/стратегии из встреч — отложено на δ-1.
- β-6 Experiment Tracker.
- γ-3 CrossFunctionalProcess + Handoff.
- δ-2 ProactiveWatcher.
- Раздельные права доступа к секциям COO Dashboard (когда понадобятся).
- Per-Org часовой пояс ежедневного отчёта (когда выйдем за РФ).

## Принятые решения по открытым пунктам (закрыты 2026-05-25)

1. **Имя ключа `AdminSetting`** — `operations.daily_digest.deliver_to_telegram`. Соответствует существующему формату `<category>.<section>.<key>` (см. `security.argon_memory_kb`, `security.session_ttl_seconds` в [security-admin.service.ts](backend/src/modules/admin/platform/security/security-admin.service.ts)). При `AdminSettingsService.list({ category: 'operations', section: 'daily_digest' })` ключ будет в нужном месте.

2. **Получатели Telegram-рассылки** — **только `coo + owner`**, без `admin`. Обоснование: роль `admin` в Z обычно IT/devops-человек (управляет техническими настройками, ключами, пользователями), а не бизнес-stakeholder. Получать каждое утро в Telegram отчёт об операционных метриках компании ему не нужно — это спам, который снизит ценность канала. Если у Org нет назначенного COO, owner получит сам. Admin в любой момент видит отчёт на дашборде, если зайдёт. `recipientFilter` в `ConversationalService.sendNotification` — `{ roles: ['coo', 'owner'] }`.

3. **Палитра 8 категорий `causeCategory`** — фиксированный набор Tailwind-классов под dark-first дизайн-систему ([design-system.md](second-brain/02_architecture/design-system.md)):

   | Категория | Tailwind background / text | Семантика |
   |---|---|---|
   | `process_gap` | `bg-rose-500/20 text-rose-300` | Тревожный — корневая операционная проблема |
   | `tooling` | `bg-sky-500/20 text-sky-300` | Нейтральный — про инструменты |
   | `role_skill` | `bg-violet-500/20 text-violet-300` | Про людей и компетенции |
   | `communication` | `bg-amber-500/20 text-amber-300` | Внимание — про разрывы коммуникации |
   | `priority` | `bg-pink-500/20 text-pink-300` | Про управление приоритетами |
   | `resource_constraint` | `bg-stone-500/20 text-stone-300` | Физический ресурс |
   | `external` | `bg-zinc-500/20 text-zinc-300` | Вне контроля компании |
   | `unknown` | `bg-neutral-500/20 text-neutral-300` | Не определено |

   Если дизайнер на ревью захочет переиграть — это локальная правка одного `const CAUSE_CATEGORY_PALETTE`, без структурных переделок.

## Календарь

| День | Фаза | Кто |
|---|---|---|
| 1-3 | Фаза 1 backend (модель + cron + сервис + LLM) | backend |
| 4 | Фаза 1 frontend (страница + блок) | fullstack |
| 5 | Фаза 2 (интеграция causeCategory) | fullstack |
| 6 | Фаза 3 (виджет зрелости) | fullstack |
| 7 | Стабилизация, тесты, ручная проверка с включением Telegram-тумблера | оба |

---

_2026-05-25: готово к старту. Зависит только от β-8 / β-8.1 / β-8.2 / β-4 / α-9 (все done). Никаких новых архитектурных слоёв._
