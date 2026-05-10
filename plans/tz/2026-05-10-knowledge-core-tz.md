---
type: tz
status: draft
feature: единое информационное ядро Z (knowledge core) — переустройство фундамента продукта
date: 2026-05-10
supersedes: plans/archive/2026-05-10-z-second-brain-integration-superseded.md
references:
  - delivery/ (концепции «Второго мозга компании», заимствуем без копирования кода)
  - https://github.com/iternal-technologies-partners/blockify-agentic-data-optimization (концепции IdeaBlock и pipeline ingest→distill→retrieve)
---

# ТЗ: единое информационное ядро Z

> Это не отдельная фича, а переустройство фундамента Z. Все существующие модули продукта (встречи, карточки, задачи, главы, клипы, AI-чат, поиск) перестраиваются поверх нового ядра. После завершения этого ТЗ Z из «AI-инструмента для встреч» превращается в «корпоративную AI-память компании», для которой встречи — лишь один из источников информации.

## Цель

Построить единый информационный pipeline — приём из любых источников → структурирование в блоки знания → дедупликация → линковка → поиск/чат/дашборды — на стеке Z (NestJS + PostgreSQL+pgvector + BullMQ), и переключить на него все продуктовые поверхности Z, выпилив старые «простые» AI-воркеры.

## Что мы строим — простыми словами

Сейчас Z для каждой встречи делает 4 независимых LLM-прохода (chunks для поиска, tasks, chapters, highlights). Каждый воркер видит **свою** интерпретацию транскрипта, между ними нет общего понимания. Поиск — наивный по 400-токенным кускам. Источник один — встреча.

После реализации этого ТЗ Z работает иначе. Любой входящий текст (транскрипт встречи, сообщение из чат-бота, расшифровка телефонного звонка, email, ручной дамп мысли) проходит через **единый pipeline**:

1. **Ingest.** Сырой текст превращается в черновые «блоки знания» (`IdeaBlock`) — структурированные XML/JSON-объекты с полями: имя, ключевой вопрос, доверенный ответ, упомянутые сущности, теги, ссылки на источник с таймкодами/цитатами.
2. **Distill.** Похожие блоки кластеризуются (LSH/KNN по эмбеддингам) и схлопываются в **канонический** блок через LLM-merge. У канонического блока — все evidence-ссылки на источники-первоисточники. В БД лежит дедуплицированная база, а не миллион вариантов одной мысли.
3. **Linker.** Между блоками строятся типизированные связи (развивает / противоречит / следствие / упоминает одно и то же), между сущностями — тоже (Иван работает в Ромашке).
4. **Retrieve.** Поиск, AI-чат, дашборды и любые продуктовые UX работают поверх дедуплицированной базы блоков и графа связей, а не сырых транскриптов.

Пользовательские поверхности (Tasks, Chapters, Highlights, Card-rollup, AI-чат) переписываются как **тонкие агенты поверх блоков** — они уже не идут к транскрипту самостоятельно, а используют общее структурированное знание.

## Карта решений (зафиксировано в чате 2026-05-10)

| Решение | Принято |
|---|---|
| Подход к Blockify | Только концепции (формат IdeaBlock + pipeline ingest→distill→retrieve + бенчмарки качества). Код Blockify не подключаем — реализуем на TypeScript внутри Z. |
| Старый pipeline | Полная замена. `MeetingTranscriptChunk` и старые extractor'ы tasks/chapters/highlights выпиливаются. Никаких параллельных слоёв. |
| Историческая БД | Чистый лист. Production-данных нет, нечего мигрировать. На старте — `prisma migrate reset` для всех затронутых таблиц. |
| Связи | Все 5 типов в схеме сразу: блок↔источник, блок↔сущность, блок↔Card, блок↔блок (типизированные), сущность↔сущность. |
| Подтверждение связей | Без ручного подтверждения. AI создаёт связи автоматически. Низкоуверенные (`confidence < 0.7`) скрыты в выдаче, но видны в админке отладки. |
| Ingest | Универсальный с первого дня. Pipeline принимает любой источник: встреча, чат, звонок, бот, email, web-form. |
| Card vs Theme | Сосуществуют как разные сущности. Card — ручная папка (привязана к Entity). Theme — AI-кластер блоков по смыслу (поперечный срез). |
| Multi-tenancy | С первого дня. Аккаунт = компания (Org). Главный админ + подключаемые менеджеры. `tenantId` обязателен во всех таблицах ядра. |
| Видимость менеджеров | По умолчанию — менеджеры видят встречи друг друга и общий корпус знаний компании. Owner может включить «строгий режим» (менеджер видит только свои источники + результаты, общие сущности и темы). Тонкая настройка по группам — vNext. |
| Лицензия delivery | Код delivery не копируем (delivery под AGPL — заразит весь Z). Берём концепции, форматы данных, архитектурные паттерны. Промпты пишем своими словами под наши задачи. |
| Русский UI | Смесь принимаем как факт. Существующие термины (Tasks, Highlights, Cards) сохраняем. Новые сущности ядра называем по-русски (Блок знаний, Сущность, Тема, Связь, Источник, Контейнер) — это закрепляется в глоссарии `second-brain/13_glossary` (создать при старте Фазы 0). |
| Две админки | **Z-Admin** (для владельца продукта Z): глобальный обзор всех Org, экономика по всем пользователям и функциям, управление LLM-моделями для каждой функции, A/B сравнение моделей, тарифы. **Org-Admin** (для владельца Org-клиента): локальная экономика своей Org, отладка ядра, управление членами и источниками, тумблеры воркеров. Доступ к Z-Admin — отдельной ролью `super_admin` (вне модели Membership-ролей Org). |
| Логирование стоимости | С первой же фазы каждый LLM-вызов через `LlmRouter` пишет в `AiUsageLog` полную стоимость (tokens × модель × провайдер). Без этого нельзя строить аналитику. Решение принимается на старте, ретроспективно собрать невозможно. |

## Архитектура нового Z после реализации ТЗ

### Пять слоёв

```
┌──────────────────────────────────────────────────────────────┐
│  Слой 5  Продуктовые поверхности                             │
│         AI-чат (org/card/theme/meeting),                     │
│         дашборд директора, карточка встречи,                 │
│         журнал, страница карточки, страница темы             │
├──────────────────────────────────────────────────────────────┤
│  Слой 4  Тонкие агенты над блоками                           │
│         Tasks-2.0, Chapters-2.0, Highlights, Card-rollup,    │
│         Theme-clusterer, Reframing, Strategic-alignment      │
├──────────────────────────────────────────────────────────────┤
│  Слой 3  ЯДРО ЗНАНИЙ (главное)                               │
│         IdeaBlock + Entity + Theme                           │
│         + 5 типов связей                                     │
│         + pipeline ingest→distill→linker→reframing           │
│         + retrieve (поиск, embeddings, граф)                 │
├──────────────────────────────────────────────────────────────┤
│  Слой 2  Сырая память (Raw)                                  │
│         Source + RawEvent (иммутабельный первоисточник)      │
├──────────────────────────────────────────────────────────────┤
│  Слой 1  Адаптеры источников                                 │
│         meeting-adapter, chat-adapter, call-adapter,         │
│         bot-adapter, email-adapter, web-form-adapter         │
└──────────────────────────────────────────────────────────────┘

Сквозные:  Org/Tenant + RBAC, Админка отладки, Audit, Quotas,
           Retention, Observability, LlmRouter
```

### Главное архитектурное правило

**Слой 3 (ядро) — единственный, кто решает, что есть знание.** Слой 4 (агенты) — это «специализации поверх знания», они не имеют права самостоятельно ходить к транскриптам или сырым сообщениям. Слой 5 (UI) — никогда не ходит мимо ядра. Это правило не нарушаем, иначе через год снова получим разрозненные интерпретации.

### Что мы заимствуем из delivery и что не заимствуем

| Из delivery берём (как концепцию) | Не берём |
|---|---|
| 7-слойную организацию (адаптировали в 5 слоёв под наш масштаб) | Стек: Python/FastAPI/Temporal/Kafka/FalkorDB — у нас NestJS/BullMQ/pgvector |
| Сущность типизированных сигналов (M-05/M-06) → нашу `IdeaBlock` дополняем `signalType` | AGPL-лицензированный код |
| Карта компании из ~12 веток (M-07) для Theme-classification | Жёсткое «никаких кнопок» (DR-012) — не применимо к существующему UI Z, но применимо как принцип к новым экранам ядра |
| Темы с весом, динамикой, scoring по 8 факторам (M-08/M-09) | «Все 40 модулей сразу без MVP» (DR-001) — мы фазируем |
| Уровни доверия выводов | Ручное подтверждение связей (отменили) |
| Граф сущностей с типизированными связями (M-11/M-12), но на pgvector + jsonb вместо FalkorDB | FalkorDB+Graphiti на старте. Если pgvector упрётся в потолок — отдельный микросервис graph-сервиса. |
| Принцип «память, не контроль» (DR-013) | Двойной opt-in для mood — vNext (модуль mood пока не входит в скоуп) |
| Provenance (любой ответ AI восстанавливается до источника) | Single-tenant self-host (DR-009) — мы multi-tenant SaaS |

### Соотношение с существующим Z

| Существующий модуль Z | Что с ним происходит |
|---|---|
| `Meeting`, `MeetingParticipant`, `Recording` | Сохраняются. Это законные сущности «встречи как события». Связь с ядром через `Source(type=meeting)`. |
| `MeetingTranscriptChunk` | **Удаляется.** Заменён на `IdeaBlock`. |
| `Task` | Перерождается как Tasks-2.0 — агент над блоками. Старая таблица очищается, схема может слегка измениться. |
| `MeetingChapter` | То же — Chapters-2.0 над блоками. |
| `MeetingHighlight` | Сохраняется (MP4-рендер не меняется), но evidence-ссылка теперь идёт на `IdeaBlock`, не на raw-чанки. |
| `MeetingChatMessage` | Сохраняется. Чат продолжает работать, но ходит за контекстом в блоки, не в чанки. |
| `Card` | Сохраняется. Привязка `Card.entityId` (или несколько) добавляется. `summaryCache` остаётся, но пересобирается агентом-rollup поверх блоков. |
| `Tag`, `MeetingTag` | Сохраняются как ручные пользовательские теги. AI-теги живут на уровне `IdeaBlock.tags`. |
| `AiResult` (`summary`) | Сохраняется как «итоговая сводка встречи для UI карточки», но генерируется новым агентом-summary поверх блоков встречи. |
| `LlmTaskRoute` | Сохраняется и **расширяется** — добавляются новые taskType: `block-ingest`, `block-distill`, `block-linker`, `entity-resolver`, `reframing`, `theme-classify`, `card-rollup-v2`. |
| `ApiKey`, `WebhookSubscription`, `IntegrationDestination`, `Export`, `AuditLog`, `UserQuotaCounter` | Сохраняются как cross-cutting. К ним добавляются `tenantId` и новые события. |
| `User`, `UserSession` | Сохраняются. Поверх — новая сущность `Org`/`Tenant` + `Membership` (см. Фазу 0). |

## Список фаз

| # | Фаза | Длительность (оценка) | Блокирует |
|---|---|---|---|
| 0 | Org/Tenant + Membership + RBAC | 3-4 недели | всё |
| 1 | Универсальный ingest + Raw Memory + meeting-adapter | 2-3 недели | Фаза 2 |
| 2 | IdeaBlock + Entity + pipeline ingest→distill→retrieve | 4-5 недель | Фазы 3, 4, 5 |
| 3 | Связи и граф (4 типа: блок↔блок, сущность↔сущность, переосмысление) | 3-4 недели | Фаза 7 |
| 4 | Card на новой базе + Theme + clusterer + Card-rollup-v2 | 3 недели | Фаза 5 |
| 5 | Переписанные UX-агенты (Tasks-2.0, Chapters-2.0, Summary-2.0) | 3 недели | Фаза 6 |
| 6 | AI-чат и поиск через ядро (org/card/theme/meeting scope) | 2 недели | — |
| 7 | Админка отладки и наблюдения | 3-4 недели | — |
| 8 | Дашборд директора | 3-4 недели | Фаза 9 |
| 9 | Цели компании + стратегический согласователь | 3 недели | — |
| 10 | Дополнительные источники: чаты / звонки / боты / email / web-form | 2 недели на источник | — |
| 11 | Retention, security, 152-ФЗ, observability ядра | 2-3 недели | — |
| 12 | Тарифы и entitlements | 2 недели | релиз |

**Суммарная оценка:** 9–12 месяцев командной работы (зависит от размера команды и параллелизма фаз 6, 7, 10, 11).

**Параллелизм:** после Фазы 2 фазы 3 и 4 можно делать параллельно. После Фазы 5 фазы 6 и 7 параллельно. Фаза 10 (источники) может стартовать сразу после Фазы 1.

---

## Фаза 0 — Org/Tenant + Membership + RBAC

### Цель фазы

Превратить Z из «multi-account для индивидуальных пользователей» в «multi-tenant SaaS для компаний». Аккаунт регистрации становится Org, в которой есть владелец и можно пригласить менеджеров. Все существующие сущности приобретают `tenantId`. RBAC ограничивает доступ к данным по принадлежности к Org.

### Что входит

- Сущность `Org` (компания). Поля: `id`, `name`, `slug`, `ownerId`, `createdAt`, `deletedAt`, `visibilityMode` (`open` / `strict`), `tier` (placeholder под Фазу 12).
- Сущность `Membership` (`orgId`, `userId`, `role` enum: `owner` / `admin` / `manager`, `invitedBy`, `joinedAt`).
- Сущность `OrgInvitation` (для приглашения менеджеров по email с токеном и сроком действия).
- Миграция: при старте — для каждого существующего `User` создаётся персональный `Org` (`name = user.name + " (личный)"`, `ownerId = user.id`). После миграции `Org` становится первичным контейнером.
- Поле `tenantId` (= `orgId`) добавляется во **все** таблицы домена: `Meeting`, `Card`, `Task`, `MeetingChapter`, `MeetingHighlight`, `MeetingChatMessage`, `Tag`, `WebhookSubscription`, `IntegrationDestination`, `Export`, `ApiKey`, `LlmTaskRoute`, `AuditLog`, **`AiUsageLog`**. Backfill — по `userId → Membership.orgId`.
- **Расширение `AiUsageLog`** для аналитики стоимости (важно сделать в Фазе 0, иначе вся последующая аналитика будет неполной):
  - Существующие поля: `id`, `userId`, `taskType`, `createdAt`.
  - Добавляются: `tenantId`, `model` (string — конкретная модель: `claude-sonnet-4-6`, `gpt-4o`, `local-llama-70b`, ...), `provider` (string: `anthropic / openai / proxy / local`), `inputTokens` (int), `outputTokens` (int), `cachedTokens` (int — для prompt caching), `costUsd` (decimal — рассчитывается по таблице цен в момент записи), `latencyMs` (int), `success` (bool), `errorCode` (string?), `sourceRef` (jsonb — `{type: 'meeting'|'block'|'chat'|...', id: '...'}` для группировки по сущности), `experimentGroup` (string? — для A/B-тестов моделей).
- **Сущность `LlmModelPrice`** (новая) — справочник актуальных цен LLM. Поля: `id`, `provider`, `model`, `inputCostPerMillionTokens`, `outputCostPerMillionTokens`, `cachedCostPerMillionTokens`, `effectiveFrom`, `effectiveTo`, `currency` (USD/RUB). Заполняется при деплое + редактируется через Z-Admin (Фаза 7). Используется в момент записи `AiUsageLog` для расчёта `costUsd`.
- **Расширение `LlmTaskRoute`** — добавить `experiment` jsonb (для A/B): `{enabled: bool, modelA: string, modelB: string, splitPercent: number, startedAt, endsAt}`. На старте — пустое, активируется в Z-Admin (Фаза 7).
- RBAC: middleware NestJS, проверяющий, что текущий пользователь имеет `Membership` в `tenantId` запроса. Casbin как первичный engine (model RBAC + tenant + visibilityMode).
- **Роль `super_admin`** — отдельно от модели Org-Membership. Хранится в таблице `User.isSuperAdmin` (bool, default false). Назначается вручную через DB. Доступ к Z-Admin (Фаза 7) только этой роли. Owner Org **не** имеет доступа к Z-Admin (только к Org-Admin своей Org).
- **Модернизация `LlmRouter` middleware** (важно сделать в Фазе 0, до начала Фазы 1):
  - Каждый вызов через `LlmRouter.invoke({taskType, ...})` обязательно пишет в `AiUsageLog` полную запись (token usage из ответа провайдера, расчёт `costUsd` через `LlmModelPrice`, latency, success/error, sourceRef).
  - Если в `LlmTaskRoute.experiment.enabled = true` — выбор модели (A или B) делается случайно по `splitPercent`, в `AiUsageLog.experimentGroup` пишется `A` или `B`. Это включает A/B сравнение из Z-Admin без переписывания кода каждого taskType.
  - Если запись в `AiUsageLog` не удалась (БД упала) — LLM-вызов всё равно проходит, но генерится warning (`metric: ai_usage_log_write_failed`). Эти случаи мониторятся в Grafana.
- API:
  - `POST /orgs` — создать Org (вызывается при регистрации).
  - `GET /orgs/me` — список Org текущего пользователя (на будущее, пока всегда одна).
  - `POST /orgs/:id/invitations` — пригласить менеджера.
  - `POST /orgs/invitations/:token/accept` — принять приглашение.
  - `GET /orgs/:id/members` — список членов.
  - `PATCH /orgs/:id/members/:userId` — изменить роль / удалить.
  - `PATCH /orgs/:id` — изменить настройки Org, включая `visibilityMode`.
- Frontend:
  - На странице регистрации — поле «Название компании» (если пусто, заполняется как «Компания {имя}»).
  - Раздел `/settings/organization` — управление членами и приглашениями, переключатель режима видимости.
  - Все существующие списки (`/meetings`, `/cards`, `/tasks`) фильтруются по `tenantId` текущего Org.
- Видимость менеджеров (логика на основе `Org.visibilityMode`):
  - **`open` (по умолчанию):** менеджеры видят встречи / карточки / задачи друг друга в рамках Org. Это для большинства SMB — общая память компании.
  - **`strict`:** менеджер видит только свои встречи + общие сущности (Entity, Theme — они всегда общие на уровне Org). Исключение — owner/admin видят всё.

### Что не входит

- Тонкая настройка ролей по группам / отделам. Только три роли: owner, admin, manager.
- Миграция одного пользователя между несколькими Org. Пользователь → одна Org.
- SSO / SAML / Keycloak. Стандартная регистрация по email + пароль (как сейчас).

### DoD

- [ ] Любой существующий тестовый пользователь после миграции имеет персональный Org с собой как owner.
- [ ] Создание новой регистрации создаёт Org + Membership.
- [ ] Приглашение по email работает (используется существующий SMTP-сервис из `auth-and-accounts`).
- [ ] Запрос к `/meetings` возвращает только встречи `tenantId = currentOrg.id`.
- [ ] Попытка обратиться к ресурсу чужого Org возвращает 403 (тест).
- [ ] Переключение `visibilityMode = strict` ограничивает менеджера видеть только свои встречи.
- [ ] `User.isSuperAdmin = true` для владельца продукта Z (вручную в БД).
- [ ] Расширение `AiUsageLog` применено, миграция прошла, таблица содержит все новые поля.
- [ ] Таблица `LlmModelPrice` создана и наполнена актуальными ценами для всех используемых моделей (минимум: `claude-sonnet-4-6`, `claude-haiku-4-5`, `text-embedding-3-small`, плюс модели из `proxy.agent-lia.ru`).
- [ ] Существующие LLM-вызовы (старый AI-pipeline до Фазы 1 ещё работает) — после деплоя пишут полную стоимость в `AiUsageLog`. Проверка: после тестовой встречи в `AiUsageLog` есть записи с непустыми `costUsd`, `inputTokens`, `outputTokens`, `model`.
- [ ] Обновлены `second-brain/01_projects/auth-and-accounts.md` (роли расширены) + новый файл `second-brain/01_projects/orgs-and-rbac.md`.

### Риски

- **Backfill `tenantId` на существующих таблицах** — операция тяжёлая, но в нашем случае production-данных нет, риск нулевой.
- **Casbin policy сложность** — visibilityMode сразу даёт 4 ситуации (admin/manager × own/foreign). Тесты на каждую обязательны.
- **Регрессия существующих экранов** — все списки и детали должны быть протестированы под новым фильтром.

---

## Фаза 1 — Универсальный ingest + Raw Memory + meeting-adapter

### Цель фазы

Ввести унифицированный приём входящих данных. Любой текст из любого источника попадает в единую таблицу `RawEvent` через единый ingest API. Реализовать первый адаптер — для существующих транскриптов встреч.

### Что входит

- Сущность `Source` — справочник подключённых источников Org. Поля: `id`, `tenantId`, `type` enum (`meeting / chat / phone_call / bot / email / web_form / external`), `name`, `config` jsonb, `dataClass` (`public / internal / sensitive / private`), `isActive`, `createdAt`.
- Сущность `RawEvent` — иммутабельная запись сырого события. Поля: `id`, `tenantId`, `sourceId`, `sourceType`, `sourceExternalId` (для идемпотентности), `idempotencyKey` (`sha256(sourceId + sourceExternalId + occurredAt)`), `occurredAt`, `receivedAt`, `payload` jsonb (текст + метаданные: участники, таймкоды, тема), `payloadChecksum`, `dataClass`, `processingStatus` enum (`received / ingested / failed`).
- API:
  - `POST /api/v1/ingest` — внутренний endpoint для адаптеров. Принимает `{sourceId, sourceExternalId, occurredAt, payload}`, возвращает `RawEvent.id`. Идемпотентен по `idempotencyKey`.
  - `GET /api/v1/raw-events/:id` — для отладки (доступ только admin Org).
- meeting-adapter (`backend/src/modules/ingest/adapters/meeting.adapter.ts`):
  - При событии `meeting.ai_ready` (его триггерит существующий `analyze.worker` после транскрипции) адаптер вытаскивает транскрипт + участников + метаданные встречи и POST'ит в `/ingest`.
  - Для каждой Org заводится один `Source(type=meeting, name="Встречи Z")` автоматически при создании Org.
- Внутренний contract для будущих адаптеров (внутренний интерфейс TS), чтобы chat/call/bot/email-адаптеры в Фазе 10 строились по единой схеме.
- Event bus (через BullMQ): после успешного `ingest` публикуется событие `raw.received` с `rawEventId`. На этом событии в Фазе 2 подпишется pipeline `block-ingest`.

### Что не входит

- Адаптеры для чатов / звонков / ботов / email — это Фаза 10.
- UI для управления источниками — пока только дефолтный `meeting-source` создаётся автоматически. Управление — vNext.

### DoD

- [ ] Проведение тестовой встречи → транскрипция → автоматический POST в `/ingest` → `RawEvent` появился в БД.
- [ ] Двойной вызов `/ingest` с теми же данными не создаёт дубль (идемпотентность).
- [ ] `payloadChecksum` совпадает с независимым sha256 от `payload`.
- [ ] Событие `raw.received` публикуется в BullMQ-очередь `core.raw-events`.
- [ ] Старая логика `transcript-index.worker` отключена (jobs не запускаются), таблица `MeetingTranscriptChunk` помечена `@deprecated` в схеме.
- [ ] Обновлён `second-brain/01_projects/ai-workspace.md` (раздел про raw ingest), создан `second-brain/01_projects/ingest-and-sources.md`.

### Риски

- **Совместимость с существующим `analyze.worker`** — после ingest он не должен дублировать запись чанков. Нужен явный флаг `useNewPipeline` или полная замена воркера (предпочтительнее).
- **Размер `RawEvent.payload`** — транскрипты могут быть большие (десятки MB). Решение: jsonb до 10MB кладём inline, больше — в S3 (`payloadStorage = inline | s3`, `payloadS3Key`).

---

## Фаза 2 — IdeaBlock + Entity + pipeline ingest→distill→retrieve

### Цель фазы

Главная фаза. Построить ядро. После завершения этой фазы любой `RawEvent` автоматически превращается в дедуплицированные `IdeaBlock`-и со связанными `Entity`, и поиск по ним работает через cosine + keywords.

### Что входит

- Сущность `IdeaBlock`. Поля: `id`, `tenantId`, `name`, `criticalQuestion`, `trustedAnswer`, `tags` text[], `signalType` enum (`fact / pain / feature_request / objection / churn_risk / idea / risk / commitment / decision / mood / drift / competitor_move / metric_change / knowledge_gap`), `confidence`, `dataClass`, `embedding` vector(1536), `createdAt`, `updatedAt`, `status` enum (`draft / canonical / merged_into / archived`), `mergedIntoId` (для дедуплицированных), `evidenceCount`, `dynamicScore`.
- Сущность `IdeaBlockEvidence` — связь блока с источником. Поля: `blockId`, `rawEventId`, `sourceType`, `sourceTimestamp`, `quote` (дословный фрагмент сырья), `startMs`, `endMs` (для медиа-источников). Many-to-many.
- Сущность `Entity` — упомянутая бизнес-сущность. Поля: `id`, `tenantId`, `type` enum (`client / person / project / product / topic / location / custom`), `canonicalName`, `aliases` text[], `mergedIntoId` (для склейки дублей), `mentionsCount`, `embedding` vector(1536), `metadata` jsonb (для типов — например, для `person`: должность, email; для `client`: ИНН, домен).
- Сущность `IdeaBlockEntity` — связь блока с сущностями. Поля: `blockId`, `entityId`, `mentionContext` (как именно упомянули — оригинальная форма), `role` (опционально — `subject / object / mentioned`).
- Воркер `block-ingest.worker` (очередь `core.block-ingest`):
  - На событие `raw.received` берёт `RawEvent`, режет на смысловые сегменты (не по токенам, а по абзацам/смысловым границам — определяется LLM-вызовом «найди границы тем»).
  - Для каждого сегмента — один LLM-вызов `block-ingest` (в `LlmRouter` — новый taskType): «извлеки IdeaBlock-и в формате JSON». Промпт пишем своими словами, но формат вывода — IdeaBlock из Blockify.
  - Для каждого извлечённого блока — параллельно: запрос эмбеддинга (`embedding-fallback.service`), сохранение `IdeaBlock(status=draft)`, запись `IdeaBlockEvidence`, создание/поиск `Entity` для каждой упомянутой сущности, запись `IdeaBlockEntity`.
  - По завершении — публикация события `block.draft-created` для каждого блока.
- Воркер `block-distill.worker` (очередь `core.block-distill`):
  - На событие `block.draft-created` — для нового блока: KNN-поиск (pgvector cosine) среди `IdeaBlock(status=canonical)` того же `tenantId` — top-K кандидатов на дубль.
  - Если есть кандидат с `cosine_similarity > DISTILL_MERGE_THRESHOLD` (по умолчанию 0.92) — LLM-вызов `block-distill` (новый taskType): «вот два блока, это одна и та же мысль или разные? Если одна — слей в канонический».
  - Если LLM сказал «слить» — обновляем канонический блок (объединяем evidence, теги, увеличиваем `evidenceCount`, обновляем `confidence` как взвешенное среднее), новый блок помечаем `status=merged_into`, `mergedIntoId = canonical.id`.
  - Если кандидата нет или LLM сказал «разные» — новый блок помечается `status=canonical`.
  - Дебаунс: запускается через 30 секунд после `block.draft-created` (батчем для всех новых блоков), чтобы не делать лишние LLM-вызовы для группы блоков, которые сами между собой могут быть дублями.
- Воркер `entity-resolver.worker` (очередь `core.entity-resolver`):
  - Раз в 5 минут (cron) или на событие `entity.created`: ищет в `Entity` того же `tenantId` потенциальные дубли (через эмбеддинг имени + cosine + проверка пересечения metadata).
  - Если cosine > `ENTITY_MERGE_THRESHOLD` (0.88) — LLM-вызов: «это одна и та же сущность?». Если да — мерджит (`mergedIntoId`), переставляет `IdeaBlockEntity` на каноническую.
- API:
  - `POST /api/v1/search` — гибридный поиск. Параметры: `q`, `tenantId` (из контекста), `signalTypes[]`, `entityIds[]`, `dateFrom/To`, `limit`. Логика: pgvector cosine `q.embedding` × `IdeaBlock.embedding` + Postgres `ts_vector` BM25 по `name + criticalQuestion + trustedAnswer`. Результат сортируется по линейной комбинации (веса настраиваются в ENV). Возвращает блоки + evidence (для UI «вот источники»).
  - `GET /api/v1/blocks/:id` — получить блок с evidence + связанными сущностями.
  - `GET /api/v1/entities` — список сущностей с фильтром по типу.
  - `GET /api/v1/entities/:id` — сущность + связанные блоки + (vNext) другие сущности через граф.
- Бенчмарк качества: `backend/scripts/benchmark-knowledge-core.ts` — на golden-set из ~50 транскриптов проверяет:
  - точность поиска (top-3 hit rate) vs старый chunk-based;
  - степень сжатия (соотношение `count(IdeaBlock canonical) / count(RawEvent text-tokens / 400)`);
  - покрытие сущностей (доля упомянутых в транскрипте имён/клиентов, попавших в `Entity`).
  - Цель: точность не хуже **+50%** vs старый chunk RAG, сжатие в **5×** на старте (40× — это уже на стабильной базе через месяцы).

### Что не входит

- Связи блок↔блок (типизированные) и связи сущность↔сущность — это Фаза 3.
- Ночное переосмысление (Reframing) — Фаза 3.
- Темы (Theme) — Фаза 4.

### DoD

- [ ] После регистрации Org, проведения встречи, транскрипции, ingest и distill — в `IdeaBlock` появляются дедуплицированные блоки (для тестового транскрипта 1 час видео — порядка 30-80 канонических блоков).
- [ ] `Entity` содержит упомянутые в транскрипте имена/клиентов/проекты, без явных дублей (или с явными `mergedInto` цепочками).
- [ ] `POST /api/v1/search` возвращает релевантные блоки с evidence-ссылками на встречу + таймкод + цитату.
- [ ] Бенчмарк прогнан, цифры записаны в `docs/benchmarks/knowledge-core-baseline.md`.
- [ ] Старая таблица `MeetingTranscriptChunk` дропнута миграцией.
- [ ] Обновлён `second-brain/02_architecture/data-model.md` (новые сущности + ER-диаграмма).
- [ ] Создан `second-brain/02_architecture/knowledge-core.md` (объяснение pipeline).

### Риски

- **Качество ingest-промпта.** Главный риск фазы. Митигация: итеративная отладка на 5-10 разных типах встреч, A/B-сравнение результатов, фиксация лучшего промпта в `LlmTaskRoute`.
- **Стоимость LLM на distill.** Каждый новый блок → KNN + (если есть кандидат) LLM-вызов merge. На большой Org может вырасти. Митигация: жёсткий порог cosine для отсечения, дебаунс батчами, кэш запросов merge.
- **Entity dedup может схлопывать разное.** «Иван Петров» из ООО А и «Иван Петров» из ООО Б — разные люди. Митигация: при entity-merge LLM-арбитр обязательно смотрит на metadata + контекст ближайших блоков, не только на имя.

---

## Фаза 3 — Связи и граф

### Цель фазы

Построить второй уровень знания: типизированные связи между блоками, между сущностями, и фоновое переосмысление графа.

### Что входит

- Сущность `IdeaBlockLink`. Поля: `id`, `tenantId`, `fromBlockId`, `toBlockId`, `relationType` enum (`develops / contradicts / causes / consequences_of / shares_topic / shares_entity / question_answered_by`), `confidence`, `explanation`, `createdBy` (`linker / reframing / manual`), `createdAt`.
- Сущность `EntityLink`. Поля: `id`, `tenantId`, `fromEntityId`, `toEntityId`, `relationType` enum (`works_at / belongs_to / part_of / opposes / depends_on / mentions_with`), `confidence`, `explanation`, `createdBy`.
- Воркер `block-linker.worker`:
  - На событие `block.canonical-created` (после distill) — KNN top-K кандидатов на типизированную связь.
  - LLM-вызов: «вот блок A и блок B, есть ли между ними связь? Какого типа? Объяснение в 1-2 фразы».
  - Записывает в `IdeaBlockLink` если `confidence > LINK_MIN_CONFIDENCE` (0.75).
  - Условие старта: количество канонических блоков в Org ≥ `LINKER_MIN_BLOCKS` (по умолчанию 50). До этого порога — линкер пропускает Org (нечего связывать).
- Воркер `entity-graph-builder.worker`:
  - Раз в час: для пар сущностей, которые часто упоминаются вместе в одних блоках, LLM-вызов «есть ли отношение между этими сущностями?».
  - Записывает в `EntityLink`.
- Воркер `reframing.worker` (cron, ночью):
  - Раз в сутки: пересматривает блоки и связи, созданные за последние N дней:
    - связи с `confidence < 0.5` и без подтверждений → `status=archived`;
    - блоки без новых evidence за 90 дней → `dynamicScore` понижается;
    - LLM-вызов: «эти 10 блоков — может, это одна тема, разделившаяся? или две темы, объединившиеся?». Может породить пересборку Theme в Фазе 4.
- API:
  - `GET /api/v1/blocks/:id/links` — связи блока (исходящие + входящие).
  - `GET /api/v1/entities/:id/links` — связи сущности.
  - `GET /api/v1/graph/neighbors?nodeType=block|entity&id=...&depth=1..3` — обход графа на N шагов для UI визуализации.

### Что не входит

- Графовая БД (FalkorDB). Все связи в Postgres + jsonb. Если pgvector + jsonb окажутся медленными на большой Org (>10k сущностей, >100k связей) — отдельный ADR + микросервис.
- UI визуализация графа — vNext.

### DoD

- [ ] Связи появляются после порога 50 блоков в Org.
- [ ] Каждая связь имеет confidence + explanation.
- [ ] Сущности «Иван» и «Ромашка» автоматически связаны как `works_at` (если упомянуто).
- [ ] Reframing запускается ночью, отчёт в логах: «архивировано N связей, понижен score у M блоков».
- [ ] Обновлён `second-brain/02_architecture/knowledge-core.md` (раздел про граф).

### Риски

- **Шум связей.** LLM может выдумывать. Митигация: жёсткий порог, наблюдение в админке (Фаза 7), возможность массового удаления.
- **Производительность KNN на больших Org.** Митигация: `ivfflat` индекс с настройкой lists, cron на pgvector ANALYZE.

---

## Фаза 4 — Card на новой базе + Theme + clusterer + Card-rollup-v2

### Цель фазы

Адаптировать существующий Card к новой архитектуре. Ввести новую сущность Theme как AI-кластер блоков. Card-rollup переписать поверх блоков.

### Что входит

- Изменения в `Card`:
  - Добавить `Card.entityId` (опционально — основная сущность карточки) или `Card.entityIds` для множественной привязки. **Решение:** одно primary `entityId` + опциональный массив `relatedEntityIds`. Это совместимо с текущим one-to-many.
  - Поле `summaryCache` остаётся, генерится через новый агент `card-rollup-v2`.
- Сущность `Theme`. Поля: `id`, `tenantId`, `name`, `description`, `weight` (важность), `dynamic` enum (`growing / stable / declining`), `confidence`, `status` enum (`active / archived / merged_into`), `mergedIntoId`, `branch` (одна из 12 веток компании из delivery M-07: `strategy / clients / sales / marketing / product / operations / team / finance / technology / production / partnerships / legal`), `embedding` vector(1536), `createdAt`, `lastSignalAt`.
- Сущность `ThemeIdeaBlock` — many-to-many.
- Сущность `ThemeEntity` — denormalized связь темы с упомянутыми сущностями (для быстрых фильтров).
- Воркер `theme-clusterer.worker`:
  - Раз в час или на событие «накопилось N новых блоков»: берёт блоки за последние X дней без темы, кластеризует по эмбеддингам (DBSCAN или HDBSCAN на TS-имплементации, или простой KNN-greedy clustering).
  - Для каждого устойчивого кластера (≥3 блока, плотность выше порога) — LLM-вызов «дай этому кластеру имя, описание, ветку компании, теги».
  - Создаёт Theme, привязывает блоки.
- Расширение `reframing.worker` (из Фазы 3): добавляется логика «проверить, не разделилась ли тема на две / не объединить ли две темы в одну».
- Воркер `card-rollup-v2.worker`:
  - Заменяет существующий `card-rollup.worker`.
  - Триггер: тот же — после ai_ready встречи с `cardId`, после link/unlink, после regenerate.
  - Логика: берёт все `IdeaBlock`, привязанные к встречам Card (через `Source → RawEvent → IdeaBlock`), плюс блоки с упоминанием `Card.entityId`. Один LLM-вызов с промптом из 5 вариантов (по `Card.kind`: client / deal / project / topic / custom).
  - Дополнительно: для Card возвращается список **топ-3 связанных Theme** (через блоки карточки).
- API:
  - `GET /api/v1/themes` — список тем Org.
  - `GET /api/v1/themes/:id` — тема + блоки + сущности.
  - `POST /api/v1/themes/:id/save-as-card` — пользователь решил «забрать тему в свою папку Card»: создаёт Card с `kind=topic`, `bornFromThemeId`.
  - `GET /api/v1/cards/:id/themes` — связанные с карточкой темы.
- Frontend:
  - Новый раздел `/themes` — список AI-обнаруженных тем с фильтром по ветке.
  - Страница темы `/themes/:id` — описание + список блоков (с evidence) + кнопка «Сохранить как карточку».
  - На странице Card — секция «AI обнаружил эти темы поверх вашей карточки».

### Что не входит

- Ручное создание Theme пользователем — Theme только AI. Если пользователь хочет ручную тему — он создаёт Card с `kind=topic`.
- Sentiment / прогресс-метрики тем — vNext.

### DoD

- [ ] После накопления ~100 блоков в Org появляются первые Theme (cron-цикл).
- [ ] Caрd-rollup-v2 заменяет старый, генерит более согласованные сводки.
- [ ] На странице Card видны связанные темы.
- [ ] Кнопка «Сохранить тему как карточку» работает.
- [ ] Обновлён `second-brain/01_projects/cards.md` (раздел про новую модель).
- [ ] Создан `second-brain/01_projects/themes.md`.

### Риски

- **Plurality of clustering algorithms.** На TypeScript нет хороших HDBSCAN-библиотек. Митигация: на старте — простой KNN-greedy clustering; если качество не устроит — Python-микросервис только для clustering (узкая специализация).
- **Несоответствие веток delivery нашему бизнесу.** Список из 12 веток может не подойти. Митигация: ветка опциональна (`branch?`), на старте LLM сам решает; ветки можно настраивать через админку (vNext).

---

## Фаза 5 — Переписанные UX-агенты (Tasks-2.0, Chapters-2.0, Summary-2.0)

### Цель фазы

Переписать пользовательские поверхности (задачи, главы, итоговая сводка встречи) как тонкие агенты поверх блоков. Старые extractor'ы выпиливаются.

### Что входит

- Tasks-2.0 (`backend/src/modules/tasks/services/tasks-extractor-v2.service.ts`):
  - Триггер: после Фазы 2 (блоки встречи готовы) — событие `meeting.blocks-ready`.
  - Логика: берёт блоки встречи с `signalType IN ('commitment', 'decision')`, плюс LLM-вызов «вот блоки встречи, есть ли в них explicit задачи?». Возвращает структурированные задачи.
  - Каждая задача хранит `evidenceBlockIds` — какие блоки её породили.
  - Удаляется старый `tasks-extract.worker`.
- Chapters-2.0:
  - Аналогично — глава = группа блоков, идущих подряд по таймкоду + связанных по теме. Один LLM-вызов «нарежь блоки на главы, дай каждой название и описание».
  - Удаляется старый `chapters.worker`.
- Summary-2.0:
  - `AiResult.summary` теперь генерится поверх блоков встречи: «вот канонические блоки этой встречи, напиши итоговую сводку для пользователя по типу встречи (один из 9)».
  - Прежний многократный проход по сырому транскрипту убирается.
- Highlights остаётся как есть (MP4-рендер не меняется), но `MeetingHighlight.evidenceBlockId` добавляется как ссылка.
- Новый `analyze.worker` оркеструет: после ingest+distill встречи (Фаза 1+2 для конкретной встречи) → параллельно tasks-2, chapters-2, summary-2 → завершение `meeting.ai-status = ai_ready`.

### Что не входит

- Изменение UI карточки встречи — данные остаются в тех же полях, frontend не меняется (или меняется минимально для отображения evidence-ссылок).

### DoD

- [ ] Карточка тестовой встречи показывает задачи / главы / сводку, как и раньше, но без старых воркеров.
- [ ] Каждая задача / глава имеет ссылку на породивший блок (для отладки).
- [ ] Старые воркеры (`tasks-extract.worker`, `chapters.worker`) удалены из кода.
- [ ] Бенчмарк: качество tasks/chapters/summary не хуже старого подхода (golden-set ручная оценка).
- [ ] Обновлён `second-brain/01_projects/ai-workspace.md`.

### Риски

- **Регрессия UX.** Главный риск. Митигация: ручной A/B на 10 встречах, владелец сравнивает результаты.
- **Tasks хранятся в IdeaBlock как `signalType=commitment`, но также копируются в Task.** Дублирование данных. Решение: Task — это **указатель** на блок + дополнительные поля (исполнитель, дедлайн, статус выполнения), а текст задачи — из блока.

---

## Фаза 6 — AI-чат и поиск через ядро

### Цель фазы

Все варианты AI-чата (per-meeting, per-card, per-theme, org-wide) переключить на единый retrieval поверх блоков.

### Что входит

- Сервис `chat-v2.service.ts` с единым методом `ask({tenantId, scope, query, history})`, где `scope` — `org | meeting | card | theme | entity`.
- Логика retrieval (поверх Фазы 2 search):
  - Подбор релевантных блоков с учётом scope-фильтров.
  - Подбор связанных блоков через граф (Фаза 3) — например, для блока с `signalType=risk` подтянуть блоки `causes` / `consequences_of`.
  - LLM-вызов: вот контекст из N блоков с evidence, ответь на вопрос. В ответе обязательно цитаты с указателями на источник (встреча + таймкод).
- API:
  - `POST /api/v1/chat` — body: `{scope, scopeId?, query, sessionId?}`. Возвращает поток (SSE) с ответом + цитатами.
  - `GET /api/v1/chat/sessions/:id/history` — история диалога.
- Новый AI-чат на главной странице организации — `/chat` (org-scope).
- Существующие чаты (per-meeting, per-card) — переключены на `chat-v2.service` без изменения UI.
- Удаляется старый `chat.service` после успешного A/B.

### Что не входит

- Голосовой ввод — vNext.
- Многошаговые reasoning-сессии (LangGraph-style) — vNext.

### DoD

- [ ] Все четыре scope чата работают через единый сервис.
- [ ] Каждый ответ AI содержит цитаты с кликабельными ссылками на встречу+таймкод.
- [ ] Латентность p95 < 6 сек на стандартный запрос (Org с 1k блоков).
- [ ] Старый `chat.service` удалён.

### Риски

- **Скрытая зависимость от старой схемы chunks** в каких-то местах. Митигация: глобальный grep + интеграционные тесты.

---

## Фаза 7 — Админка: отладка, наблюдение, аналитика стоимости, управление моделями

### Цель фазы

Дать **двум разным аудиториям** операционный контроль над продуктом:

- **Z-Admin** (для владельца продукта Z, роль `super_admin`): глобальная экономика всех Org, управление LLM-моделями для каждой функции, A/B-сравнение моделей, тарифы, тех. отладка системы в целом.
- **Org-Admin** (для владельца Org-клиента, роль `owner`/`admin` в Membership): локальная экономика своей Org, отладка ядра знаний, управление членами, источниками, тумблеры воркеров.

### Часть 7.A — Z-Admin (глобальная админка владельца продукта Z)

Доступна по пути `/admin/*`, защищена middleware `RequireSuperAdmin`. Существующая страница `/admin/ai-models` поглощается этим разделом.

#### 7.A.1. Дашборд глобальной экономики

Страница `/admin` (главная Z-Admin):

- **Глобальные счётчики:** число Org, число пользователей, число активных Org за 7/30 дней, общий расход LLM в USD за сутки/неделю/месяц.
- **График расхода во времени** (стек по провайдерам: anthropic / openai / proxy / local).
- **Топ Org по расходам** — таблица: Org, тариф, расход за период, количество встреч/блоков/чат-сообщений, эффективность (USD на одну единицу полезной работы).
- **Топ функций по расходам** — таблица: taskType, доля расхода, средняя стоимость за вызов, средняя длительность.
- **Алерты:** Org с аномальным расходом (×3 от среднего за неделю), функции с высокой ошибочностью (>5% fail rate за сутки).

#### 7.A.2. Аналитика по пользователям (детализация для отладки)

Страница `/admin/usage/users`:

- Таблица: пользователь (email), Org, расход за период (USD), число LLM-вызовов, разбивка по taskType, средняя стоимость на встречу.
- Drill-down: клик на пользователя → лента всех его LLM-вызовов за период с подробностями (модель, токены, стоимость, длительность, успех/ошибка, sourceRef-ссылка на встречу).
- Фильтры: период (день/неделя/месяц/произвольно), Org, taskType, провайдер, модель.
- Экспорт CSV для бухгалтерии.

#### 7.A.3. Аналитика по функциям (для оценки экономики каждой функции отдельно)

Страница `/admin/usage/functions`:

- Каждая функция = `taskType` (полный список новых: `block-ingest`, `block-distill`, `block-linker`, `entity-resolver`, `entity-merge-arbiter`, `theme-classify`, `theme-clusterer`, `reframing`, `card-rollup-v2`, `task-extract-v2`, `chapter-extract-v2`, `summary-v2`, `chat-v2`, `goal-alignment`, `dashboard-summary`).
- На карточке каждой функции:
  - Текущая модель (из `LlmTaskRoute`) + текущий fallback.
  - Среднее: стоимость за вызов, длительность, fail rate, средние input/output токены.
  - График активности за последние 30 дней.
  - Ссылки на 10 последних вызовов (для проверки качества вручную).
- Drill-down на конкретный вызов: видны вход (промпт + контекст), выход (raw response), все технические метрики.

#### 7.A.4. Управление моделями для каждой функции

На той же странице `/admin/usage/functions`:

- Для каждой функции — кнопка «Сменить модель»:
  - Селект из доступных моделей (список приходит из `LlmModelPrice`).
  - Возможность настроить fallback chain (массив моделей в порядке убывания приоритета).
  - При сохранении — обновляется `LlmTaskRoute`, новые вызовы идут уже на новую модель.
- Кнопка «Запустить A/B-эксперимент»:
  - Выбор: модель A (текущая), модель B (из списка), процент разделения (по умолчанию 50/50), длительность эксперимента (по умолчанию 7 дней или 100 вызовов).
  - При активации — `LlmTaskRoute.experiment.enabled = true`, middleware начинает писать `experimentGroup = A | B` в каждый `AiUsageLog`.
  - Страница эксперимента `/admin/experiments/:taskType` показывает в реальном времени: количество вызовов A vs B, средняя стоимость, средняя длительность, fail rate, средние токены. Для **качественного** сравнения — список 10 последних вызовов A и 10 последних B параллельно (для глазной оценки качества ответов).
  - По окончании эксперимента — кнопки «Перейти на A», «Перейти на B», «Продлить эксперимент», «Откатить настройки».

#### 7.A.5. Управление LlmModelPrice (тарифы провайдеров)

Страница `/admin/llm-prices`:

- Таблица всех известных моделей с текущими ценами: provider, model, input/output/cached cost per 1M tokens, currency, effectiveFrom/To.
- Возможность добавить новую цену (новая запись с `effectiveFrom = now`, старая получает `effectiveTo = now`).
- При расчёте `costUsd` в `AiUsageLog` всегда берётся актуальная цена на момент вызова (через JOIN на effectiveFrom/To).

#### 7.A.6. Управление тарифами и Org

Страница `/admin/orgs`:

- Таблица всех Org: название, тариф, владелец, дата регистрации, число пользователей, расход за месяц.
- Действия: сменить тариф, заморозить Org, разморозить, удалить.
- Эта часть наполняется в Фазе 12 (тарифы), но скелет страницы — здесь.

#### 7.A.7. Глобальный мониторинг здоровья системы

Страница `/admin/health`:

- Состояние всех воркеров (по всем Org): сколько jobs в очереди, сколько failed за сутки, средняя длительность.
- Состояние внешних провайдеров (anthropic/openai/proxy): доступность, средняя latency, fail rate.
- Размер БД, использование S3, количество эмбеддингов.
- Алерты по интеграциям с Prometheus + Grafana (см. Фазу 11).

### Часть 7.B — Org-Admin (локальная админка владельца Org)

Доступна по пути `/settings/admin/*` для роли `owner`/`admin` в текущей Org. Видит **только** данные своей Org.

#### 7.B.1. Локальная экономика

Страница `/settings/admin/usage`:

- То же, что в 7.A.1, но **только** по своей Org: расход за период, разбивка по taskType, по пользователям внутри Org.
- Owner видит сколько ему стоит каждый менеджер и каждая функция.
- Экспорт CSV.

#### 7.B.2. Отладка ядра знаний

Страница `/settings/admin/knowledge-core`:

- **Тумблеры воркеров:** `block-ingest`, `block-distill`, `block-linker`, `entity-resolver`, `theme-clusterer`, `reframing`. Сохраняются в `Org.workersEnabled` jsonb. Влияют только на данную Org.
- **Журнал последних 200 событий** (`AuditLog` с фильтром по `tenantId = currentOrg.id` и `entity_type IN ('IdeaBlock', 'Entity', 'IdeaBlockLink', 'EntityLink', 'Theme')`).
- **Просмотр последних 100 связей** своей Org с фильтром по типу, confidence, времени. Сортировка по confidence ↑. Действия: **удалить связь**, **изменить тип**, **массово удалить отфильтрованные**.
- **Управление сущностями:** список `Entity` своей Org с `mentionsCount`, поиск по имени. Действия: **слить две**, **расклеить**, **переименовать canonical**, **добавить alias**.
- **«Перезапустить pipeline для источника»:** кнопка на любом RawEvent своей Org.
- **Метрики Org:** счётчики (RawEvent, IdeaBlock, Entity, Theme, Links за всё время и за период), средний confidence по типам, расход LLM-токенов за сутки/неделю, количество jobs в очередях этой Org.

#### 7.B.3. Управление членами и источниками

Эти части частично уже сделаны в Фазе 0 (`/settings/organization` — члены) и Фазе 10 (`/settings/sources` — источники). В 7.B они объединяются под общий навигатор `/settings/admin/*`.

### API (общее для 7.A и 7.B)

- `GET /api/v1/admin/usage/dashboard?scope=global|org&period=...` — главный дашборд (с проверкой роли).
- `GET /api/v1/admin/usage/users?scope=global|org&period=...&filters=...` — детализация по пользователям.
- `GET /api/v1/admin/usage/functions?scope=global|org&period=...` — детализация по функциям.
- `GET /api/v1/admin/usage/calls?taskType=...&limit=10&offset=...` — лента вызовов (для drill-down).
- `PATCH /api/v1/admin/llm-routes/:taskType` — сменить модель/fallback (только super_admin).
- `POST /api/v1/admin/experiments` — запустить A/B (только super_admin).
- `GET /api/v1/admin/experiments/:taskType` — статус эксперимента.
- `POST /api/v1/admin/experiments/:taskType/finish?winner=A|B` — завершить эксперимент.
- `GET /api/v1/admin/llm-prices` / `POST /api/v1/admin/llm-prices` — таблица цен (super_admin).
- `GET /api/v1/admin/orgs` / `PATCH /api/v1/admin/orgs/:id` — управление Org (super_admin).
- `GET /api/v1/admin/health` — мониторинг (super_admin).
- `PATCH /api/v1/admin/knowledge-core/workers` — toggle (org-admin).
- `POST /api/v1/admin/entities/:id/merge` body `{intoEntityId}` — org-admin.
- `POST /api/v1/admin/entities/:id/unmerge` — org-admin.
- `DELETE /api/v1/admin/links/:id` — org-admin.
- `POST /api/v1/admin/raw-events/:id/reprocess` — org-admin.

### Что не входит

- Полноценный billing-модуль (выставление счетов, оплата) — vNext, отдельный проект. В 7.A.6 только просмотр + ручные действия.
- Кастомные дашборды (drag-and-drop виджеты) — vNext.
- Алерты по email/telegram о превышении расходов — vNext (можно добавить в Фазу 11 если нужно).

### DoD

- [ ] Super_admin заходит в `/admin` — видит реальные данные по всем Org.
- [ ] Super_admin может детализировать расход до конкретного LLM-вызова с просмотром промпта и ответа.
- [ ] Super_admin меняет модель для функции `block-distill` — следующие вызовы идут на новую модель (проверка через `AiUsageLog`).
- [ ] Super_admin запускает A/B на функции `summary-v2` — после 50 вызовов видит сравнение метрик A vs B.
- [ ] Owner Org заходит в `/settings/admin/usage` — видит только свою экономику, не чужую.
- [ ] Owner Org может выключить любой воркер своей Org — jobs перестают обрабатываться (но не теряются — копятся в очереди).
- [ ] Owner Org может найти и слить две сущности, изменения отражаются на блоках.
- [ ] Перезапуск RawEvent работает: блоки исчезают, потом появляются заново.
- [ ] Попытка Owner Org зайти в `/admin` возвращает 403.
- [ ] Все метрики на дашбордах свежие (TTL ≤ 1 минута).
- [ ] Создан `second-brain/01_projects/admin-knowledge-core.md`.
- [ ] Создан `second-brain/01_projects/admin-z-global.md` (про Z-Admin: чем отличается от Org-Admin, кто имеет доступ, какие задачи решает).

### Риски

- **Опасные операции в Org-Admin.** Расклейка сущностей или массовое удаление связей — необратимы. Митигация: явное подтверждение через диалог + лог в `AuditLog` с возможностью восстановления (удалённые сохраняем в `IdeaBlockLink_deleted` 30 дней).
- **Утечка данных между Org через Z-Admin.** Super_admin технически видит чужие данные. Митигация: каждое drill-down действие super_admin'а пишется в отдельный `SuperAdminAccessLog`, на email super_admin'а ежемесячный отчёт «вы заглядывали в данные Org X в такие-то даты», для compliance.
- **A/B эксперимент даёт нестабильные ответы пользователям.** Если на одинаковый запрос разный человек получит разный ответ из-за рандома — может быть путаница. Митигация: при активном эксперименте показывать в UI плашку «AI работает в режиме сравнения моделей, ответы могут отличаться» (для super_admin визуально, для конечного пользователя — невидимо или опционально).
- **Расчёт `costUsd` устаревает.** Цены провайдеров меняются. Митигация: `LlmModelPrice` версионируется через `effectiveFrom/To`, ретроспективные расчёты всегда используют цену на момент вызова, а не текущую.

---

## Фаза 8 — Дашборд директора

### Цель фазы

Главная страница для роли `owner` — срез знаний компании за день/неделю/месяц.

### Что входит

- Страница `/dashboard` (для `owner` показывается «директорский» вид; для `manager` — личный, как сейчас).
- Виджеты:
  - **«Что узнали за неделю»** — топ-10 новых тем + топ-10 новых сигналов с высоким весом.
  - **«Сигналы клиентов»** — счётчики по типам: pain / feature_request / churn_risk за период.
  - **«Активные темы»** — топ тем с `dynamic=growing`.
  - **«Главные сущности недели»** — клиенты/проекты с наибольшим ростом упоминаний.
  - **«Открытые вопросы»** — блоки с `signalType=knowledge_gap`.
  - **AI-чат «Спросите про вашу компанию»** — org-scope чат (Фаза 6).
- API:
  - `GET /api/v1/dashboard/director?period=week|month` — все виджеты одним запросом.

### Что не входит

- Топ-индикатор «Согласованность стратегии» (M-16) — это Фаза 9.

### DoD

- [ ] При входе в Z как `owner` — попадает на дашборд, видит виджеты с реальными данными.
- [ ] Чат на главной отвечает на вопросы с цитатами.

---

## Фаза 9 — Цели компании + стратегический согласователь

### Цель фазы

Ввести цели компании как первоклассную сущность и стратегический согласователь — индикатор «движемся ли к цели».

### Что входит

- Сущность `Goal`. Поля: `id`, `tenantId`, `name`, `description`, `targetDate`, `status` (`active / paused / achieved / abandoned`), `weight`.
- Связь `Goal ↔ Theme` (many-to-many).
- Воркер `strategic-alignment.worker`:
  - Раз в сутки: для каждой цели берёт связанные темы + блоки, LLM-вызов «движется ли компания к этой цели по последним сигналам? оценка 0-100, объяснение».
  - Записывает в `GoalAlignmentSnapshot` (history).
  - Если оценка резко упала — сигнал в дашборд директора.
- Страница `/goals` — управление целями + текущий «согласованность» по каждой.
- На дашборде директора — топ-индикатор «Согласованность стратегии» (среднее по целям).

### DoD

- [ ] Owner создаёт 3 цели, через сутки видит индикаторы.
- [ ] При резком падении индикатора виджет на дашборде подсвечивается.

---

## Фаза 10 — Дополнительные источники

### Цель фазы

Подключить остальные адаптеры: чат-боты, телефонные звонки, email, ручной web-form.

### Что входит (по адаптеру, можно делать параллельно)

- **chat-bot adapter** (Telegram-bot, опционально WhatsApp Business): свой sub-модуль `backend/src/modules/ingest/adapters/telegram.adapter.ts`, регистрирует Source(type=bot), обрабатывает webhooks, кладёт в `/ingest`.
- **call adapter:** webhook от облачной АТС (Mango / Voximplant / Telphin — выбор по запросу клиента) → транскрипция через существующий ASR-pipeline (Vox/GigaAM) → /ingest. Адаптер также автоматически создаёт `Meeting`-родственное событие (для UI «история звонков»).
- **email adapter:** IMAP-listener на отдельную почту Org, парсит письма, кладёт в /ingest. Прикреплённые файлы — в S3, ссылка в payload.
- **web-form adapter:** UI «дамп мысли» в Z — большая текстовая зона, отправил → /ingest. Для индивидуальных мыслей менеджеров.

Каждый адаптер требует:
- UI настройки в `/settings/sources` — подключение / отключение / тест.
- Идемпотентность по своему `sourceExternalId`.
- Тест end-to-end.

### DoD по адаптеру

- [ ] Owner подключил адаптер из UI.
- [ ] Тестовое сообщение / звонок / письмо доходит до RawEvent.
- [ ] Через несколько минут — блоки доступны в поиске.
- [ ] Обновлён `second-brain/01_projects/ingest-and-sources.md`.

---

## Фаза 11 — Retention, security, 152-ФЗ, observability ядра

### Цель фазы

Привести ядро в состояние production-readiness по соответствию, безопасности, наблюдаемости.

### Что входит

- **Retention policy** на уровне `tenantId`:
  - `RawEvent` — 7 лет по умолчанию (152-ФЗ), настраивается на Org.
  - `IdeaBlock(status=archived)` — 1 год после архивации, потом hard-delete с пометкой в audit.
  - `MeetingChatMessage` — 90 дней.
- **Право на удаление личных данных:** `DELETE /api/v1/persons/:entityId/data` — каскадно стирает `RawEvent` с упоминанием персоны (там, где `entityId` встречается в `IdeaBlockEntity`), `IdeaBlock`-и пересобираются без её упоминания.
- **`dataClass`** маркировка во всех новых сущностях. Чувствительные блоки (`sensitive / private`) обрабатываются только локальной LLM (если подключена), не уходят во внешний провайдер.
- **Метрики Prometheus:** `core_blocks_total{tenant,status}`, `core_entities_total{tenant,type}`, `core_links_total{tenant,relation_type}`, `core_pipeline_duration_seconds{worker}`, `core_llm_tokens_total{tenant,task_type}`.
- **Grafana dashboard** «Knowledge Core» — основные метрики + алерты.

### DoD

- [ ] Для тестовой сущности `person` — `DELETE` каскадно стирает источники и пересобирает блоки.
- [ ] Метрики экспортируются на /metrics.
- [ ] Dashboard в Grafana показывает счётчики.

---

## Фаза 12 — Тарифы и entitlements

### Цель фазы

Ввести модель тарифов на уровне Org: `tier_basic / tier_pro / tier_enterprise`. Это нужно непосредственно перед коммерческим релизом.

### Что входит

- Сущность `OrgEntitlement`. Поля: `tenantId`, `tier`, `featureOverrides` jsonb, `quotaOverrides` jsonb.
- Тарифы (стартовая нарезка, корректируется бизнесом):
  - **`tier_basic`** — встречи, AI-отчёт, базовый Card-rollup, AI-чат per-meeting, до 10 источников типа `meeting`. Без Theme, без графа, без org-чата, без дашборда директора.
  - **`tier_pro`** — добавляет: Theme, граф, org-wide AI-чат, дашборд директора, экспорты, Public API.
  - **`tier_enterprise`** — добавляет: цели + стратегический согласователь, остальные адаптеры (телефония, email, бот), strict visibility mode, расширенные квоты, выделенный SLA.
- Gating через декоратор `@RequireEntitlement('feature.theme')` на контроллерах.

### DoD

- [ ] Tier владельца Org проверяется при доступе к ограниченным эндпоинтам.
- [ ] При попытке зайти в `/themes` на `tier_basic` — UI показывает заглушку «доступно на тарифе Pro».

---

## Сквозные изменения, которые касаются всех фаз

- **`LlmRouter` расширяется** новыми taskType: `block-ingest`, `block-distill`, `block-linker`, `entity-resolver`, `entity-merge-arbiter`, `theme-classify`, `theme-clusterer`, `reframing`, `card-rollup-v2`, `task-extract-v2`, `chapter-extract-v2`, `summary-v2`, `chat-v2`, `goal-alignment`, `dashboard-summary`. Каждый — добавляется в `LlmTaskRoute` с дефолтной маршрутизацией (Sonnet для тяжёлых, Haiku для классификаторов).
- **`LlmRouter` middleware** (модернизация в Фазе 0): каждый вызов через `LlmRouter.invoke({taskType, ...})` обязательно пишет полную запись в `AiUsageLog` (см. Фазу 0 — расширение полей). Это **сквозное правило** — никакие LLM-вызовы в обход роутера, иначе аналитика стоимости становится дырявой. PR-review правило: любой `fetch` к LLM-провайдеру минуя роутер — отклоняется.
- **A/B-эксперименты** через `LlmTaskRoute.experiment` (см. Фазу 7) — работают для любого taskType прозрачно, без изменения кода конкретного воркера. Сам воркер вызывает `llmRouter.invoke({taskType: 'block-distill'})` — роутер сам решает, какую модель использовать (A или B по `splitPercent`) и пишет `experimentGroup` в лог.
- **`AuditLog` константы** — добавить `BLOCK_*`, `ENTITY_*`, `THEME_*`, `LINK_*`, `WORKER_*`, `ORG_*`, `MEMBERSHIP_*`.
- **Quotas** — новые: `MAX_BLOCKS_PER_ORG`, `MAX_LINKS_PER_DAY`, `MAX_CHAT_REQUESTS_PER_DAY_PER_USER`, `MAX_INGEST_BYTES_PER_MONTH_PER_ORG`.
- **Webhook events** — новые: `block.created`, `block.merged`, `entity.created`, `entity.merged`, `theme.created`, `theme.archived`, `goal.alignment_changed`.

## Критерии готовности всего ТЗ (DoD верхнего уровня)

- [ ] Все 12 фаз закрыты по своим DoD.
- [ ] Тестовый сценарий end-to-end: `регистрация Org → пригласить менеджера → провести 5 встреч разного типа → подключить Telegram-бот и отправить 20 сообщений → подключить email и переслать 10 писем → дождаться обработки → задать вопрос на дашборде директора → получить осмысленный ответ с цитатами на встречи / сообщения / письма`.
- [ ] Бенчмарк качества поиска: точность top-3 не хуже **+50%** vs старый chunk-based на golden-set из 50 транскриптов.
- [ ] Бенчмарк сжатия: соотношение `count(IdeaBlock canonical) / count(сырых смысловых единиц)` от 5× до 40× в зависимости от объёма Org.
- [ ] Все обновления в `second-brain/` сделаны (см. чек-лист в каждой фазе).
- [ ] Создана `second-brain/02_architecture/adr/` с минимум 8 ADR:
  - ADR-001 — Knowledge Core как фундамент Z (а не надстройка).
  - ADR-002 — Stack delta: NestJS+pgvector вместо Python+FalkorDB. Критерии пересмотра.
  - ADR-003 — Лицензия delivery: концепции да, код нет.
  - ADR-004 — Multi-tenancy через `tenantId`, не schema-per-tenant.
  - ADR-005 — Без ручного подтверждения связей; админка отладки как заместитель.
  - ADR-006 — Card vs Theme: разные сущности с разной природой.
  - ADR-007 — Две админки (Z-Admin для super_admin / Org-Admin для owner). Роль `super_admin` — отдельно от Membership.
  - ADR-008 — Все LLM-вызовы строго через `LlmRouter` с обязательным логированием стоимости в `AiUsageLog`. A/B-эксперименты как первоклассный механизм.

## Открытые архитектурные вопросы (могут возникнуть в процессе)

- [ ] Если Org реально вырастет (>1M блоков, >100k сущностей) — переезжать ли часть графа в FalkorDB? Если да — какой триггер? (Пред-определённый порог по latency или по объёму.)
- [ ] Tier_basic — нужен ли в нём вообще ingest pipeline или только tasks/chapters/highlights, как было раньше? Если только старые — тогда tier_basic = старый Z. Это упростит экономику. Решить при подходе к Фазе 12.
- [ ] Embedding-провайдер для русского. Сейчас `text-embedding-3-small` через OpenAI proxy. Для лучшего качества на русском возможно нужен `bge-m3` или `e5-large` локально. Оценить при Фазе 2 на бенчмарках.
- [ ] Choice of clustering algorithm для Theme. KNN-greedy vs HDBSCAN. Решение по бенчмаркам в Фазе 4.

## Итог

_Заполняется по ходу реализации фаз._

- [ ] Фаза 0
- [ ] Фаза 1
- [ ] Фаза 2
- [ ] Фаза 3
- [ ] Фаза 4
- [ ] Фаза 5
- [ ] Фаза 6
- [ ] Фаза 7
- [ ] Фаза 8
- [ ] Фаза 9
- [ ] Фаза 10
- [ ] Фаза 11
- [ ] Фаза 12
