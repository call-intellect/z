# ТЗ — Пакет багфиксов по итогам полного QA-обхода кабинета (2026-06-16)

> Источник: полный регрессионный QA-обход кабинета `korateam.ru` под аккаунтом владельца
> `svmazur@mail.ru` (Org «Ооо луа») + анализ прод-логов через `backend/scripts/diag.ts`.
> Отчёт обхода — в чате сессии; скриншоты — корень `qa-01…qa-60*.png` (gitignored).
> Локализация кода в этом ТЗ верифицирована (vexp + чтение исходников + git).

## Цель

Устранить дефекты, которые видит конечный пользователь (новый клиент), и серверные
ошибки прода. Минимальные безопасные изменения, фаза за фазой, с верификацией.

## Классификация находок по природе

| Природа | Что делаем |
|---|---|
| **Код-фикс (фронт/бэк)** | Чиним в этом ТЗ (фазы 1–6) |
| **Данные конкретной Org в БД** | НЕ кодом. Дубли отделов/сущностей/Person, искажения бренда «Кога»/«Core» в графе (результат ASR/LLM на записях) — вне scope код-фиксов; для «Трекер Z»/«Встречи Z» в БД — отдельный backfill (Фаза 5Б) |
| **LLM-генерация (промпты)** | По правилу «без golden, выкатываем-наблюдаем» — отдельно, не вслепую. Артефакт «( vs )» в ответе помощника, метрики встречи — вынесены из код-фиксов (раздел «Вне scope») |
| **Уже исправлено в коде** | `valueStrip` 22023 — фикс в коммите `a813d1df`, ждёт деплоя. НЕ трогаем |

---

## Фаза 1 — Критичные серверные ошибки (бэкенд)

### 1.1 `relation "idea_blocks" does not exist` (Prisma 42P01) — ночной cron 04:00
- **Файл:** `backend/src/modules/company-foundation/workers/domain-expander.cron.ts:88-101`
- **Корень:** raw SQL обращается к `idea_blocks` (snake_case), реальная таблица — `"IdeaBlock"` (Prisma без `@@map`). Колонки тоже snake_case (`tenant_id`/`created_at`/`deleted_at`). **Сверх того:** колонки `themes` в таблице нет — `themes` это реляция `ThemeIdeaBlock[]`; реально существующий массив-колонка для группировки — `tags String[]` (schema.prisma:3323). Запрос НИКОГДА не работал (вечный graceful skip + ERROR-спам PrismaService 8×/сутки по числу Org).
- **Фикс:** переписать SQL на `FROM "IdeaBlock"` + camelCase колонки в кавычках (`"tenantId"`,`"createdAt"`,`"deletedAt"`) + `unnest(tags)`/`cardinality(tags)` вместо `themes`. Обновить комментарии (themes→tags).
- **Риск:** низкий (внутри try/catch; меняем на валидный запрос к существующим колонкам; фича начинает реально работать — кластеры доменов по тегам блоков).

### 1.2 `chat-v2/messages/stream → 403` — фронт не шлёт X-Org-Id
- **Файлы:** `frontend/src/api/chat-v2.api.ts:128-183` (голый `fetch` без X-Org-Id), `frontend/src/api/api-client.ts` (добавить экспорт геттера orgId).
- **Фикс:** в `api-client.ts` экспортировать `getApiClientOrgId()`; в `streamChatV2Message` добавить заголовок `X-Org-Id` (если orgId есть). Бэкенд-контроллер корректен (требует X-Org-Id через TenantGuard).
- **Риск:** низкий. SSE-стриминг начнёт работать; есть синхронный fallback.

### 1.3 `valueStrip` 22023 — УЖЕ ИСПРАВЛЕНО (`a813d1df`), не трогаем. Только дождаться деплоя.

---

## Фаза 2 — AI-отчёт встречи: рендер Markdown (фронт)

### 2.1 Боковая панель встречи (`/meetings?selected=`) показывает сырой Markdown
- **Файл:** `frontend/src/ui/components/meetings-journal/MeetingsJournalReal.tsx:~1158-1165` — `<p>{summary}</p>` (plain text).
- **Фикс:** импортировать и использовать `MeetingSummaryRender` (тот же компонент, что на полной странице).

### 2.2 GFM-таблицы не рендерятся (полная страница `/result` + боковая панель)
- **Файлы:** `frontend/src/ui/components/meeting-result-v2/MeetingSummaryRender.tsx:3,36` (нет `remark-gfm`); `frontend/package.json` (пакет не установлен); опц. `frontend/src/ui/components/chat-v2/AssistantMarkdown.tsx:69`.
- **Фикс:** `bun add remark-gfm` в `frontend/`; добавить `remarkPlugins={[remarkGfm]}` в `MeetingSummaryRender` (и заодно в `AssistantMarkdown`). `rehype-sanitize` таблицы пропускает (в whitelist).

### 2.3 Сообщение для `never_activated` вводит в заблуждение
- **Симптом:** встреча со `status='failed'`, `failureReason='never_activated'` (создана, не проведена, записи нет) показывает «Не удалось обработать запись… нажмите Регенерировать» — регенерировать нечего.
- **Файлы:** `frontend/src/ui/components/meeting-result-v2/MeetingResultPageReal.tsx:769-786` (`AiFailedBanner`), маппер `frontend/src/domain/meeting.ts:359-409`.
- **Фикс:** прокинуть `failureReason` в баннер; для `never_activated` (и `ended_before_start`) показывать «Встреча не состоялась — запись не велась» БЕЗ кнопки «Регенерировать». Для прочих `failed`/`ai_failed` — оставить как есть.
- **Риск:** низкий.

---

## Фаза 3 — Очередь «Подтверждения» (`/actions`) — самый заметный экран

### 3.1 Сырой технический заголовок «CompanyProfile без Mission / Vision / Strategy: «<CUID>»»
- **Файл:** `backend/src/modules/curation/workers/consistency-checker.cron.ts:~465` — шаблон `message`. Правила R1–R6 содержат англ. имена типов в `ruleDescription`.
- **Фикс:** заменить англ. имена типов сущностей на русские в `ruleDescription` всех правил (CompanyProfile→«профиль компании», Document→«документ», Mission/Vision/Strategy→«миссия/видение/стратегия»). `entityName` уже по-русски.

### 3.2 Сырой подзаголовок (context) во ВСЕХ карточках
- **Файлы:** `backend/src/modules/probe/probe-dispatcher.worker.ts:261` (кладёт `payload.message` в `context`); `frontend/app/(authenticated)/actions/ActionsClient.tsx:139-141` (рендерит `d.context`).
- **Фикс:** не рендерить технический `context` для `consistency_violation` (фронт) — он не несёт ценности под нормальным заголовком. Минимально-инвазивно: правка фронта (скрыть `d.context`, когда он дублирует/технический).

### 3.3 Логин «chydo_002» вместо имени человека
- **Файл:** `backend/src/modules/pending-actions/providers/curation.provider.ts:90-95` — `cardTitle` берёт `payload.name` без JOIN в `Person`.
- **Фикс:** если в payload есть `personId`/`userId` — резолвить `Person.name` из БД (как делает `intake.provider.ts:75-88`).

### 3.4 Мусорные «кандидаты в задачи» («/actions», «Какие у меня есть задачи ?»)
- **Файл:** `backend/src/modules/pending-actions/providers/intake.provider.ts:94-95` — label из сырого `rawContent`, нет фильтра по confidence.
- **Фикс:** не показывать intake с низкой уверенностью (порог, напр. `confidence >= 0.3`); fallback-label на `rawContent` только если есть осмысленный `extractedTitle`.

### 3.5 Дубли вопросов (6 про миссию, 3 про «Дамп») + лживый баннер
- **Файлы:** `backend/src/modules/pending-actions/providers/probe.provider.ts:53-96` (нет дедупа при выборке); `consistency-checker.cron.ts:400-420` (Redis SETNX, при отказе Redis `dedupAcquire=true` плодит дубли); баннер `ActionsClient.tsx:573-582`.
- **Фикс:** дедуп при выборке в `probe.provider.ts` по ключу `(reason + первый contextId + нормализованный message)` — отдавать только новейший. Баннер сделать честным или убрать обещание авто-закрытия, если механизма нет.
- **Риск:** средний (выборочный дедуп может скрыть легитимные не-дубли) — ключ дедупа строгий (тот же reason+entity).

---

## Фаза 4 — Биллинг (фронт-domain desync)

### 4.1 «tier_standard» сырым кодом вместо «Стандартный»
- **Файлы:** `frontend/src/domain/entitlement.ts:17,89-101` (нет `tier_standard` в `TierKey`/`TIER_LABELS`); `frontend/app/(authenticated)/settings/subscription/SubscriptionClient.tsx:550,646` (хардкод `tier_standard`).
- **Фикс:** добавить `tier_standard: 'Стандартный'` в `TierKey`/`ALL_TIERS`/`TIER_LABELS`/`FEATURE_MIN_TIER`; убрать хардкод в SubscriptionClient (использовать `tierLabel`/'Стандартный').

### 4.2 «Встреч в месяц: 0» (billing) vs «Баланс 288» (subscription)
- **Файл:** `frontend/src/domain/entitlement.ts:44-45,78-79,153-154` — `meetings_per_month` остался во фронт-domain, бэк его удалил (управление через MeetingsBalance).
- **Фикс (C1, рекоменд.):** удалить `meetings_per_month` из `QuotaKey`/`ALL_QUOTAS`/`QUOTA_LABELS` — мёртвое поле уходит из таблицы лимитов; баланс встреч виден на /subscription.

**Бэкенд-правок нет** (tier_standard есть в TIER_CONFIG; meetings_per_month правомерно удалён).

---

## Фаза 5 — Бренд (Z→Кора) + англицизмы статики + склонения

### 5А. Статические строки фронта (правка JSX/констант)
| Строка | Файл:строка | Замена |
|---|---|---|
| «команде Z» | `frontend/app/(authenticated)/feedback/page.tsx:28` | «команде Коры» |
| «не хватает в Z» (placeholder) | `frontend/app/(authenticated)/feedback/components/FeedbackForm.tsx:30` | «не хватает в Коре» |
| «Онбординг» (×2) | `settings/SettingsClient.tsx:59`, `settings/sections/OnboardingSection.tsx:17,19` | «Знакомство» |
| «Маппинг» (×6) | `integrations/import-tracker/ImportTrackerClient.tsx:561,770,793`, `Bitrix24Wizard.tsx:57,165`, `YandexTrackerWizard.tsx:57,165` | «Сопоставление» |
| «bulk-операций» | `settings/exports/ExportsClient.tsx:108` | «массовых операций» |
| «по всей Org» / «на Org» | `frontend/src/domain/entitlement.ts:137,155` | «по всей компании» / «на компанию» |
| «На MVP апгрейд…» | `settings/billing/BillingClient.tsx:321` | «Смена тарифа в один клик пока недоступна.» |
| «CRUD/Department↔FunctionalDomain» | `departments/DepartmentsClient.tsx:169,173` | «Управление отделами… привязки отделов к функц. областям» |
| «Email» (метки/колонки ×5) | `team/PersonDialogs.tsx:92`, `structure/PersonsTab.tsx:375`, `settings/sections/ProfileSection.tsx:84,91`, `structure/persons/[id]/PersonCardClient.tsx:149` | «Эл. почта» |
| «handoff'ов» | `frontend/src/ui/components/role-map/RoleMapCards.tsx:252` | «передач задач» |

### 5Б. Бренд «Z» в бэкенд-константах источников + backfill БД
- **Константы (новые Org):** `backend/src/modules/ingest/adapters/meeting.adapter.ts:54`, `backend/src/modules/orgs/orgs.service.ts:121` («Встречи Z»→«Встречи»); `backend/src/modules/ingest/adapters/tracker/tracker.adapter.ts:119` («Трекер Z»→«Трекер»). Обновить тесты `tracker.adapter.spec.ts:38,221`.
- **Backfill существующих Org:** новый `backend/scripts/backfill-rename-z-sources.ts` — `UPDATE "Source" SET name='Встречи' WHERE name='Встречи Z'` и `'Трекер'` аналогично. Зарегистрировать в `apply-prod-deploy.ts` (phase backfill, skipBootstrap). Обновить `prod-deploy-log.md` Шаг 8.

### 5В. Склонение числительных (плюрализация)
- **Существует** `pluralRu` (3 копии: `weekly-per-person.ts:110`, `contribution.ts:207`, и др.). Вынести/использовать единый хелпер.
- **Применить:** `regulations/RegulationsListClient.tsx:383-392` (регламентов/процессов/инструкций/политик), `themes/ThemesClient.tsx:184` + `themes/[id]/ThemeDetailClient.tsx:109` + `goals/[id]/GoalDetailClient.tsx:1596` («N блоков · M сущностей»).
- **Фикс:** обернуть счётчики в `pluralRu(n, ['блок','блока','блоков'])` и т.п.

---

## Фаза 6 — Мелкие фронт-улучшения

### 6.1 Спринты: пустое состояние без кнопки создания
- **Файл:** `frontend/app/(authenticated)/projects/[slug]/cycles/CyclesClient.tsx:35-40`. API есть (`POST /projects/:id/cycles`, `cyclesApi.create`).
- **Фикс:** в пустом состоянии добавить CTA «Создать спринт» (для admin/owner — write-доступ).

### 6.2 Дублирующая навигация в /settings
- **Файлы:** `settings/SettingsSidebar.tsx` (полное вертикальное меню) + `settings/SettingsClient.tsx:56-59` (горизонтальные табы Профиль/Безопасность/Внешний вид/Онбординг).
- **Фикс:** убрать горизонтальные табы из `SettingsClient` (оставить навигацию через сайдбар + `?tab=`). Раздел «Онбординг» доступен как пункт/секция.

### 6.3 Диалоги чата все «Новый диалог»
- **Файлы:** бэкенд генерит title асинхронно (`chat-v2.service.ts:337-350`, `conversations.service.ts:325-382`) fire-and-forget; фронт `ChatV2Client.tsx:232` не рефрешит список после генерации.
- **Фикс (мин.):** после ответа на ПЕРВОЕ сообщение — перезапросить список диалогов (revalidate SWR/refetch) через ~1.5–2с, чтобы подхватить сгенерированный title. Без изменения бэкенда.
- **Риск:** низкий.

---

## Вне scope код-фиксов (вынесено осознанно)

- **«( vs )» в ответе помощника** — артефакт LLM-генерации (незаполненный шаблон противоречия). Правки промптов — отдельно, «без golden, выкатываем-наблюдаем». Не чиним вслепую.
- **Метрики встречи** («Оценка качества — Не удалось рассчитать», «Поведение участников — Метрики недоступны») — ограничение ДАННЫХ (нет word-timings диаризации / короткая встреча / LLM-фейл quality-score). UI уже честно объясняет. Не код-баг.
- **Дубли данных в БД** (отделы «отдел внедрения»×2, сущности «Битрикс»×3, Person «Анастасия/Настя», отдел «DEVE-5») — данные Org, чистятся не кодом. Отдельная задача дедупликации/мерджа.
- **Искажение бренда в графе** («Кога»/«Core»/«Kora» в темах/сущностях) — результат ASR/LLM на реальных записях. Данные, не статика.
- **valueStrip 22023** — уже исправлено (`a813d1df`).

---

## Порядок и верификация

1. Реализация фазами 1→6. Фронт-дерево чистое — фронт-фазы верифицируются `bun run typecheck && bun run lint && bun run build` во `frontend/`.
2. Бэкенд-дерево содержит чужие незакоммиченные изменения (параллельная сессия) — бэкенд-фазы коммитим ТОЛЬКО своими файлами (явные пути), верификация точечная.
3. Коммит по фазам (Conventional Commits), только свои файлы. Push — с явным подтверждением владельца.
4. Повторный QA-ретест затронутых экранов через Playwright.
5. Prod-инструкция: Фаза 5Б добавляет backfill-скрипт → блок в чат + `prod-deploy-log.md`.

## Статус
- [ ] Фаза 1 · [ ] Фаза 2 · [ ] Фаза 3 · [ ] Фаза 4 · [ ] Фаза 5 · [ ] Фаза 6 · [ ] Ретест
