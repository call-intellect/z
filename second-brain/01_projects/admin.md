---
title: Z-Admin — карта страниц
updated: 2026-06-03
---

# Z-Admin (super_admin)

С 2026-05-31 — Z-Admin живёт в отдельной route-группе `app/(admin)/admin/*`
(root-layout с `AdminAuthGuard`, без AppShell/EntitlementProvider). См.
`plans/archive/2026-05-31-z-admin-standalone-route-group.md`. Org-admin с
2026-06-02 вынесен в `(authenticated)/company-admin/*` (свой
`CompanyAdminSidebar`) — это другая роль; см. [[admin-org-knowledge-core]].

Список фактически работающих страниц админки. Полная карта сайдбара — в
[frontend/app/(admin)/admin/navigation.ts](../../frontend/app/(admin)/admin/navigation.ts).

> **Не путать с управлением участниками Org.** С 2026-06-04 управление участниками и
> приглашениями (смена системной роли, удаление из компании, сброс Telegram,
> приглашение/перевыпуск/отзыв, персональные override доступа) — это уровень владельца/админа
> Org, оно переехало из `/settings/organization` (осталась только вкладка «Информация») в раздел
> **«Команда» (`/structure`)** и карточку сотрудника `/structure/persons/[id]`. См.
> [[frontend-pages]] §«Команда» и [[rbac-access-control]] §Frontend.

## Крутилки курации и напоминаний (AdminSetting)

С 2026-06-03 (Action Center, Фаза C2) 14 платформенных дефолтов лестницы
доверия и напоминаний вынесены из code-констант в `AdminSetting` —
редактируются super_admin через UI с history + audit, читаются через
`TypedConfigService.resolveSync` (cache → ENV → default, code-fallback).
Зарегистрированы в
[admin-setting-schema-registry.ts](../../backend/src/modules/admin/settings/admin-setting-schema-registry.ts),
засижены в [seed-admin-settings.ts](../../backend/scripts/seed-admin-settings.ts)
(уже в `apply-prod-deploy`). Новых ENV нет — admin-only. Полный механизм
AdminSetting — [[admin-settings]].

### 9 ключей лестницы доверия (`knowledge.curation*`)

Единая платформенная точка чтения — `normalizeSettings(cfg.curation)` в
`CurationService` (покрывает триаж + autotune). Per-Org `curationSettings`
не тронут — это глобальные дефолты.

| Ключ | Default | Смысл |
|---|---|---|
| `knowledge.curationProvisionalThresholdDefault` | `0.8` | порог, ниже которого карточка получает метку «Не проверено человеком» (provisional). |
| `knowledge.curationAiVerifierEnabled` | `true` | включён ли AI-верификатор в триаже. |
| `knowledge.curationAuditSampleRate` | `0.05` | доля auto-канонизированных карточек, попадающих в выборочный аудит. |
| `knowledge.curationAutotuneEnabled` | `false` | включён ли авто-подбор порогов по решениям кураторов. |
| `knowledge.curationThresholdMin` | `0.6` | нижняя граница, до которой autotune может опустить порог. |
| `knowledge.curationThresholdMax` | `0.97` | верхняя граница autotune. |
| `knowledge.curationAutotuneStep` | `0.02` | шаг изменения порога за один прогон autotune. |
| `knowledge.curationMinDecisionsForAutotune` | `20` | минимум решений кураторов, прежде чем autotune начнёт двигать порог. |
| `knowledge.curationMaxProvisionalOverride` | `0.2` | максимальный override provisional-порога на стороне Org. |

`autoThreshold` (`knowledge.curationAutoThresholdDefault`) и
`deepReviewThreshold` (`knowledge.curationDeepReviewThresholdDefault`) — те же
крутилки, переключены на `resolveSync` в этой же фазе.

### 5 ключей напоминаний (`pendingActions.*`)

Единая точка — `cfg.pendingActions`, читается в
`pending-actions-reminder.cron` и во всех 3 провайдерах (curation / conflict /
intake), чтобы окно и пороги не рассинхронились.

| Ключ | Default | Смысл |
|---|---|---|
| `pendingActions.reminderWindowStartHour` | `9` | начало «тихого окна» — раньше напоминания не шлём (час, 0–23). |
| `pendingActions.reminderWindowEndHour` | `21` | конец окна напоминаний (час, 0–23). |
| `pendingActions.reminderStepHours` | `3` | минимальный интервал между повторными напоминаниями по одному действию. |
| `pendingActions.urgentAgeDays` | `5` | возраст незакрытого действия, после которого оно помечается срочным. |
| `pendingActions.reminderLeadDays` | `3` | за сколько дней до дедлайна начинать напоминать. |

### Ключи оверхола цепочки агентов (2026-06-08)

Добавлены в `seed-admin-settings.ts` (уже в `apply-prod-deploy`), читаются через
`TypedConfigService.getDynamic` с code-fallback. Источник —
[`plans/tz/2026-06-07-agent-chain-overhaul.md`](../../plans/tz/2026-06-07-agent-chain-overhaul.md).

| Ключ | Default | Смысл |
|---|---|---|
| `tracker.autoAcceptConfidenceThreshold` | `0.75` | порог уверенности, выше которого Issue из встречи авто-принимается (раньше был мёртвый hardcoded `0.92`). Ф3. |
| `goals.themeAutolinkMinWeight` | — | минимальный вес связи Goal↔Theme, при котором `GoalThemeLinkerCron` пишет `GoalTheme(source='ai')`. Ф4.2. |
| `goals.themeAutolinkLlmEnabled` | — | включён ли дополнительный LLM-арбитр для авто-привязки Goal↔Theme поверх детерминированного провенанса. Ф4.2. |
| `aiFeatures.summaryAgentEnabled` | `true` | kill-switch summary-агента (Ф5). Дублируется ENV `SUMMARY_AGENT_ENABLED`. При OFF потребители падают на `summaryV2 ?? summary` через `pickPrimarySummary`. |

### Массовый перенос крутилок из ENV/кода в AdminSetting (2026-06-20, config-knobs Шаги 2–8)

ТЗ [`plans/tz/2026-06-20-config-knobs-to-admin-settings.md`](../../plans/tz/2026-06-20-config-knobs-to-admin-settings.md). ~100 крутилок (порог · лимит · флаг · час доставки · debounce/TTL · retention · rate-limit · вес · выбор модели) переведены из code-/ENV-fallback в `AdminSetting` — редактируются super_admin live (history + audit), читаются через `resolveSync`/`getDynamic` (admin → ENV → code-fallback). Все с дефолтом = текущее поведение (действий владельца НЕ требуют). Зарегистрированы в `admin-setting-schema-registry.ts`, засижены отдельными `seed-admin-setting-*` (в `apply-prod-deploy` STEPS, `phase:'seed-base'`, уважают admin-override). Группы:

- **Concierge (12)** + **Orchestrator (3)** + **Router-fallback (3)** — пороги/лимиты/таймауты помощника, оркестратора и LLM-роутера (ранее прямые `process.env.*`).
- **Воркеры (7)** — knobs BullMQ-воркеров knowledge-core.
- **Retention / logging (21)** — окна хранения и уровни/детализация логов.
- **Limits / share / aiChatQuota / smartTables (36)** — лимиты тарифов, шаринга, квоты AI-чата, лимиты Smart Tables.
- **Probe / curation (13)** — пороги probe-гейта и курации.
- **Модели LLM + рубильники + часы дайджестов (25)** — выбор модели по taskType, kill-switch'и, часы доставки дайджестов.

Развязаны 27 прямых `process.env.*` (concierge/orchestrator/router/воркеры) на `resolveSync`/`getDynamic`; 3 bootstrap-чтения (`LOG_LEVEL`/`NODE_ENV`/`@Cron MAIL_INBOX_POLL_CRON`) оставлены в whitelist.

**Серверный гейт (Шаги 2–3):** новая ENV без классификации (`env-classification.ts` → `KEEP_ENV_KEYS`/`ADMIN_FALLBACK_ENV_KEYS`) валит CI (гард-тесты `env-classification.guard.spec.ts` + `no-direct-process-env.guard.spec.ts`); `AdminSettingsService.set()` валидирует значение по Zod-реестру и требует `reason` (≥10 символов) для severity `high`/`destructive`. Остаток (~240 редких ENV + хардкоды, Шаги 9–10) — осознанно по востребованию; гейт держит инвариант, новые крутилки сюда уже не добавляются мимо реестра.

### UI крутилок — 7 admin-страниц настроек + общий scaffold (2026-06-21, ветка `feature/three-tz-tails-finalization`)

Перенесённые в `AdminSetting` крутилки (126 camelCase-ключей из реестра) получили редактируемые UI-поверхности для super_admin. Общий каркас — `frontend/src/ui/components/admin/DomainSettings.tsx`: экспортирует `DomainSettingsClient` (рендер группы полей + reason-gate перед сохранением high/destructive), типы `SettingSpec` (описание одной крутилки) и `SettingsGroup` (группа). Каждая страница — тонкая обёртка над `DomainSettingsClient` со своим набором ключей.

| Путь | Раздел | Ключей |
|---|---|---|
| `/admin/ai/concierge` | Помощник | 12 |
| `/admin/ai/orchestrator` | Оркестратор и маршрутизатор | 6 |
| `/admin/ai/models` | Модели LLM и часы | 14 |
| `/admin/probe` | Probe и курация | 30 |
| `/admin/platform/worker-knobs` | Рубильники воркеров | 7 |
| `/admin/platform/retention-logging` | Хранение и логи | 21 |
| `/admin/platform/quotas` | Квоты пользователей | 36 |

Все 7 пунктов добавлены в admin-навигацию (`frontend/app/(admin)/admin/navigation.ts`). Бэкенд-контракт не менялся — страницы ходят в существующие `GET/POST /api/v1/admin/settings*` (severity `high`/`destructive` → `reason` обязателен). Перенос самих ключей — раздел выше («Массовый перенос крутилок…»). Реестр страниц — [[frontend-pages]] §Admin.

### Крутилки программы «Память субъекта + самообучение» (2026-06-22)

Программа (3 ТЗ, ветка `feature/2026-06-21-subject-memory-program`) добавила 15 крутилок в 3 новых секции реестра `admin-setting-schema-registry.ts` (засижены `seed-admin-settings.ts`, уже в STEPS): `subject-memory` (9 — `subjectMemory.enabled` kill-switch + пороги активации/подавления), `company-profile` (3 — `companyProfile.autoSummaryEnabled` kill-switch + свежесть/cold-start), `task-routing` (3 — `taskRouting.enabled` kill-switch + порог/topK). Редактируются super_admin через generic `GET/POST /api/v1/admin/settings*` (выделенной UI-страницы пока нет — vNext, см. реестр «не-сделано»). Полный перечень с дефолтами/вердиктами — [[config-knobs-catalog]] §«Выученная память уточнений»/§«Авто-профиль компании»/§«Маршрутизация задач по скиллам».

## Поверхности курации (detail-страницы)

С 2026-06-03 (Action Center, Фаза C3) у курации появились собственные
admin-поверхности с разбором конкретной карточки/конфликта (раньше была только
очередь `/curation`):

- **`/curation/[id]`** — детальная карточка курации: решение куратора (8
  `decisionType`), `reasoning` обязателен при deep- и структурных решениях.
  Роль-гейт: `owner` / `admin`, плюс кандидат-куратор из `candidateCuratorIds`
  и super_admin.
- **`/curation/conflicts`** — список конфликтов, и **`/curation/conflicts/[id]`**
  — резолюция (`accept_new` / `keep_old` / `merge` / `evolving`) либо `dismiss`.
  Роль-гейт строго `owner` / `admin`.

`actionUrl` провайдеров pending-actions ведут deep-link'ом прямо на эти
страницы (`/curation/${id}`, `/curation/conflicts/${id}`). Фон фичи —
[[curation]].

## AI и модели

### `/admin/ai/catalog` — Провайдеры и модели (2026-07-02, переработано целиком)

Единый экран super_admin для реестра LLM-провайдеров (`LlmProvider`/`LlmModel`) — DB-реестр стал **боевым источником правды** для dispatch (раньше был витриной, вызовы шли по захардкоженному ENV-switch). Табы: «Провайдеры» (CRUD), «Модели» (CRUD, фильтр по провайдеру), «Цены» (`LlmPricesClient`, не менялся), «Smoke-тесты» (починен — список из реального реестра, не хардкода).

- **Провайдеры:** `name`(slug)/`displayName`/`baseUrl`/`protocolKind` (7: `openai-chat`/`openai-responses`/`anthropic-messages`/`ollama-native`/`kie-native`/`grsai-native`/`custom-http`)/`capability` (dataClass-фильтр роутера)/ключ (шифруется AES-256-GCM, в ответах только `hasApiKey`)/тумблер «Напрямую / Через прокси» (`useProxy`+`proxyPath`, эффективный `baseUrl`/ключ строит `ProviderInfoResolver` по единой формуле)/`timeoutMs`/`defaultModelKey` (с кнопкой «Получить модели» — дискавери `GET {baseUrl}/models`, импорт выбранных)/`globalRps`/доп. HTTP-заголовки/`isActive`/smoke-тест. Удаление или деактивация провайдера, у которого есть активный маршрут или он в дефолт-цепочке — блокируется 409 `provider_in_use_by_routes`.
- **Модели:** `providerId`+`modelKey`(уникальны в паре)/`displayName`/`contextWindow`/`category`/`notes`/`isActive`.
- **API:** `/api/v1/admin/llm-providers` (CRUD+`:id/smoke-test`+`:id/models/discover`), `/api/v1/admin/llm-models` (CRUD) — см. [api-layer.md](api-layer.md).
- **Фронт:** `frontend/app/(admin)/admin/ai/catalog/{CatalogClient,LlmProvidersClient,LlmModelsClient,SmokeTestClient}.tsx` (провайдеры/модели перенесены сюда из легаси `admin/llm/providers|models/` — та папка удалена).
- **Защита:** `CookieAuthGuard` + `SuperAdminGuard` + `SuperAdminAuditInterceptor`, `@ApiExcludeController` (не в Swagger).
- **ТЗ:** [plans/tz/2026-07-02-llm-providers-models-routing-admin.md](../../plans/tz/2026-07-02-llm-providers-models-routing-admin.md).

### `/admin/ai/routing` — Маршрутизация (2026-07-02, единственная точка правки)

Единый экран цепочек `taskType → provider(+model) по tier`. **Заменяет** удалённый `/admin/llm-routes` (дублировал этот же путь записи другим форматом — контроллер `LlmRoutesController` удалён из бэкенда) и legacy `/admin/ai-models/*` (список слит сюда, деталка `TaskTypeDetailsClient` — в `RoutingDetailClient`, тройное дублирование метрик/истории на вкладке «Цепочка» устранено).

- **Список** (`RoutingClient.tsx`) — таблица taskType по группам (ai-pipeline/knowledge-core/competitor-parity), read-only бейджи по tier, ссылка «Подробно».
- **Деталка** (`[taskType]/RoutingDetailClient.tsx`) — 3 вкладки: «Цепочка» (редактор по tier: Select провайдера из живого реестра `LlmProvider`, Select/ручной ввод модели, поле «причина» — сохранение через единый `PUT /api/v1/admin/ai-models/:taskType/chain`), «Метрики» (+ курс `usdRubRate` от `CurrencyRateService`, раньше был хардкод 90 ₽/$), «История». A/B-контролы (`switchPrimary` с `abSplitPercent`) скрыты из UI — `LlmModelExperiment` рантаймом не читается (см. «Не сделано» ниже), решение владельца — не чинить в этом ТЗ.
- **API:** `PUT /api/v1/admin/ai-models/:taskType/chain` — валидирует `providerName` по union(активный DB-реестр, legacy-7) → 422 `route_provider_unknown`; модель вне каталога — `warnings`, не блок.
- **Побочный фикс:** `/admin/usage/functions/:taskType` и `/admin/analytics/functions/:taskType` («Функции») тоже писали цепочку через теперь-удалённый `/admin/llm-routes` — их save-хендлеры переведены на `putChain` (позиция в массиве → tier: 0=primary/1=secondary/2+=tertiary).
- **Навигация:** пункт «Управление роутами LLM» убран из меню (страница удалена).
- **ТЗ:** [plans/tz/2026-07-02-llm-providers-models-routing-admin.md](../../plans/tz/2026-07-02-llm-providers-models-routing-admin.md).

### `/admin/analytics/llm-cost` — Расход на LLM, консолидированный дашборд (2026-07-03)

Единый экран super_admin с лестницей из 5 уровней: **общий итог → по модели → по смысловому разделу → по компании → по компании×модели**, график по дням/неделям на каждом уровне (переключатель `7д/30д/90д`, дефолт 30 дней). Источник данных — **`AiCostDaily`** (посуточная агрегация `tenantId×date×taskType×provider×model`, наполняется `DailyCostAggregatorCron` с 24 мая 2026), **не** `AiUsageLog` — впервые подключён читатель к таблице, которая копилась месяц без единого потребителя. Все суммы только в рублях.

Заменяет 8 разрозненных путей расхода на LLM:
- **Полный редирект (2):** `/admin/analytics/economics` (общая юнит-экономика) и `/admin/analytics/functions` (список функций LLM) — теперь 307 на новый дашборд.
- **Хирургия — денежная часть вырезана, остальное осталось (3):** `/admin/analytics/orgs` (список организаций — колонка расхода в USD заменена ссылкой на уровень 5), `/admin/economics/orgs/[id]` (юнит-экономика компании — расчёт расхода и топ-задачи убраны в пользу ссылки, форма редактирования бюджет-лимита осталась без изменений), `/admin/analytics/functions/[taskType]` (деталь функции — собственный дублирующий редактор цепочки моделей, вызывавший тот же `putChain`, что и «Роутинг моделей», — убран в пользу ссылки туда; блок «Последние вызовы» остался).
- **Мёртвые пути удалены насовсем, не редирект (3):** `/admin/economics`, `/admin/usage/functions(+[taskType])`, `/admin/usage/users` — redirect-заглушки в никуда + обслуживающий их код (`getUsersUsage`, `getFunctionsUsage`, `UnitEconomicsService.getGlobal()`).

Вкладка «Метрики» `/admin/ai/routing/[taskType]` получила встроенную вырезку из нового источника (не просто ссылку) — рядом с существующей tier/success-разбивкой, которую не тронули.

**API:** `LlmCostDashboardController` (см. [api-layer.md](api-layer.md) §«Расход на LLM»). **ТЗ + архитектура:** [`plans/tz/2026-07-03-llm-cost-dashboard.md`](../../plans/tz/2026-07-03-llm-cost-dashboard.md) / [`plans/architecture/2026-07-03-llm-cost-dashboard.md`](../../plans/architecture/2026-07-03-llm-cost-dashboard.md).

### `/admin/clones` — Доступы к клонам (2026-05-26)

Страница для `owner` / `admin` Org: управление гранатами `CloneAccessGrant` (выдача, soft-revoke, продление срока действия). Создана 2026-05-26 в рамках Фазы 7 §9 clone-respond v2.

- **API:** 5 endpoints под `/api/v1/admin/clones/access-grants` (см. [api-layer.md](api-layer.md) §Clones admin), guard `OrgAdminGuard` + `AdminAuditInterceptor` (severity `high` — `reason` обязателен для grant/revoke/extend).
- **Защита:** `CookieAuthGuard` + `OrgAdminGuard`. Permission-gate во фронте через `useAuth` (поверх backend).
- **Фронт:**
  - `frontend/app/(admin)/admin/clones/page.tsx`
  - `frontend/app/(admin)/admin/clones/ClonesAccessClient.tsx`
  - `frontend/app/(admin)/admin/clones/CreateGrantDialog.tsx` — поиск member'а через `orgMembersApi.search` (debounce 250 мс), выбор role-клона из `useClones`, опц. `expiresAt` под кнопкой «Дополнительно».
  - `frontend/app/(admin)/admin/clones/RevokeGrantDialog.tsx` — подтверждение soft-revoke с danger-кнопкой.
  - `frontend/app/(admin)/admin/clones/ExtendGrantDialog.tsx` — `datetime-local` + чекбокс «бессрочно».
  - `frontend/src/api/admin-clones.api.ts` — 5 методов (list / create / revoke / extend / listByClone).
  - `frontend/src/domain/admin-clone-access-grant.ts` — типы + мапперы + русские лейблы для статус-chip («Активен» / «Отозван» / «Истёк»).
- **Навигация:** новый пункт «Доступы к клонам» (иконка `ShieldCheck`) в разделе «AI и модели» admin-навигации (`frontend/app/(admin)/admin/navigation.ts`).
- **Особенности:**
  - Фильтры — `cloneType` select, поиск по имени получателя, toggle «только активные».
  - Таблица с enriched-полями: `cloneLabel`, `userName` / `userEmail`, `grantedBy`, статус, `expiresAt` или «бессрочно».
  - Server-side pagination (`page` + `pageSize=50`).
  - Re-grant поверх revoked — физическое удаление старой записи в транзакции (audit остаётся в `AdminAuditLog`).
  - При `grant` уведомление получателя — `eventType=clone.access_granted` (in-app + Telegram через `ConversationalService`). Notification-failure не откатывает grant (warn-log).
- **ТЗ:** [plans/archive/2026-05-26-clone-access-grant-admin-api.md](../../plans/archive/2026-05-26-clone-access-grant-admin-api.md) + frontend часть в [plans/archive/2026-05-26-clones-marketplace-frontend.md](../../plans/archive/2026-05-26-clones-marketplace-frontend.md) §2-§3.

### `/admin/checkin-signals` — Сигналы чек-инов (2026-06-21)

Страница super_admin: крутилки дневного фиксатора чек-инов. Через `AdminSettingField` (history + audit), поверх `AdminSettingsService` / `TypedConfigService.getDynamic` (admin → ENV → code-fallback).

- **Ключи (реальные читаемые реестром, 2026-07-02):** рубильник `dayReport.enabled` (читают `day-report-collector.cron` + `meeting-checkin.listener`), порог полноты вечернего отчёта `dayReport.completenessQualityThreshold` (читает `daily-checkin.service`), порог «залежавшегося» чек-ина `daily-checkin.staleDaysThreshold` (читает `telegram-digest.cron`), пропуски `daily-checkin.skipNonWorkingDays` / `daily-checkin.skipHolidays` (читает `daily-checkin-prompt.cron`).
- **История бага:** до 2026-07-02 страница писала фантомные `daySignals.*` (рубильник/порог детектора/локальный час), которых бэк НЕ читал — крутилки молча ничего не делали (фича с самого начала жила на `dayReport.*`/`daily-checkin.*`). Переведена на реальные ключи в рамках унификации phantom-ключей (`plans/tz/2026-07-02-admin-knob-fe-backend-key-unification.md`). `daySignals.processLocalHour` (без читателя — коллектор на хардкод-cron MSK 05:00) вынесен в `plans/tz/2026-07-02-cron-schedules-env-to-admin-settings.md`.
- **Guard:** рецидив phantom-ключа на любой `*SettingsClient.tsx` ловит backend-тест `admin-setting-fe-keys.guard.spec.ts` (`feKeys ⊆ registeredSettingKeys()`).
- **Навигация:** пункт «Фиксатор чек-инов» в admin-навигации (`frontend/app/(admin)/admin/navigation.ts`).

### `/admin/ai/embeddings` — вкладка «Провайдеры» (2026-07-02)

Страница super_admin: CRUD управляемых провайдеров эмбеддингов (`EmbeddingProvider`/`EmbeddingModel`), которые резолвер рантайма читает из БД вместо ENV-переключателя. На каждого провайдера — endpoint (`baseUrl` + `protocolKind`), API-ключ (шифруется AES-256-GCM, в ответах только `hasApiKey`), список моделей с размерностью (`dimensions`) и справочной ценой (не биллинг), `priority`, кнопки активации и smoke-проверки, баннер `needsReindex` при смене размерности активного провайдера. Активация с несовпадающей размерностью блокируется гардом `embedding_dimension_mismatch_requires_reindex` (сам реиндекс-воркер вне scope — остаётся заглушка `ReindexTab`).

- **API:** 10 маршрутов `/api/v1/admin/embedding-providers` под `SuperAdminGuard` (см. [api-layer.md](api-layer.md) §«Провайдеры эмбеддингов»), `AdminEmbeddingProvidersController` + `AdminEmbeddingProvidersService` в `backend/src/modules/admin/economics/`.
- **Фронт:** `frontend/app/(admin)/admin/ai/embeddings/EmbeddingProvidersClient.tsx` (вкладка «Провайдеры»), слои `frontend/src/api/admin-embedding-providers.api.ts` + `frontend/src/domain/admin-embedding-provider.ts`.
- **Защита:** `CookieAuthGuard` + `SuperAdminGuard`.
- **ТЗ:** [plans/tz/2026-07-02-embedding-providers-crud.md](../../plans/tz/2026-07-02-embedding-providers-crud.md). Модели — [[../02_architecture/data-model]] §«EmbeddingProvider / EmbeddingModel».

## Тенанты (Org)

### `/admin/orgs/[id]` — Карточка организации (табы)

Глобальный обзор тенанта для super_admin. Активная вкладка через `?tab=`.
Каждый таб — отдельный запрос (lazy), карточка открывается быстро.

**Табы (по порядку):**
- `overview` — обзор Org (тарифные плитки, расход за 30 дней, доход).
- `billing` — **Тариф и лимиты** (entitlements: tier, featureOverrides,
  quotaOverrides, notes, reason). Рендерит `BillingAdminClient`.
- `subscription` — **Подписка и счета** (subscription + invoices + events).
  Рендерит `AdminSubscriptionClient`.
- `members`, `sources`, `economics`, `audit`, `danger`.

**Унификация навигации (2026-05-29, ТЗ admin-subscription-ui-v2):**
- Standalone-страницы `/admin/orgs/[id]/billing/page.tsx` и
  `/admin/orgs/[id]/subscription/page.tsx` → `redirect()` на соответствующий
  `?tab=`. Закладки super-admin продолжают работать через 307.
- Из списка Org (`OrgsClient`) кнопка «Тариф» ведёт сразу на `?tab=billing`
  (без редиректа).
- `BillingAdminClient` и `AdminSubscriptionClient` — pure tab-content,
  без собственного `<h1>` и линка «К списку Org» (заголовок даёт
  `OrgDetailClient` через breadcrumbs).

**Секция «Доступ к продукту» в табе «Тариф и лимиты» (2026-06-06):**
- В `BillingAdminClient` (таб `?tab=billing`) добавлена секция «Доступ к
  продукту» — первый UI для существующего эндпоинта активации (`adminActivate`
  → `ManualBillingService.activate`). Раньше выдать доступ можно было только в
  табе «Подписка и счета» (форма ручной активации) — теперь это видно прямо
  рядом с тарифом и лимитами.
- Показывает текущий `subscription.status` (читается через
  `billingApi.adminGetOrgBilling`).
- Когда `tier` задан, но подписка в статусе `DEMO`, выводит предупреждение
  «компания всё ещё в демо» — типичный рассинхрон, когда тариф проставлен, а
  доступ не активирован.
- Форма выдачи доступа: режим **бонус / платный**, период, доп. места, причина
  → `billingApi.adminActivate`.
- Источник: [plans/tz/2026-06-05-bonus-access-and-paywall-sync.md](../../plans/tz/2026-06-05-bonus-access-and-paywall-sync.md) Ф1 (коммит `5e87ffe1`).

**Что доступно в табе «Подписка и счета»:**
- Карточка «Текущая подписка»: статус, paymentMode, период, цена, места,
  autoRenew, всего оплачено. При `paymentMode === 'bonus'` показывается
  отдельный жёлтый Badge «Бонус».
- Кнопки «Изменить места» и «Принудительно сменить статус» (см. диалоги
  ниже).
- Форма ручной активации (paid / bonus + reason ≥3).
- Таблица последних 10 счетов с inline-кнопками действий
  (`InvoiceRowActions`):
  - **mark-paid** — только для статуса `issued`; модал с обязательным
    `externalRef` (номер платёжки) + `reason ≥3`. Идемпотентен на бэке.
  - **void** — для `draft` / `issued`; модал с `reason ≥3`. Для `paid` /
    `bonus` кнопка не показывается.
- Таймлайн `SubscriptionEvent` (последние 100 от бэкенда) с цветными
  бейджами по типу события, инициатором, причиной, accordion с
  JSON-payload.

**Диалоги:**
- `AdjustSeatsDialog` — изменение числа доп. мест. Поля: `newSeatsExtra`,
  `reason ≥3`. Pro-rata-подсказка для monthly (`daysLeftInMonthlyPeriod`)
  и yearly (`monthsLeftInYearlyPeriod`) — рассчитывается на фронте, доплата
  считается на бэке (`ManualBillingService.adjustSeats`).
- `ForceStatusDialog` — обход FSM подписки. Двойное подтверждение —
  `reason ≥3` + чекбокс «Я понимаю, что обхожу FSM». Submit активен только
  при изменённом статусе. Действие пишется в `AdminAuditLog`.

**Файлы фронта:**
- `frontend/app/(admin)/admin/orgs/[id]/OrgDetailClient.tsx`
- `frontend/app/(admin)/admin/orgs/[id]/billing/BillingAdminClient.tsx`
- `frontend/app/(admin)/admin/orgs/[id]/subscription/AdminSubscriptionClient.tsx`
- `frontend/app/(admin)/admin/orgs/[id]/subscription/InvoiceRowActions.tsx`
- `frontend/app/(admin)/admin/orgs/[id]/subscription/AdjustSeatsDialog.tsx`
- `frontend/app/(admin)/admin/orgs/[id]/subscription/ForceStatusDialog.tsx`
- `frontend/app/(admin)/admin/orgs/[id]/subscription/SubscriptionEventsTimeline.tsx`

**API:** все методы готовы в `frontend/src/api/billing.api.ts` —
`adminGetOrgBilling`, `adminActivate`, `adminAdjustSeats`,
`adminForceStatus`, `adminGetEvents`, `adminMarkInvoicePaid`,
`adminVoidInvoice`. Бэкенд — `backend/src/modules/billing/admin-billing.controller.ts`.

**Защита:** `CookieAuthGuard` + `SuperAdminGuard`.

**Pages (sidebar/menu):** в `navigation.ts` раздел «Тенанты» добавлен
пункт «Биллинг — обзор» → `/admin/billing-overview` (агрегированные
метрики MRR/ARR/subs/refs/invoices по всем Org).

**ТЗ:** [plans/archive/2026-05-29-admin-subscription-ui-v2.md](../../plans/archive/2026-05-29-admin-subscription-ui-v2.md).

### `/admin/demo` — Демо-кабинеты «ТехноСтрим» (2026-05-29)

Super-admin создаёт/сбрасывает демо-кабинет для **любой** Org из UI — без CLI и без логина под owner'ом. Переиспользует `OnboardingService.seedDemoWorkspace/resetDemoWorkspace` (та же логика, что `/onboarding/demo-choice` и CLI `seed-demo-workspace.ts`).

- **API:** `GET /api/v1/admin/demo/orgs`, `POST .../:orgId/seed`, `POST .../:orgId/reset` — `backend/src/modules/admin/controllers/admin-demo.controller.ts`.
- **Защита:** `CookieAuthGuard` + `SuperAdminGuard` + `SuperAdminAuditInterceptor`. `OnboardingModule` подключён в `admin.module.ts`.
- **Фронт:**
  - `frontend/app/(admin)/admin/demo/page.tsx` + `DemoClient.tsx` — список Org с бейджем «демо залито» (по `Org.demoWorkspaceSeededAt`), кнопки «Создать/Перезалить демо» и «Сбросить» (confirm).
  - `frontend/src/api/admin-demo.api.ts`.
- **Навигация:** пункт «Демо-кабинеты» (иконка `Sparkles`) в разделе «Тенанты» (`navigation.ts`).
- **Особенности:** seed берёт `ownerId` Org автоматически. Демо помечается `externalSource='demo'`, reset не трогает боевые данные.
- **ТЗ:** [plans/archive/2026-05-29-admin-demo-workspace-creation.md](../../plans/archive/2026-05-29-admin-demo-workspace-creation.md). Инструкция — [docs/guides/demo-workspace.md](../../docs/guides/demo-workspace.md).

## Обратная связь

### `/admin/feedback` — Канал обратной связи + AI-кластеризация

Дашборд блоков (`FeedbackTopic`) с процентами по объёму items. Только для super_admin Z (фича глобальная — фидбэк адресован команде Z, а не Org'е).

- **API:** `GET /api/v1/admin/feedback/topics` + items + actions + `POST /admin/feedback/digest/run` (см. [api-layer.md](api-layer.md)).
- **Защита:** `CookieAuthGuard` + `SuperAdminGuard`.
- **Фронт:**
  - `frontend/app/(admin)/admin/feedback/page.tsx`
  - `frontend/app/(admin)/admin/feedback/FeedbackDashboardClient.tsx`
  - `frontend/app/(admin)/admin/feedback/[topicId]/` — детальная карточка блока + items + действия
  - `frontend/app/(admin)/admin/feedback/components/` — диалоги rename / merge / archive (Phase 8)
  - `frontend/src/api/admin-feedback.api.ts`
  - `frontend/src/domain/admin-feedback.ts`
- **Особенности:**
  - Дашборд показывает блоки в порядке убывания % от общего числа items.
  - Действия: rename / merge (склейка с другим topic) / archive / unarchive.
  - Отдельная страница «Failed-сообщения» (`GET /admin/feedback/messages/failed`) — сообщения, на которых AI 3+ раза падал.
  - Ручной запуск ночного прогона — `POST /admin/feedback/digest/run` (BullMQ-job в очередь `core.feedback-digest`).
- **ТЗ:** [plans/archive/2026-05-25-user-feedback-with-ai-clustering.md](../../plans/archive/2026-05-25-user-feedback-with-ai-clustering.md). Полная заметка фичи — [[feedback]].
