---
type: tz
status: done
feature: единое информационное ядро Z (knowledge core) — переустройство фундамента продукта
date: 2026-05-10
supersedes: plans/archive/2026-05-10-z-second-brain-integration-superseded.md
supersededBy: plans/tz/2026-05-22-final-roadmap.md
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
| Историческая БД | Чистый лист. Production-данных нет, нечего мигрировать. На старте — `bun run prisma:push --accept-data-loss` (наш проектный стандарт — только `db push`, никаких `migrate`, см. memory `prisma-db-push-rules`). |
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
- [ ] Таблица `LlmModelPrice` создана и наполнена актуальными ценами для всех моделей primary-стэка по политике 2026-05 (см. `llm-models-playbook.md` §2.1 и §12): `deepseek-v4-pro`, `deepseek-v4-flash`, `deepseek-v3.2`, `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.4-nano`, `text-embedding-3-small`, `bge-m3` (нулевая цена), `qwen3:30b-a3b-instruct-2507` (нулевая цена). Опциональные A/B-кандидаты: `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`, `MiniMax-M2.7`, `gemini-3-pro` — добавляются с актуальными ценами, но НЕ ставятся в дефолтные `LlmTaskRoute.providers`.
- [ ] Существующие LLM-вызовы (старый AI-pipeline до Фазы 1 ещё работает) — после деплоя пишут полную стоимость в `AiUsageLog`. Проверка: после тестовой встречи в `AiUsageLog` есть записи с непустыми `costUsd`, `inputTokens`, `outputTokens`, `model`.
- [ ] Обновлены `second-brain/01_projects/auth-and-accounts.md` (роли расширены) + новый файл `second-brain/01_projects/rbac-access-control.md`.

### Риски

- **Backfill `tenantId` на существующих таблицах** — операция тяжёлая, но в нашем случае production-данных нет, риск нулевой.
- **Casbin policy сложность** — visibilityMode сразу даёт 4 ситуации (admin/manager × own/foreign). Тесты на каждую обязательны.
- **Регрессия существующих экранов** — все списки и детали должны быть протестированы под новым фильтром.

### Детализация для агента-исполнителя (2026-05-10)

Опирается на фактическое состояние кода, проверено агентом-исследователем.

#### Текущее состояние (что уже есть)

- **`User`** — [backend/prisma/schema.prisma](backend/prisma/schema.prisma) (модель, ~L147-L183). Поля: `id`, `externalId`, `email`, `name`, `role` enum `UserRole {user|admin}`, `signupSource` enum `{crossmark|standalone}`, `passwordHash?`, `mustChangePassword`, `createdAt`, `lastSeenAt`, `deletedAt`. Поля `isSuperAdmin` нет.
- **`AiUsageLog`** — [backend/prisma/schema.prisma](backend/prisma/schema.prisma) (~L342-L363). Поля: `id`, `meetingId?`, `userId?`, `agentType`, `taskType?`, `jobId?`, `model`, `provider`, `inputTokens`, `outputTokens`, `reasoningTokens?`, `costUsd Decimal(10,6)`, `durationMs`, `success`, `errorText?`. Нужно добавить: `tenantId`, `cachedTokens`, `latencyMs` (если отличается от durationMs — переименовать), `sourceRef Json?`, `experimentGroup?`.
- **`LlmTaskRoute`** — [backend/prisma/schema.prisma](backend/prisma/schema.prisma) (~L730-L736). Поля: `id`, `taskType` (unique), `providers Json`, `isActive`, `updatedAt`. Нужно добавить: `tenantId?` (NULL = глобальный дефолт, заданный super_admin; не-NULL = override на конкретную Org, фича Z-Admin Фазы 7), `experiment Json?`.
- **`LlmRouterService`** — [backend/src/modules/ai/services/llm-router.service.ts](backend/src/modules/ai/services/llm-router.service.ts). Метод `call(params)` уже идёт по списку провайдеров из `LlmTaskRoute`, пишет `AiUsageLog` через `AiUsageLogService.record()`. Текущие taskType: `summary | chapters | tasks | chat | regenerate-section | custom-prompt | follow-up | clip-title | card-rollup | card-chat`. Адаптеры провайдеров: `AnthropicService`, `MinimaxService`, `OpenAiProxyService`. **Нужно:**
  - Добавить адаптер `DeepSeekService` (через `proxy.agent-lia.ru/deepseek/v1/chat/completions` — проверить маршрут; если на прокси нет — напрямую `api.deepseek.com`). OpenAI-compat API, поддержка `response_format: { type: 'json_schema', strict: true }`, function calling, prompt caching.
  - Добавить адаптер `OllamaService` (через `ollama.agent-lia.ru/v1/chat/completions` + `/v1/embeddings`).
  - Расширить `call()`: при `LlmTaskRoute.experiment.enabled = true` — рандомный выбор A/B по `splitPercent`, запись `experimentGroup: 'A'|'B'` в `AiUsageLog`. Логика — отдельный private-метод, не размазана по `call()`.
  - Расширить `record()` под новые поля `cachedTokens`, `sourceRef`, `experimentGroup`. `tenantId` — обязательное поле.
  - **Жёсткое правило:** `LlmRouterService.call()` не должен молча падать на отсутствии `tenantId` в `params`. Сделать `tenantId` обязательным в типе `LlmCallParams`. Все существующие точки вызова обновить.
  - При расчёте `costUsd` — сначала смотреть в БД-таблицу `LlmModelPrice` (актуальная запись по `provider+model+effectiveFrom<=now AND (effectiveTo IS NULL OR effectiveTo>now)`), фолбэк на `MODEL_PRICES` в [backend/src/modules/ai/services/model-prices.ts](backend/src/modules/ai/services/model-prices.ts).
- **Auth** — [backend/src/modules/auth/](backend/src/modules/auth/), [backend/src/modules/accounts/](backend/src/modules/accounts/). Регистрация: `POST /api/v1/accounts/register` (lead-style: email + name + временный пароль argon2id, письмо через `MailService`).
- **Frontend регистрация** — [frontend/app/signup/SignupForm.tsx](frontend/app/signup/SignupForm.tsx). Поля: `name`, `email`, honeypot, чекбокс согласия. Нужно добавить опциональное поле «Название компании» (если пусто — дефолт `Компания {name}`).
- **Guards** — `CookieAuthGuard`, `AdminGuard` (по `User.role=admin`), `BearerAuthGuard`, `HmacGuard`, `MeetingMemberGuard`. Casbin отсутствует.
- **prisma push команда** — `bun run prisma:push` ([backend/package.json](backend/package.json)).

#### Прайс-карта в коде уже обновлена

[backend/src/modules/ai/services/model-prices.ts](backend/src/modules/ai/services/model-prices.ts) уже содержит цены для всех моделей primary-стэка (см. коммит-кандидат к этой фазе). Нужно использовать как fallback для `LlmModelPrice`-таблицы.

#### Пошаговый план для агента

Фаза 0 разбита на 5 шагов. Каждый шаг — атомарный коммит. После шагов 1, 2, 3 — `bun run prisma:push --accept-data-loss` и `bun run build`. Шаг 5 — smoke-тест.

**Шаг 1. Расширение схемы Prisma + push.**

Файл: [backend/prisma/schema.prisma](backend/prisma/schema.prisma).

1. Добавить `User.isSuperAdmin Boolean @default(false)`.
2. Добавить новые enum'ы:
   ```
   enum OrgVisibilityMode { open strict }
   enum OrgTier { basic pro enterprise }  // placeholder для Фазы 12
   enum MembershipRole { owner admin manager }
   enum OrgInvitationStatus { pending accepted revoked expired }
   ```
3. Добавить новые модели:
   - `Org { id, name, slug @unique, ownerId (FK User), visibilityMode (default open), tier (default basic), createdAt, deletedAt? }`
   - `Membership { id, orgId, userId, role, invitedBy?, joinedAt, @@unique([orgId, userId]) }`
   - `OrgInvitation { id, orgId, email, role, token @unique, status, invitedBy, createdAt, expiresAt, acceptedAt?, acceptedByUserId? }`
   - `LlmModelPrice { id, provider, model, inputCostPerMillionTokens Decimal(10,6), outputCostPerMillionTokens Decimal(10,6), cachedCostPerMillionTokens Decimal(10,6) @default(0), currency String @default("USD"), effectiveFrom DateTime @default(now()), effectiveTo DateTime?, @@index([provider, model, effectiveFrom]) }`
4. Добавить `tenantId String?` (FK на `Org.id`, nullable на старте — после backfill сделать NOT NULL отдельным push'ом) во все модели из ТЗ строки 154: `Meeting`, `Card`, `Task`, `MeetingChapter`, `MeetingHighlight`, `MeetingChatMessage`, `Tag`, `WebhookSubscription`, `IntegrationDestination`, `Export`, `ApiKey`, `LlmTaskRoute`, `AuditLog`, `AiUsageLog`. Для каждого — `@@index([tenantId])`.
5. Расширить `AiUsageLog`:
   - `tenantId String?` (после backfill NOT NULL).
   - `cachedTokens Int @default(0)`.
   - `sourceRef Json?` (`{type: 'meeting'|'block'|...', id: string}`).
   - `experimentGroup String?` (`'A'|'B'`).
   - Поле `durationMs` оставить (это и есть latency).
6. Расширить `LlmTaskRoute`:
   - `tenantId String?` (NULL = глобальный дефолт).
   - `experiment Json?` (`{enabled: bool, modelA: string, modelB: string, splitPercent: number, startedAt: ISO, endsAt: ISO}`).
   - Изменить `@@unique` на `@@unique([taskType, tenantId])`.
7. Запустить `bun run prisma:push --accept-data-loss` (чистый лист, ОК).
8. **Backfill:**
   - Создать `backend/scripts/backfill-orgs-fase0.ts` (по правилам `safe-seed-rules`, runtime — bun, идемпотентность через upsert по `ownerId`).
   - Логика: для каждого `User` без owned `Org` — создать `Org { name: user.name + " (личный)", slug: slugify(user.name + '-' + user.id.slice(-6)), ownerId: user.id }` + `Membership { orgId, userId: user.id, role: owner, joinedAt: now }`.
   - Для каждой записи в `Meeting/Card/Task/...` без `tenantId` — найти `userId` владельца записи (поле зависит от модели — для `Meeting` это `ownerId`, для `Card` это `ownerId`, для `Task` это `assigneeUserId` или `creatorUserId`, проверить по схеме), достать `Membership.orgId` для этого `userId`, проставить `tenantId`.
   - Для записей без явного `userId` (если такие найдутся — например, `LlmTaskRoute` глобальный) — оставить `tenantId = NULL`.
   - Запустить через `bun run backend/scripts/backfill-orgs-fase0.ts`.
9. Опциональный второй `prisma:push` после backfill, который сделает `tenantId NOT NULL` для тех моделей, где должен быть обязательным (Meeting, Card, Task, MeetingChapter, MeetingHighlight, MeetingChatMessage, Tag, AiUsageLog, AuditLog, Export). Для `LlmTaskRoute`, `WebhookSubscription`, `IntegrationDestination`, `ApiKey` — оставить nullable (могут быть глобальными для super_admin).
10. **Seed `LlmModelPrice`:** скрипт `backend/scripts/seed-llm-model-prices.ts` — наполнить таблицу всеми моделями из [backend/src/modules/ai/services/model-prices.ts](backend/src/modules/ai/services/model-prices.ts) (provider определяется по префиксу: `deepseek-*` → `deepseek`, `gpt-*` → `openai`, `claude-*` → `anthropic`, `MiniMax-*` → `minimax`, `bge-*` → `ollama`, `qwen*` → `ollama`, `gemini-*` → `gemini-grsai`). `effectiveFrom = now`, `effectiveTo = NULL`. Идемпотентность: upsert по `(provider, model, effectiveFrom-day)`.
11. **Seed дефолтных `LlmTaskRoute`:** скрипт `backend/scripts/seed-llm-task-routes-knowledge-core.ts` — для каждого taskType из таблицы §2.1 playbook'а создать запись `{taskType, tenantId: null, providers: [{provider, model}, ...], isActive: true}`. **Старые taskType (`summary`, `chapters`, `tasks`, `chat`, `card-rollup`, ...) НЕ трогать** — они продолжают работать поверх старого pipeline до Фаз 5/6. Просто перевести их primary с `claude-sonnet-4-6` на `deepseek-v4-pro` с фолбэком `gpt-5.4`. Запускать с флагом `--update-existing` для контроля.

**Шаг 2. RBAC через Casbin + middleware.**

1. Установить пакет: в [backend/package.json](backend/package.json) добавить `casbin` (последняя стабильная), `casbin-prisma-adapter` (если совместим) или `casbin-postgres-adapter`. Если adapter'а под Prisma+Postgres нет в готовом виде — использовать `FileAdapter` для policy + хранить policies в [backend/src/modules/rbac/policies/](backend/src/modules/rbac/policies/) (текстовые файлы, версионируются через git).
2. Создать модуль `backend/src/modules/rbac/`:
   - `rbac.module.ts` — экспортирует `RbacService`.
   - `rbac.service.ts` — обёртка над Casbin enforcer'ом. Методы: `canRead(userId, resourceType, resourceId, tenantId): Promise<boolean>`, `canWrite(...)`, `canManageOrg(userId, orgId): Promise<boolean>`.
   - `rbac.model.conf` — RBAC + tenant + visibilityMode.
3. Логика модели:
   - `super_admin` (User.isSuperAdmin = true) — видит всё (но действия логируются в `SuperAdminAccessLog` — это Фаза 7; на Фазе 0 — просто пропускает все проверки).
   - `owner`/`admin` Org — видит/правит всё в своей Org.
   - `manager` Org:
     - в `visibilityMode = open` — видит все ресурсы Org, правит свои.
     - в `visibilityMode = strict` — видит только ресурсы, где `ownerUserId == self.userId`, плюс общие (Entity, Theme — но их в Фазе 0 нет, поэтому правило ставим, но активируется в Фазе 2).
4. Создать `TenantGuard` ([backend/src/modules/rbac/guards/tenant.guard.ts](backend/src/modules/rbac/guards/tenant.guard.ts)) — извлекает `tenantId` из request (заголовок `X-Org-Id` или из URL `/orgs/:id/...` или из тела), проверяет, что у текущего `User` есть `Membership` в этом `tenantId`. Если нет — 403.
5. Создать декоратор `@CurrentOrg()` — извлекает выбранный `Org` для запроса. По умолчанию — единственная Org пользователя. Если у пользователя несколько Org (vNext) — берёт из заголовка `X-Org-Id`.
6. Применить `TenantGuard` к контроллерам: `MeetingsController`, `CardsController`, `TasksController`, `MeetingChaptersController`, `MeetingHighlightsController`, и т.д. — все, что работают с tenant-scoped данными.
7. Все существующие сервисы, читающие данные по `userId` напрямую, переписать на `tenantId`-фильтрацию (с дополнительным `userId`-фильтром только в `strict` режиме). Это самый объёмный кусок — потребуется аккуратный обход.

**Шаг 3. Org/Membership/Invitation API + сервисы.**

1. Модуль `backend/src/modules/orgs/`:
   - `orgs.module.ts`, `orgs.controller.ts`, `orgs.service.ts`, `org-invitations.controller.ts`, `org-invitations.service.ts`.
2. DTO в `dto/`: `CreateOrgDto`, `UpdateOrgDto`, `InviteMemberDto`, `AcceptInvitationDto`, `UpdateMemberDto`, плюс DomainModel'ы и UiModel'ы по правилам [nestjs-rules](skill).
3. Эндпоинты (все под `CookieAuthGuard` + `TenantGuard` где применимо):
   - `POST /api/v1/orgs` (для регистрации — без `TenantGuard`, авторизованный пользователь без своей Org может создать).
   - `GET /api/v1/orgs/me` — список Org текущего юзера.
   - `PATCH /api/v1/orgs/:id` (только owner): `name`, `visibilityMode`.
   - `GET /api/v1/orgs/:id/members` (member любой роли).
   - `PATCH /api/v1/orgs/:id/members/:userId` (только owner/admin): сменить роль или удалить (`DELETE` отдельным методом).
   - `DELETE /api/v1/orgs/:id/members/:userId` (только owner/admin).
   - `POST /api/v1/orgs/:id/invitations` (только owner/admin): создать `OrgInvitation`, отправить письмо через `MailService`.
   - `POST /api/v1/orgs/invitations/:token/accept` (без `TenantGuard`, любой авторизованный): найти инвайт, проверить срок, создать `Membership`, обновить статус инвайта.
   - `GET /api/v1/orgs/:id/invitations` (только owner/admin): список pending/expired.
   - `DELETE /api/v1/orgs/:id/invitations/:invitationId` (revoke).
4. Логика сервисов:
   - При `POST /orgs` — создать Org + Membership(owner) для текущего юзера в одной Prisma-транзакции.
   - Slug — `slugify(name) + '-' + nanoid(6)`, проверка уникальности.
   - Token инвайта — `nanoid(40)`, expires через 7 дней.
   - `MailService.send` — шаблон письма «Вас пригласили в {orgName}», ссылка на `${FRONTEND_URL}/invitations/${token}`.
5. **Хук в существующий `accounts.controller.ts`:** при `POST /api/v1/accounts/register` — после создания `User` сразу создать персональный `Org { name: companyName ?? "Компания " + user.name }` + `Membership(owner)`. Поле `companyName` приходит из формы (опционально).

**Шаг 4. Frontend — поле компании в регистрации + страница `/settings/organization`.**

1. [frontend/app/signup/SignupForm.tsx](frontend/app/signup/SignupForm.tsx) — добавить опциональное поле `companyName` (русская подпись «Название компании», placeholder «Например: ООО Ромашка»). Дефолт — пусто, бэк подставит «Компания {name}». Обновить тип запроса в `apiClient`.
2. Новая страница `frontend/app/settings/organization/page.tsx` (в Next.js App Router):
   - Компонент `OrgSettingsPage` — серверный fetch `GET /api/v1/orgs/me` + `GET /api/v1/orgs/:id/members` + `GET /api/v1/orgs/:id/invitations`.
   - Секции:
     - «Информация» — `name`, `visibilityMode` (radio `open`/`strict` с пояснениями), кнопка «Сохранить» → `PATCH /api/v1/orgs/:id`.
     - «Участники» — таблица `email | role | joinedAt | actions (изменить роль / удалить)`. Только owner/admin видит actions.
     - «Приглашения» — форма «email + role» → `POST /api/v1/orgs/:id/invitations`. Список pending инвайтов с кнопкой «Отозвать».
   - Архитектура — по [frontend-rules](skill): ApiDto → DomainModel → UiModel, единый apiClient, server-side rendering для list-данных, mutations через client component.
3. Страница `/invitations/[token]` — принять приглашение. Если пользователь не залогинен — редирект на login с возвратом. Если залогинен — кнопка «Принять приглашение в {orgName}» → `POST /api/v1/orgs/invitations/:token/accept` → редирект на `/dashboard`.
4. Все существующие списки (`/meetings`, `/cards`, `/tasks`, `/chapters` и т.д.) — пройти и убедиться, что они либо неявно фильтруются по `tenantId` (через middleware и заголовок `X-Org-Id`, либо явно — добавить `?orgId=` если есть выбор Org).

**Шаг 5. Smoke-тест + second-brain обновления.**

1. **Smoke вручную через UI:**
   - Зарегистрировать тестового юзера A с companyName="Тест-Компания-A". Проверить, что Org создан, Membership(owner) есть.
   - Зарегистрировать юзера B без companyName. Проверить дефолт.
   - От юзера A отправить инвайт на email юзера B (роль manager).
   - Залогиниться как B, перейти на `/invitations/{token}`, принять. Проверить что появился второй Membership.
   - Юзер B видит встречи юзера A (`visibilityMode = open` дефолт).
   - Юзер A переключает на `strict` → юзер B перестаёт видеть встречи юзера A.
   - Юзер B пытается дёрнуть `GET /api/v1/orgs/{другая_org_id}/members` → 403.
   - Создать тестовую встречу под юзером A, проверить что в `AiUsageLog` после AI-обработки есть запись с `tenantId`, `model`, `costUsd`, `inputTokens`, `outputTokens`.
2. **second-brain обновления:**
   - Обновить [second-brain/01_projects/auth-and-accounts.md](second-brain/01_projects/auth-and-accounts.md) — раздел «Org и роли», описать новую модель и SignupForm с companyName.
   - Создать [second-brain/01_projects/rbac-access-control.md](second-brain/01_projects/rbac-access-control.md) — модель Org/Membership/OrgInvitation, RBAC через Casbin, visibilityMode (open/strict), super_admin (вне Membership).
   - Создать [second-brain/01_projects/llm-router.md](second-brain/01_projects/llm-router.md) — описать архитектуру LlmRouter после расширения: taskType-based маршрутизация, `LlmModelPrice` версионируется, `LlmTaskRoute.experiment` для A/B, обязательный `tenantId` в `AiUsageLog`.
   - Обновить [second-brain/02_architecture/data-model.md](second-brain/02_architecture/data-model.md) — добавить раздел про Org/Membership/OrgInvitation/LlmModelPrice + расширения AiUsageLog/LlmTaskRoute.
   - Обновить [second-brain/02_architecture/module-map.md](second-brain/02_architecture/module-map.md) — добавить модули `orgs`, `rbac`.
   - Создать [second-brain/13_glossary/index.md](second-brain/13_glossary/index.md) — глоссарий новых терминов: Org (Организация), Membership, OrgInvitation, super_admin, visibilityMode, IdeaBlock (Блок знаний — для будущих фаз), Entity (Сущность), Theme (Тема), Source (Источник), RawEvent (Событие источника). На Фазе 0 нужны термины Org/Membership/super_admin/visibilityMode; остальные — заглушки со ссылками на будущие фазы.

#### Что вне Фазы 0 (для ясности агенту)

- Любые таблицы knowledge-core (`IdeaBlock`, `Entity`, `Theme`, `RawEvent`, `Source`, `IdeaBlockLink`, `EntityLink`) — это Фазы 1-3. На Фазе 0 их НЕ создавать.
- Удаление `MeetingTranscriptChunk` — Фаза 1.
- Замена `tasks-extract.worker` / `chapters.worker` — Фаза 5.
- Z-Admin UI и Org-Admin UI (`/admin/*`, `/settings/admin/*`) — Фаза 7. На Фазе 0 — только базовая `/settings/organization` для управления членами.
- Адаптеры источников (telegram, email, call, web-form) — Фаза 10.

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

### Детализация для агента-исполнителя (2026-05-10)

Опирается на фактическую карту AI-pipeline, собранную после Фазы 0.

#### Текущее состояние AI-pipeline (что нельзя сломать)

- **`AnalyzeWorker`** ([backend/src/modules/ai/workers/analyze.worker.ts](backend/src/modules/ai/workers/analyze.worker.ts)) — главный оркестратор. После `transcription_ready` (`MergeWorker`) запускает Summary → CustomReport → Follow-up → Tasks (последовательно, всё с `tenantId`-логированием в `AiUsageLog`). По окончанию переводит `Meeting.aiStatus = 'ai_ready'` и **параллельно** запускает 3 фоновых job'а: `ai.chapters`, `ai.tasks`, `ai.embeddings` (`transcript-index.worker`), плюс опционально `ai.card-rollup` если есть `Meeting.cardId`. Использует `Promise.allSettled` — ошибка одного не валит остальные.
- **`TranscriptIndexerService` + `transcript-index.worker`** ([backend/src/modules/embeddings/services/transcript-indexer.service.ts](backend/src/modules/embeddings/services/transcript-indexer.service.ts), [backend/src/modules/ai/workers/transcript-index.worker.ts](backend/src/modules/ai/workers/transcript-index.worker.ts)) — режет `merged.json` на 400-токенные `MeetingTranscriptChunk` с overlap 50, эмбеддит батчами по 100 через `EmbeddingFallbackService` (`text-embedding-3-small` по дефолту, BGE-M3 если `EMBEDDING_FALLBACK_LOCAL_URL`). Чанки используются `chat`-модулем для cross-meeting RAG.
- **`MeetingTranscriptChunk`** ([backend/prisma/schema.prisma:681-695](backend/prisma/schema.prisma#L681-L695)) — `meetingId, userId, tenantId, startMs, endMs, text, embedding (vector 1536), createdAt`, `@@unique([meetingId, startMs, endMs])`.
- **`Transcript`** (schema.prisma:355-364) — meta-запись со ссылками `rawIndexS3Url`, `mergedS3Url`, `totalWords`, `totalDurationSeconds`. Сами JSON-файлы в S3 по ключам `transcripts/<meetingId>/{index.json, merged.json, track_<trackId>.json}`. `merged.json` — массив `turns: [{speaker, text, startSec, endSec}]` + `roomChat: [...]`.
- **`AiQueueService`** ([backend/src/modules/ai/ai-queue.service.ts](backend/src/modules/ai/ai-queue.service.ts)) и [backend/src/modules/ai/queues.ts](backend/src/modules/ai/queues.ts) — диспетчер очередей. Существующие очереди: `ai.transcribe`, `ai.merge`, `ai.analyze`, `ai.notify`, `ai.chapters`, `ai.tasks`, `ai.embeddings`, `clip.render`, `ai.card-rollup`. Дефолты: 5 attempts, exp backoff 8s, removeOnComplete{age:86400, count:1000}, removeOnFail:false.
- **S3Service** ([backend/src/modules/recordings/s3.service.ts](backend/src/modules/recordings/s3.service.ts)) — `putJson(key, data)`, `getJson(key)`, `presignGet(key, ttl)`. Готов для raw-events ключей.
- **`Source` / `IngestSource` сущностей в коде НЕТ** — Фаза 1 их вводит впервые.
- **Idempotency-паттерны:** `BullMQ jobId = <meetingId>:<stage>:<attempt>`, `MeetingRoomMessage.clientMessageId` (chat dedupe), `CrossmarkIdempotency` (для интеграции). SHA256-хелпер не вынесен — `crypto.createHash('sha256')` используется напрямую в нескольких местах.

#### Архитектурное решение (важно)

ТЗ говорит «Старая логика `transcript-index.worker` отключена (jobs не запускаются), таблица `MeetingTranscriptChunk` помечена `@deprecated`». Однако `chat`-модуль (per-meeting и cross-meeting) использует `MeetingTranscriptChunk` для RAG, а его замена (`chat-v2` через ядро) — это Фаза 6. Если на Фазе 1 отключить `transcript-index.worker`, для новых встреч после Фазы 1 chat сломается до Фазы 6 (3-4 месяца).

**Принимаю компромисс:** на Фазе 1 — параллельный путь.
1. `transcript-index.worker` **остаётся работать** (читать продолжаем через chat для совместимости).
2. `MeetingTranscriptChunk` помечается комментарием `/// @deprecated — будет удалён в Фазе 6 после chat-v2` (Prisma не поддерживает `@deprecated` на модели нативно — оставить как комментарий + `@@map("meeting_transcript_chunk_deprecated")` НЕ делать, потому что это сломает chat-модуль).
3. **Меняем для всех новых встреч:** `analyze.worker` после `ai_ready` дополнительно вызывает `MeetingIngestAdapter.ingestMeeting(meetingId)`, который пишет `RawEvent` через универсальный `IngestService.ingest(...)`.
4. Реальное выпиливание `transcript-index.worker` + dropping `MeetingTranscriptChunk` — задача Фазы 6.

#### Ingest API: HTTP или прямой service call?

ТЗ предлагает `POST /api/v1/ingest` — **внутренний** endpoint для адаптеров. Это полезно для будущих внешних адаптеров (telegram-bot из отдельного процесса, IMAP-listener). Но `meeting-adapter` живёт внутри того же backend-процесса — гонять HTTP-запрос самому себе избыточно.

**Решение:** делаем **оба варианта**.
1. `IngestService.ingest({tenantId, sourceId, sourceExternalId, occurredAt, payload, dataClass}): Promise<RawEvent>` — главный путь, прямой вызов из `meeting.adapter` и любого другого in-process адаптера.
2. `POST /api/v1/ingest` — тонкая обёртка над `IngestService.ingest`, для внешних адаптеров. Защищён `BearerAuthGuard` через специальный API-ключ `IngestApiKey` (или просто отдельная роль `ingest_writer` у существующего `ApiKey`). На Фазе 1 — простейший shared-secret в env `INGEST_INTERNAL_TOKEN`, валидируется в guard'е. Полноценное API-key-управление — Фаза 10 (когда придут внешние адаптеры).

#### Пошаговый план для агента

Фаза 1 разбита на 4 шага. Каждый — атомарный коммит. После шагов 1, 2 — `npm run typecheck` + `npm run prisma:push --accept-data-loss`. После шага 4 — программный smoke.

**Шаг 1. Схема Prisma + push.**

Файл: [backend/prisma/schema.prisma](backend/prisma/schema.prisma).

1. Добавить enum'ы:
   ```
   enum SourceType { meeting chat phone_call bot email web_form external }
   enum DataClass { public internal sensitive private }
   enum RawEventProcessingStatus { received ingested failed }
   enum RawEventPayloadStorage { inline s3 }
   ```
2. Модель `Source`:
   ```
   model Source {
     id          String       @id @default(cuid())
     tenantId    String
     type        SourceType
     name        String
     config      Json?
     dataClass   DataClass    @default(internal)
     isActive    Boolean      @default(true)
     createdAt   DateTime     @default(now())
     updatedAt   DateTime     @updatedAt

     org         Org          @relation(fields: [tenantId], references: [id], onDelete: Cascade)
     rawEvents   RawEvent[]

     @@unique([tenantId, type, name])
     @@index([tenantId, isActive])
   }
   ```
3. Модель `RawEvent`:
   ```
   model RawEvent {
     id                  String                    @id @default(cuid())
     tenantId            String
     sourceId            String
     sourceType          SourceType
     sourceExternalId    String?                   // если null — событие без внешнего ID, дедуп по checksum
     idempotencyKey      String                    @unique  // sha256(sourceId + ':' + (sourceExternalId ?? checksum) + ':' + occurredAtIso)
     occurredAt          DateTime
     receivedAt          DateTime                  @default(now())
     payloadStorage      RawEventPayloadStorage    @default(inline)
     payload             Json?                     // null если payloadStorage = s3
     payloadS3Key        String?                   // не null если payloadStorage = s3
     payloadChecksum     String                    // sha256 от исходного payload (всегда, для верификации)
     payloadSizeBytes    Int
     dataClass           DataClass                 @default(internal)
     processingStatus    RawEventProcessingStatus  @default(received)
     processingError     String?                   // если failed
     processedAt         DateTime?                 // когда последний раз обработался ingest pipeline (Фаза 2)

     org                 Org                       @relation(fields: [tenantId], references: [id], onDelete: Cascade)
     source              Source                    @relation(fields: [sourceId], references: [id], onDelete: Restrict)

     @@index([tenantId, sourceId, occurredAt])
     @@index([tenantId, processingStatus])
   }
   ```
4. Добавить релейшены `Org.sources` и `Org.rawEvents`.
5. Пометить `MeetingTranscriptChunk` комментарием `/// @deprecated knowledge-core Фаза 1: будет заменён IdeaBlock в Фазе 2, удалён в Фазе 6 после chat-v2. Не использовать в новом коде.`
6. `npm run prisma:push --accept-data-loss`.
7. `npm run prisma:generate` (если требуется).

**Шаг 2. Backend: IngestModule + IngestService + meeting-adapter + BullMQ event.**

1. Новый модуль [backend/src/modules/ingest/](backend/src/modules/ingest/):
   - `ingest.module.ts`, `ingest.service.ts`, `ingest.controller.ts`.
   - `adapters/meeting.adapter.ts` — реализует internal contract `IngestSourceAdapter`.
   - `dto/ingest-event.dto.ts`, `dto/raw-event.dto.ts` (по правилам [nestjs-rules](skill)).
2. `IngestService`:
   - Метод `ingest({tenantId, sourceId, sourceExternalId, occurredAt, payload, dataClass}): Promise<RawEvent>`.
   - Логика:
     a) Проверка `Source.tenantId === tenantId && isActive`. Если нет — throw BadRequestException.
     b) Сериализация payload в строку, расчёт `payloadChecksum = sha256(payloadJson)`, `payloadSizeBytes = Buffer.byteLength(payloadJson)`.
     c) Расчёт `idempotencyKey = sha256(sourceId + ':' + (sourceExternalId ?? payloadChecksum) + ':' + occurredAt.toISOString())`.
     d) Если `payloadSizeBytes > 10 * 1024 * 1024` (10MB) — `payloadStorage = 's3'`, кладём в S3 по ключу `raw-events/<tenantId>/<rawEventId>.json` через `S3Service.putJson`, в `RawEvent.payload` — `null`. Иначе `inline`.
     e) `prisma.rawEvent.create()` с обработкой `P2002` на `idempotencyKey` (уникальный конфликт = идемпотентный возврат существующей записи).
     f) Публикация события `raw.received` в BullMQ-очередь `core.raw-events` через новый `CoreQueueService.enqueueRawReceived(rawEventId)`.
   - Все вызовы — через Prisma-транзакцию для атомарности create+enqueue.
3. `IngestController`:
   - `POST /api/v1/ingest` (под `BearerAuthGuard` или новым `IngestTokenGuard`, который валидирует `Authorization: Bearer ${INGEST_INTERNAL_TOKEN}` из env). Тело: `{sourceId, sourceExternalId?, occurredAt: ISO, payload: any, dataClass?}`. Возвращает `{rawEventId, idempotent: bool}`.
   - `GET /api/v1/raw-events/:id` (под `CookieAuthGuard` + `TenantGuard` из Фазы 0; доступ — только `owner`/`admin` Org). Возвращает RawEvent (для inline payload — целиком; для s3 — presigned URL вместо payload).
4. **`MeetingIngestAdapter`** ([backend/src/modules/ingest/adapters/meeting.adapter.ts](backend/src/modules/ingest/adapters/meeting.adapter.ts)):
   - Метод `ingestMeeting(meetingId: string): Promise<RawEvent>`:
     a) Найти `Meeting + Transcript + MeetingParticipants` по id.
     b) Загрузить `merged.json` из S3 через `S3Service.getJson(transcript.mergedS3Url)`.
     c) Найти/создать `Source(tenantId=meeting.tenantId, type='meeting', name='Встречи Z')` (lazy upsert).
     d) Сформировать `payload = { meetingId, type: meeting.type, kind: meeting.kind, title: meeting.title, startedAt, endedAt, durationSeconds, participants: [{userId?, displayName, email?}], transcript: merged.turns, roomChat: merged.roomChat }`.
     e) Вызвать `IngestService.ingest({tenantId, sourceId, sourceExternalId: meetingId, occurredAt: meeting.endedAt ?? meeting.startedAt, payload, dataClass: 'internal'})`.
5. **Регистрация дефолтного `Source` для Org**:
   - Хук в [backend/src/modules/orgs/orgs.service.ts](backend/src/modules/orgs/orgs.service.ts) (создан в Фазе 0): при создании нового Org — также создать `Source(type='meeting', name='Встречи Z', dataClass='internal', isActive=true)`.
   - Backfill для уже существующих Org (после Фазы 0): скрипт `backend/scripts/backfill-meeting-sources-fase1.ts` — для каждого Org без `Source(type='meeting')` создать дефолтный.
6. **`CoreQueueService`** ([backend/src/modules/core-queue/core-queue.service.ts](backend/src/modules/core-queue/core-queue.service.ts)) — новый сервис, по аналогии с `AiQueueService`. Новая очередь `core.raw-events` (константа в [backend/src/modules/core-queue/queues.ts](backend/src/modules/core-queue/queues.ts)). Метод `enqueueRawReceived(rawEventId, opts?)`. Дефолты: 5 attempts, exp backoff 5s. На Фазе 1 — никто на эту очередь не подписан (consumer появится в Фазе 2 как `block-ingest.worker`); jobs накапливаются в Redis. Это нормально — BullMQ умеет хранить.

**Шаг 3. Подключение meeting-adapter к analyze.worker.**

1. В [backend/src/modules/ai/workers/analyze.worker.ts](backend/src/modules/ai/workers/analyze.worker.ts) — после установки `Meeting.aiStatus = 'ai_ready'` (там, где сейчас `Promise.allSettled` для `enqueueChapters/enqueueTasksExtract/enqueueTranscriptIndex/enqueueCardRollup`) — добавить **четвёртый параллельный** вызов: `this.meetingIngestAdapter.ingestMeeting(meetingId).catch(...)`. Если падает — лог + не валит остальные. Не enqueue в очередь, а прямой await — потому что meeting-adapter сам внутри `IngestService` делает enqueue в `core.raw-events`.
2. Импорт `MeetingIngestAdapter` в `AnalyzeWorker` через DI. Соответственно, `AiModule` должен импортировать `IngestModule`.

**Шаг 4. Smoke + second-brain.**

1. Создать `backend/scripts/smoke-ingest-fase1.ts` — программный smoke:
   - Использовать существующего тестового юзера/Org из smoke Фазы 0 (или создать новый набор).
   - Создать тестовый `Meeting + Transcript + merged.json в S3` (или использовать готовую тестовую встречу).
   - Вызвать `MeetingIngestAdapter.ingestMeeting(meetingId)`.
   - Проверить:
     - `RawEvent` создан, `payloadChecksum` совпадает с независимым `sha256(payload)`.
     - `idempotencyKey` уникальный.
     - Повторный вызов `ingestMeeting(meetingId)` возвращает тот же `rawEventId` (идемпотентность).
     - В BullMQ-очереди `core.raw-events` есть job (можно через `Queue.getJobCounts()`).
   - Cleanup в конце.
2. **second-brain обновления:**
   - Создать [second-brain/01_projects/ingest-and-sources.md](second-brain/01_projects/ingest-and-sources.md) — описать `Source`, `RawEvent`, `IngestService`, `meeting-adapter`, паттерн для будущих адаптеров (telegram/email/call), идемпотентность по `idempotencyKey`, S3-fallback для больших payload.
   - Обновить [second-brain/01_projects/ai-workspace.md](second-brain/01_projects/ai-workspace.md) — раздел «AI-pipeline» расширить: добавить упоминание `IngestService` и `meeting-adapter`, отметить что `MeetingTranscriptChunk` deprecated и будет заменён в Фазе 2.
   - Обновить [second-brain/02_architecture/data-model.md](second-brain/02_architecture/data-model.md) — добавить `Source`, `RawEvent`.
   - Обновить [second-brain/02_architecture/module-map.md](second-brain/02_architecture/module-map.md) — добавить модули `ingest`, `core-queue`.
   - Обновить [second-brain/index.md](second-brain/index.md) — добавить ссылку на `ingest-and-sources.md` в раздел «Проекты».

#### Что вне Фазы 1 (для ясности агенту)

- `IdeaBlock`, `Entity`, `Theme`, `IdeaBlockEvidence`, `IdeaBlockEntity` — Фаза 2.
- `block-ingest.worker` (consumer для `core.raw-events`) — Фаза 2. На Фазе 1 jobs накапливаются.
- Адаптеры telegram/email/call/web-form — Фаза 10.
- UI управления источниками — Фаза 10.
- Полноценное API-key управление для внешнего ingest — Фаза 10.
- Удаление `transcript-index.worker` и `MeetingTranscriptChunk` — Фаза 6.

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

### Детализация для агента-исполнителя (2026-05-10)

Опирается на карту embeddings/pgvector/LlmRouter, собранную после Фазы 1.

#### Текущее состояние (опираемся)

- **`Source` + `RawEvent`** созданы в Фазе 1 ([backend/prisma/schema.prisma](backend/prisma/schema.prisma) ~L1074, L1094). `RawEvent.processingStatus: received|ingested|failed`, `processedAt?: DateTime`.
- **`CoreQueueService.enqueueRawReceived(rawEventId)`** ([backend/src/modules/core-queue/core-queue.service.ts](backend/src/modules/core-queue/core-queue.service.ts)) кладёт в `core.raw-events`. На Фазе 1 consumer'а нет — jobs накапливаются. **На Фазе 2 появляется `block-ingest.worker` как consumer.**
- **`MeetingIngestAdapter`** payload-структура (для парсинга в block-ingest): `{meetingId, type, title, startedAt, endedAt, durationMs, participants: [{participantId, userId, displayName, role, livekitIdentity, joinedAt, leftAt}], transcript: {totalWords, totalDurationSeconds, turns: [{speaker, text, startSec, endSec}]}, roomChat: [{sentAt, authorName, authorRole?, content}]}`.
- **`EmbeddingFallbackService.embed(texts: string[])`** ([backend/src/modules/embeddings/services/embedding-fallback.service.ts](backend/src/modules/embeddings/services/embedding-fallback.service.ts)) уже работает каскадом proxy ↔ local. Используется в `transcript-indexer.service.ts` и `chat.service.ts`. ENV `EMBEDDING_PROVIDER` + `EMBEDDING_MODEL` (default `text-embedding-3-small`) + `EMBEDDING_DIMENSIONS` (default 1536).
- **pgvector HNSW + cosine** уже настроен в [backend/scripts/postgres-init.sql](backend/scripts/postgres-init.sql) для `MeetingTranscriptChunk.embedding`. Шаблон KNN-запроса — в [backend/src/modules/chat/chat.service.ts:332](backend/src/modules/chat/chat.service.ts#L332): `1 - (embedding <=> $vec::vector) AS similarity`.
- **`LlmRouterService.call({taskType, tenantId, systemPrompt, userMessage, ...})`** ([backend/src/modules/ai/services/llm-router.service.ts](backend/src/modules/ai/services/llm-router.service.ts)) — после Фазы 0 принимает обязательный `tenantId` и пишет полную запись в `AiUsageLog` (cachedTokens, sourceRef, experimentGroup поддержаны). **НО:** не поддерживает `jsonSchema` / `jsonMode` / `jsonObject` и не поддерживает A/B через `LlmTaskRoute.experiment` (в Фазе 0 поле добавлено, но логика не реализована — это OK для Фазы 7, но JSON Schema нужен здесь).
- **Провайдеры в LlmRouter:** `AnthropicService`, `MinimaxService`, `OpenAiProxyService`. **DeepSeekService и OllamaService отсутствуют** (отступление Фазы 0). Их нужно добавить **до** `block-ingest.worker`, иначе primary-стек по новой политике не работает.
- **Текущие routes в `LlmTaskRoute`** (через [backend/scripts/seed-llm-task-routes-knowledge-core.ts](backend/scripts/seed-llm-task-routes-knowledge-core.ts) Фазы 0): только legacy taskType (`summary, chapters, ...`) с цепочкой `anthropic → minimax → openai-via-proxy`. Это **противоречит** политике 2026-05 — переписать в Шаге 0.
- **`MODEL_PRICES`** в [backend/src/modules/ai/services/model-prices.ts](backend/src/modules/ai/services/model-prices.ts) уже содержит DeepSeek V4, GPT-5.4 family, BGE-M3, qwen3 (мой подготовительный коммит `b1b88fd`). `LlmModelPrice` таблица заполнена `seed-llm-model-prices.ts` Фазы 0 — но **проверить**, что DeepSeek/GPT-5.4 действительно сиделись.

#### Архитектурное решение по эмбеддингам

ТЗ строка 258 говорит `embedding vector(1536)`. По LLM-политике 2026-05 primary embedding — `bge-m3` (1024-dim). Но ENV `EMBEDDING_DIMENSIONS=1536` хардкоднут, и `MeetingTranscriptChunk` уже vector(1536). Делать сейчас vector(1024) для IdeaBlock — конфликт.

**Решение:** на Фазе 2 — `IdeaBlock.embedding vector(1536)`, `Entity.embedding vector(1536)`, primary embedding-модель — `text-embedding-3-small` через прокси (как в существующем коде). BGE-M3 как fallback — через `EMBEDDING_PROVIDER=local`. Полная миграция на bge-m3 (с ресэйзом до vector(1024)) — отдельной задачей в Фазе 11 или vNext.

#### Архитектурное решение по JSON Schema

ТЗ требует `IdeaBlock` извлекать как структурированный JSON — нужен strict JSON Schema. Текущий `LlmRouter` не передаёт JSON Schema провайдерам. Расширяю в Шаге 0:

- В `LlmCallParams` добавить `responseFormat?: { type: 'text' } | { type: 'json_object' } | { type: 'json_schema', name: string, schema: object, strict: boolean }`.
- В адаптерах:
  - `OpenAiProxyService` — мапит на Responses API `text.format = {type: 'json_schema', name, strict, schema}` (уже описано в [llm-models-playbook.md §5](llm-models-playbook.md)).
  - `DeepSeekService` (новый) — мапит на chat/completions `response_format: {type: 'json_schema', json_schema: {name, strict, schema}}`.
  - `AnthropicService` — JSON Schema через tool-call (Anthropic не имеет нативного strict-режима; синтезируется через `tools: [{name, input_schema}], tool_choice: {type: 'tool', name}`). На Фазе 2 — поддержка опциональная (Anthropic не в дефолтах).
  - `MinimaxService` — Anthropic-совместимый, тот же tool-trick.
  - `OllamaService` (новый) — через `format: 'json'` (нативный JSON-mode без schema-валидации; валидация на стороне caller'а через `zod`).
- Если провайдер не поддерживает запрашиваемый формат — `LlmRouterService` может выбросить `LlmFormatNotSupportedError` и перейти на следующий провайдер в fallback-цепочке.

#### Архитектурное решение по `block-ingest.worker` нарезке

ТЗ говорит «режет на смысловые сегменты (не по токенам, а по абзацам/смысловым границам — определяется LLM-вызовом “найди границы тем”)». Это два LLM-вызова на сегмент (сегментация + извлечение блоков). На длинных встречах (1ч ≈ 100 смысловых сегментов) это дорого.

**Решение:** на Фазе 2 — упрощённая стратегия:
1. Парсим `payload.transcript.turns` → группируем подряд идущие turns одного speaker'а в «high-level segments» с лимитом ≤2000 токенов.
2. Скользим окно по сегментам: каждые 5-7 сегментов — один LLM-вызов `block-ingest` с **JSON Schema strict** «извлеки список IdeaBlock».
3. Дедуп блоков из соседних окон делает `block-distill.worker` (это его задача).
4. Оптимизация «найди границы тем» (одностраничные cluster boundaries по эмбеддингам или LLM-сегментация) — отдельный optimization-tickeр после Фазы 2 baseline.

#### Пошаговый план для агента (6 шагов)

Каждый шаг — атомарный коммит. После Шага 1 — `npm run prisma:push --accept-data-loss`. После каждого шага с кодом: `npm run typecheck` зелёный.

**Шаг 0. LLM-инфраструктура (DeepSeekService + OllamaService + JSON Schema + новые routes).**

1. Создать `backend/src/modules/ai/services/deepseek.service.ts`:
   - Конструктор — берёт `cfg.ai.deepseek.apiKey`, `cfg.ai.deepseek.baseUrl` (default `https://api.deepseek.com/v1`; альтернатива `https://proxy.agent-lia.ru/deepseek/v1` — проверить наличие маршрута на прокси через тестовый GET; если 404 — использовать прямой). Дефолт-модель `deepseek-v4-flash` для общих, `deepseek-v4-pro` если caller передаёт `taskType in ('summary-v2', 'goal-alignment', 'reframing-arbiter')`.
   - Метод `complete(input: LlmCompleteInput): Promise<LlmCompleteResult>`. Использует OpenAI SDK (уже в зависимостях) с `baseURL` и `apiKey`. JSON Schema через `response_format: {type: 'json_schema', json_schema: {name, strict, schema}}` если `input.responseFormat?.type === 'json_schema'`. Поддержка thinking on/off через `reasoning: {effort: 'low'|'medium'|'high'}` для V4-pro (V4-flash thinking-off дефолт).
   - Поддержка prompt caching: DeepSeek авто-кэширует — токены `cached_input_tokens` приходят в `usage`, маппим в `LlmCompleteResult.cachedTokens`.
   - Retry [500, 1000, 2000]ms на 429/5xx, как в OpenAI proxy.
2. Создать `backend/src/modules/ai/services/ollama.service.ts`:
   - Конструктор — `cfg.ai.ollama.baseUrl` (default `https://ollama.agent-lia.ru/v1`), `cfg.ai.ollama.apiKey` (опционально).
   - Дефолт-модель `qwen3:30b-a3b-instruct-2507`. Caller может переопределить через `model` в input.
   - Метод `complete()` — chat/completions OpenAI-compat. JSON-mode через `response_format: {type: 'json_object'}` (нативный), без strict-schema (caller валидирует zod'ом).
   - Также — `embed(texts: string[])` для BGE-M3 (если URL содержит `bge-m3` — через `model: 'bge-m3'`, dim 1024). Но т.к. embedding-каскад уже через `LocalEmbeddingService` — на Фазе 2 эту часть пропускаем, оставляем для Фазы 11.
3. Расширить `LlmCallParams` и `LlmCompleteInput`:
   ```ts
   responseFormat?:
     | { type: 'text' }
     | { type: 'json_object' }
     | { type: 'json_schema'; name: string; schema: Record<string, unknown>; strict: boolean };
   reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
   ```
4. Обновить `LlmRouterService.call()`:
   - Передать `responseFormat` и `reasoningEffort` в адаптеры.
   - Если адаптер бросает `LlmFormatNotSupportedError` (новый класс ошибок) — перейти на следующий провайдер в fallback (как обычная retriable error).
   - Регистрировать новые провайдеры по ключам `'deepseek'` и `'ollama'` в фабрике провайдеров.
5. Обновить `MODEL_PRICES` (если что-то отсутствует — добавить). Также проверить `LlmModelPrice`-таблицу: запустить `seed-llm-model-prices.ts` ещё раз — он должен быть идемпотентным и upsert'ить новые модели.
6. **Переписать [backend/scripts/seed-llm-task-routes-knowledge-core.ts](backend/scripts/seed-llm-task-routes-knowledge-core.ts):**
   - Legacy taskType (`summary, chapters, tasks, chat, regenerate-section, custom-prompt, follow-up, clip-title, card-rollup, card-chat`) → `[{provider: 'deepseek', model: 'deepseek-v4-flash'}, {provider: 'openai-via-proxy', model: 'gpt-5.4-mini'}, {provider: 'ollama', model: 'qwen3:30b-a3b-instruct-2507'}]`.
   - Новые knowledge-core taskType (см. таблицу [llm-models-playbook.md §2.1](llm-models-playbook.md)):
     - `block-ingest`: deepseek-v4-flash + json_schema strict, fallback gpt-5.4-mini, ollama.
     - `block-distill`: deepseek-v4-flash thinking-off, fallback ollama qwen3:30b, gpt-5.4-nano.
     - `block-linker`: deepseek-v4-flash, fallback gpt-5.4-nano.
     - `entity-resolver`: deepseek-v4-flash, fallback gpt-5.4-nano.
     - `entity-merge-arbiter`: deepseek-v4-flash, fallback gpt-5.4-mini.
     - `theme-classify`: gpt-5.4-nano (primary), fallback deepseek-v4-flash, qwen3.
     - `reframing`: deepseek-v4-flash, fallback gpt-5.4-mini.
     - `card-rollup-v2`: deepseek-v4-flash, fallback gpt-5.4-mini.
     - `task-extract-v2`: deepseek-v4-flash + json_schema strict.
     - `chapter-extract-v2`: deepseek-v4-flash + json_schema strict.
     - `summary-v2`: deepseek-v4-pro thinking-on, fallback gpt-5.5, MiniMax-M2.7.
     - `chat-v2`: deepseek-v4-flash, fallback gpt-5.4, gpt-5.5.
     - `goal-alignment`: deepseek-v4-pro thinking-on, fallback gpt-5.5.
     - `dashboard-summary`: deepseek-v4-flash, fallback gpt-5.4-mini.
   - Запустить с флагом `--update-existing`.
7. Smoke: `backend/scripts/smoke-llm-router-fase2-step0.ts` — простой вызов `LlmRouterService.call({taskType: 'block-distill', tenantId: someTenantId, systemPrompt: 'Reply yes or no.', userMessage: 'Is sky blue?', responseFormat: {type: 'text'}})` и ещё один с `responseFormat: {type: 'json_schema', name: 'YesNo', strict: true, schema: {...}}`. Проверить, что DeepSeek реально отвечает, AiUsageLog пишется с правильным provider/model/cachedTokens.

**Шаг 1. Prisma schema (IdeaBlock + Entity + связи) + push + индексы.**

1. В [backend/prisma/schema.prisma](backend/prisma/schema.prisma) добавить enum'ы:
   ```
   enum SignalType {
     fact pain feature_request objection churn_risk idea risk
     commitment decision mood drift competitor_move metric_change knowledge_gap
   }
   enum IdeaBlockStatus { draft canonical merged_into archived }
   enum EntityType { client person project product topic location custom }
   enum IdeaBlockEntityRole { subject object mentioned }
   ```
2. Модель `IdeaBlock`:
   ```
   model IdeaBlock {
     id               String         @id @default(cuid())
     tenantId         String
     name             String
     criticalQuestion String         @db.Text
     trustedAnswer    String         @db.Text
     tags             String[]       @default([])
     signalType       SignalType
     confidence       Decimal        @default(0.5) @db.Decimal(4, 3)
     dataClass        DataClass      @default(internal)
     embedding        Unsupported("vector(1536)")?
     status           IdeaBlockStatus @default(draft)
     mergedIntoId     String?
     evidenceCount    Int            @default(0)
     dynamicScore     Decimal        @default(1.0) @db.Decimal(8, 4)
     createdAt        DateTime       @default(now())
     updatedAt        DateTime       @updatedAt

     org              Org            @relation(fields: [tenantId], references: [id], onDelete: Cascade)
     mergedInto       IdeaBlock?     @relation("BlockMerges", fields: [mergedIntoId], references: [id])
     mergedFrom       IdeaBlock[]    @relation("BlockMerges")
     evidence         IdeaBlockEvidence[]
     entities         IdeaBlockEntity[]

     @@index([tenantId, status])
     @@index([tenantId, signalType])
     @@index([tenantId, mergedIntoId])
   }
   ```
3. Модель `IdeaBlockEvidence`:
   ```
   model IdeaBlockEvidence {
     id              String     @id @default(cuid())
     blockId         String
     rawEventId      String
     sourceType      SourceType
     sourceTimestamp DateTime?
     quote           String     @db.Text
     startMs         Int?
     endMs           Int?
     createdAt       DateTime   @default(now())

     block           IdeaBlock  @relation(fields: [blockId], references: [id], onDelete: Cascade)
     rawEvent        RawEvent   @relation(fields: [rawEventId], references: [id], onDelete: Cascade)

     @@index([blockId])
     @@index([rawEventId])
   }
   ```
   + добавить `evidence: IdeaBlockEvidence[]` в `RawEvent`.
4. Модель `Entity`:
   ```
   model Entity {
     id            String     @id @default(cuid())
     tenantId      String
     type          EntityType
     canonicalName String
     aliases       String[]   @default([])
     mergedIntoId  String?
     mentionsCount Int        @default(0)
     embedding     Unsupported("vector(1536)")?
     metadata      Json?
     createdAt     DateTime   @default(now())
     updatedAt     DateTime   @updatedAt

     org           Org        @relation(fields: [tenantId], references: [id], onDelete: Cascade)
     mergedInto    Entity?    @relation("EntityMerges", fields: [mergedIntoId], references: [id])
     mergedFrom    Entity[]   @relation("EntityMerges")
     blockMentions IdeaBlockEntity[]

     @@index([tenantId, type])
     @@index([tenantId, mergedIntoId])
     @@index([tenantId, canonicalName])
   }
   ```
5. Модель `IdeaBlockEntity`:
   ```
   model IdeaBlockEntity {
     blockId        String
     entityId       String
     mentionContext String   @db.Text
     role           IdeaBlockEntityRole @default(mentioned)
     createdAt      DateTime @default(now())

     block          IdeaBlock @relation(fields: [blockId], references: [id], onDelete: Cascade)
     entity         Entity    @relation(fields: [entityId], references: [id], onDelete: Cascade)

     @@id([blockId, entityId])
     @@index([entityId])
   }
   ```
6. Релейшены `Org.ideaBlocks`, `Org.entities`.
7. `npm run prisma:push --accept-data-loss`.
8. Расширить [backend/scripts/postgres-init.sql](backend/scripts/postgres-init.sql):
   - `CREATE INDEX IF NOT EXISTS "IdeaBlock_embedding_hnsw_cosine_idx" ON "IdeaBlock" USING hnsw (embedding vector_cosine_ops) WHERE embedding IS NOT NULL;`
   - `CREATE INDEX IF NOT EXISTS "Entity_embedding_hnsw_cosine_idx" ON "Entity" USING hnsw (embedding vector_cosine_ops) WHERE embedding IS NOT NULL;`
   - Запустить скрипт вручную через `psql $DATABASE_URL -f backend/scripts/postgres-init.sql` (или добавить команду в `backend/package.json` если нет).

**Шаг 2. `block-ingest.worker` (consumer для core.raw-events).**

1. Создать [backend/src/modules/knowledge-core/](backend/src/modules/knowledge-core/) — главный модуль ядра.
2. Сервисы:
   - `services/segment-builder.service.ts` — функция `buildSegments(payload): Segment[]`. Группирует turns одного speaker'а подряд, splits по ≤2000 токенов (грубая оценка `chars / 4`), возвращает массив `{startMs, endMs, speakers, text}`.
   - `services/block-extraction.service.ts` — `extractBlocks(segments: Segment[], tenantId, rawEvent): Promise<{blocks: ExtractedBlock[], usage}[]>`. Для групп по 5 сегментов (≈10K токенов) — один LLM-вызов `block-ingest` с JSON Schema strict, схема:
     ```ts
     {
       type: 'object',
       properties: {
         blocks: {
           type: 'array',
           items: {
             type: 'object',
             required: ['name', 'criticalQuestion', 'trustedAnswer', 'signalType', 'tags', 'confidence', 'evidenceQuote', 'evidenceStartMs', 'evidenceEndMs', 'mentionedEntities'],
             properties: {
               name: {type: 'string', maxLength: 200},
               criticalQuestion: {type: 'string'},
               trustedAnswer: {type: 'string'},
               signalType: {type: 'string', enum: SignalType.values},
               tags: {type: 'array', items: {type: 'string'}},
               confidence: {type: 'number', minimum: 0, maximum: 1},
               evidenceQuote: {type: 'string'},
               evidenceStartMs: {type: 'integer', minimum: 0},
               evidenceEndMs: {type: 'integer', minimum: 0},
               mentionedEntities: {
                 type: 'array',
                 items: {
                   type: 'object',
                   required: ['type', 'name', 'mentionContext'],
                   properties: {
                     type: {type: 'string', enum: EntityType.values},
                     name: {type: 'string'},
                     mentionContext: {type: 'string'},
                     metadata: {type: 'object'},
                   },
                 },
               },
             },
           },
         },
       },
     }
     ```
   - Промпт системы (своими словами, не копируя delivery): «Ты — извлекатель структурированного знания из расшифровки встречи. Получи список turn'ов и верни массив IdeaBlock'ов: каждое значимое утверждение, обязательство, риск, идея, болевая точка, метрика. ...» (полный текст пишет агент, фиксируется в `backend/src/modules/knowledge-core/prompts/block-ingest.prompt.ts`).
3. `services/embedding-service.service.ts` — обёртка `embedBlocks(texts: string[]): Promise<number[][]>` через `EmbeddingFallbackService` с batch=100. Используется и для блоков, и для сущностей (один и тот же canonicalName).
4. `services/entity-resolution.service.ts` — `findOrCreateEntity({tenantId, type, name, metadata}): Promise<Entity>`. Логика на Шаге 2 — простой `findFirst by (tenantId, type, normalize(canonicalName))` с case-insensitive trim и unaccent. Если не найдено — `create` с `embedding`. Реальная LLM-арбитражная дедупликация — Шаг 3 (`entity-resolver.worker`).
5. Worker [backend/src/modules/knowledge-core/workers/block-ingest.worker.ts](backend/src/modules/knowledge-core/workers/block-ingest.worker.ts):
   - Слушает очередь `core.raw-events` (BullMQ Worker, concurrency 2 на старте).
   - На job `{rawEventId}`:
     a) Загрузить `RawEvent` (включая S3 payload через `S3Service.getJson(payloadS3Key)` если `payloadStorage='s3'`).
     b) Если `processingStatus !== 'received'` — skip (idempotency для retry).
     c) `buildSegments(payload)` → `extractBlocks(segments, tenantId, rawEvent)` → массив extracted blocks.
     d) Для каждого extracted block — в одной Prisma-транзакции:
        - `embedBlocks([block.criticalQuestion + ' ' + block.trustedAnswer])` → embedding.
        - `prisma.ideaBlock.create({status: 'draft', ...})` → blockId.
        - `prisma.ideaBlockEvidence.create({blockId, rawEventId, sourceType, sourceTimestamp: rawEvent.occurredAt, quote, startMs, endMs})`.
        - Для каждой `mentionedEntity`: `findOrCreateEntity` → `prisma.ideaBlockEntity.create({blockId, entityId, mentionContext, role: 'mentioned'})`.
     e) Обновить `RawEvent.processingStatus='ingested', processedAt=now`.
     f) Опубликовать BullMQ-событие `block.draft-created` в новую очередь `core.block-distill` с jobId `block-distill_<blockId>` для каждого блока (это триггер для Шага 3 worker'а).
   - На ошибку — `RawEvent.processingStatus='failed', processingError=err.message`. BullMQ retry по дефолту (5 attempts, exp backoff 5s).
6. Регистрация worker'а в `WorkersModule` ([backend/src/modules/workers.module.ts](backend/src/modules/workers.module.ts)).
7. Расширить `CoreQueueService` методом `enqueueBlockDistill(blockId)` + новой очередью `core.block-distill`.

**Шаг 3. `block-distill.worker` (consumer для core.block-distill).**

1. `services/block-merge.service.ts` — `mergeIfDuplicate({newBlock, candidates: IdeaBlock[]}): Promise<{verdict: 'distinct' | 'merge'; canonicalId?: string; explanation: string}>`. Один LLM-вызов `block-distill` с JSON Schema strict.
2. Worker [backend/src/modules/knowledge-core/workers/block-distill.worker.ts](backend/src/modules/knowledge-core/workers/block-distill.worker.ts):
   - Слушает `core.block-distill`. Concurrency 2.
   - Дебаунс: BullMQ `delay: 30000` ms на каждый job (см. ТЗ строка 272). Дубль (тот же jobId) обновляет delay.
   - На job `{blockId}`:
     a) Загрузить `IdeaBlock(blockId)`. Если `status !== 'draft'` — skip.
     b) KNN-поиск через pgvector: top-K (K=5) среди `IdeaBlock(tenantId=block.tenantId, status='canonical')` где `cosine_similarity > DISTILL_MERGE_THRESHOLD` (env var, default 0.92).
     c) Если кандидатов нет — `block.status='canonical'`, `evidenceCount=block.evidence.length`, опубликовать `block.canonical-created` в очередь `core.block-linker` (для Фазы 3) и `core.theme-clusterer` (для Фазы 4 — но только статусом если кластерер запущен).
     d) Если есть кандидаты — `mergeIfDuplicate(newBlock, candidates)`.
     e) Если verdict=`distinct` — `block.status='canonical'`, как в (c).
     f) Если verdict=`merge` — Prisma-транзакция:
        - `block.status='merged_into', mergedIntoId=canonicalId`.
        - Перенести evidence с new на canonical (`updateMany evidence.blockId=block.id → canonicalId`).
        - Обновить canonical: `evidenceCount += new.evidenceCount`, `confidence = weighted avg`, `tags = union(canonical.tags, new.tags)`.
        - Перенести `IdeaBlockEntity` с new на canonical (с merge mentionContext).
3. Расширить `CoreQueueService` — `enqueueBlockLinker(blockId)` + очередь `core.block-linker` (consumer появится в Фазе 3, на Фазе 2 — jobs накапливаются).
4. ENV переменные: `DISTILL_MERGE_THRESHOLD=0.92`, `DISTILL_DEBOUNCE_MS=30000`, `DISTILL_KNN_TOP_K=5`. Добавить в `env.schema.ts`.

**Шаг 4. `entity-resolver.worker` (cron + on event).**

1. `services/entity-merge.service.ts` — `mergeIfSameEntity({entity, candidates}): Promise<{verdict, canonicalId?, explanation}>` через LLM `entity-merge-arbiter`. Промпт обязательно включает metadata (для `person` — должность/email, для `client` — ИНН/домен) + контекст 3-5 ближайших блоков.
2. Worker [backend/src/modules/knowledge-core/workers/entity-resolver.worker.ts](backend/src/modules/knowledge-core/workers/entity-resolver.worker.ts):
   - Cron: `EveryExpression('*/5 * * * *')` — раз в 5 мин на каждый Org (через `@nestjs/schedule`). Также подписка на `core.entity-resolver` (очередь для on-demand ad-hoc вызовов после `block-ingest`).
   - На каждый Org с `Membership.role IN (owner, admin)` (т.е. активный):
     - Найти пары `Entity` той же `tenantId`, того же `type`, у которых cosine между embeddings > `ENTITY_MERGE_THRESHOLD` (default 0.88).
     - Для каждой пары — `mergeIfSameEntity` → если merge: `entity.mergedIntoId=canonical.id`, перенос `IdeaBlockEntity` на canonical (`updateMany`).
3. ENV: `ENTITY_MERGE_THRESHOLD=0.88`, `ENTITY_RESOLVER_CRON='*/5 * * * *'`.

**Шаг 5. Search API + Block/Entity API.**

1. Новый модуль [backend/src/modules/knowledge-core/api/](backend/src/modules/knowledge-core/api/):
   - `search.controller.ts`, `search.service.ts`, `blocks.controller.ts`, `entities.controller.ts`.
2. `POST /api/v1/search`:
   - Body: `{query, signalTypes?, entityIds?, dateFrom?, dateTo?, limit?}`. tenantId — из `@CurrentOrg()` (Фаза 0).
   - Логика:
     a) Embed `query` через `EmbeddingFallbackService.embed([query])`.
     b) Гибридный SQL: cosine + ts_vector BM25 на `name + ' ' + criticalQuestion + ' ' + trustedAnswer`. Веса из ENV (`SEARCH_COSINE_WEIGHT=0.7`, `SEARCH_BM25_WEIGHT=0.3`).
     c) Фильтры: `tenantId`, `status='canonical'`, опциональные `signalType IN (...)`, `EXISTS (SELECT 1 FROM IdeaBlockEntity WHERE blockId=block.id AND entityId IN (...))`, `EXISTS (SELECT 1 FROM IdeaBlockEvidence WHERE blockId=block.id AND sourceTimestamp BETWEEN $from AND $to)`.
     d) Limit (default 10, max 50).
     e) Возврат: `{results: [{block: BlockDto, evidence: EvidenceDto[], score, matchedBy}]}`.
   - Для DB-side ts_vector: добавить генерируемый столбец в `IdeaBlock` через [postgres-init.sql](backend/scripts/postgres-init.sql) (`ALTER TABLE "IdeaBlock" ADD COLUMN IF NOT EXISTS "search_tsv" tsvector GENERATED ALWAYS AS (to_tsvector('russian', name || ' ' || "criticalQuestion" || ' ' || "trustedAnswer")) STORED;` + GIN index). Prisma это игнорирует (Unsupported), но запросы через `$queryRawUnsafe` его читают.
3. `GET /api/v1/blocks/:id` — блок + evidence + entities (с резолюцией mergedInto-цепочек).
4. `GET /api/v1/entities` — список с фильтром `?type=...&search=...`. Pagination.
5. `GET /api/v1/entities/:id` — сущность + связанные блоки + (vNext) ссылки.
6. Все API под `CookieAuthGuard` + `TenantGuard` + RBAC проверка через `RbacService`.

**Шаг 6. Бенчмарк + smoke + second-brain.**

1. `backend/scripts/benchmark-knowledge-core.ts`:
   - Golden-set: 5-10 заранее подготовленных встреч (можно из dev-БД), для каждой — список «ожидаемых ответов на типичные вопросы» (вручную).
   - Прогон: для каждой встречи — ingest → distill → 5 вопросов через `POST /api/v1/search`.
   - Метрики:
     - top-3 hit rate (в скольких % вопросов ответ найден в top-3 блоков).
     - сжатие (`canonical_blocks_count / segments_count`).
     - покрытие сущностей.
   - Сравнение со старым chunk-based RAG (через `chat.service`) — на тех же вопросах.
   - Результаты в [docs/benchmarks/knowledge-core-baseline.md](docs/benchmarks/knowledge-core-baseline.md).
2. `backend/scripts/smoke-knowledge-core-fase2.ts`:
   - Создать тестовый Org + Source + RawEvent с заглушечным payload (~10 turns).
   - Дождаться обработки `block-ingest.worker` (запустить его в том же процессе или sleep + проверить).
   - Проверить: ≥3 IdeaBlock (status='canonical' после distill), ≥1 Entity, ≥1 IdeaBlockEntity, ≥1 IdeaBlockEvidence.
   - Дёрнуть `POST /api/v1/search?q=test query` — получить результаты.
   - Cleanup.
3. **second-brain обновления:**
   - Создать [second-brain/02_architecture/knowledge-core.md](second-brain/02_architecture/knowledge-core.md) — главный документ про новое ядро: pipeline ingest → distill → retrieve, JSON Schema, threshold'ы, очереди.
   - Обновить [second-brain/02_architecture/data-model.md](second-brain/02_architecture/data-model.md) — IdeaBlock, IdeaBlockEvidence, Entity, IdeaBlockEntity, ER-диаграмма.
   - Обновить [second-brain/02_architecture/module-map.md](second-brain/02_architecture/module-map.md) — модуль `knowledge-core`.
   - Обновить [second-brain/01_projects/llm-router.md](second-brain/01_projects/llm-router.md) — DeepSeek + Ollama адаптеры, JSON Schema поддержка.
   - Обновить [second-brain/index.md](second-brain/index.md) — добавить `knowledge-core.md` в раздел «Архитектура».

#### Что вне Фазы 2 (для ясности агенту)

- `IdeaBlockLink` (связи блок↔блок типизированные) — Фаза 3.
- `EntityLink` (связи сущность↔сущность) — Фаза 3.
- `Reframing.worker` (ночное переосмысление) — Фаза 3.
- `Theme` + `theme-clusterer.worker` — Фаза 4.
- `Tasks-2.0`, `Chapters-2.0`, `Summary-2.0` агенты поверх блоков — Фаза 5.
- `chat-v2` через ядро — Фаза 6 (на Фазе 2 старый `chat` остаётся работать поверх `MeetingTranscriptChunk`).
- Z-Admin / Org-Admin UI для отладки ядра — Фаза 7.
- Удаление `MeetingTranscriptChunk` + `transcript-index.worker` — Фаза 6.
- Полная миграция на BGE-M3 (vector(1024)) — Фаза 11 / vNext.

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

> **Отдельное ТЗ для агента-исполнителя:** [plans/tz/2026-05-10-phase-7-admin.md](plans/tz/2026-05-10-phase-7-admin.md). Раздел ниже — высокоуровневое описание, актуальный план шагов и архитектурные решения см. в дочернем ТЗ.

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

> **Отдельное ТЗ для агента-исполнителя:** [plans/tz/2026-05-10-phase-8-director-dashboard.md](plans/tz/2026-05-10-phase-8-director-dashboard.md). Раздел ниже — высокоуровневое описание.

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

> **Отдельное ТЗ для агента-исполнителя:** [plans/tz/2026-05-10-phase-9-goals-strategic-alignment.md](plans/tz/2026-05-10-phase-9-goals-strategic-alignment.md). Раздел ниже — высокоуровневое описание.

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

- [x] Фаза 0
- [x] Фаза 1
- [x] Фаза 2
- [x] Фаза 3
- [x] Фаза 4
- [x] Фаза 5
- [x] Фаза 6
- [x] Фаза 7 — Z-Admin + Org-Admin (закрыта 2026-05-10)
- [x] Фаза 8 — Дашборд директора (закрыта 2026-05-10)
- [x] Фаза 9 — Goals + strategic-alignment (закрыта 2026-05-10)
- [x] Фаза 10 — telegram/mango/imap/web-form адаптеры + Sources (закрыта 2026-05-10)
- [x] Фаза 11 — retention + 152-ФЗ + dataClass routing + observability (закрыта 2026-05-10)
- [x] Фаза 12 — тарифы и entitlements (закрыта 2026-05-10)

## Ревизия от 2026-05-24

**Статус:** done (база knowledge core) + superseded (последующая эволюция Кора v2)
**Реализовано:**
- Org/Membership/RBAC: `backend/src/modules/orgs/` (orgs.service, orgs.controller, org-invitations.service) + Casbin-совместимый `backend/src/modules/rbac/` + `TenantGuard`. Модели Org, Membership, OrgInvitation в `backend/prisma/schema.prisma`.
- Универсальный ingest + Source/RawEvent + meeting-adapter + сторонние адаптеры (Telegram, MAX, email, document) в `backend/src/modules/ingest/` и `backend/src/modules/conversational/`.
- Pipeline IdeaBlock + Entity + Theme: `backend/src/modules/knowledge-core/services/{block-extraction,block-merge,block-link,clustering,embedding,entity-resolution,entity-merge,entity-graph,theme-classification}.service.ts` + воркеры `block-distill.worker`, `entity-resolver.worker`, `theme-clusterer.cron`, `block-linker.worker`, `reframing.cron`.
- 7 специалистов (3-1 Regulations, 3-2 Knowledge Clone, 3-3 Decisions, 3-4 Project/Customer, 3-5 Insights, 3-6 Ideas+Probe, 3-7 Skill+Persona) + 3.8 Helpfulness, 3.9 Experiments, 3.10 Brand Voice — все в `backend/src/modules/knowledge-core/{services,workers,prompts}/`.
- DialogService + chat-v2 + AnswerCache/RetrievalCache: `backend/src/modules/chat/` + α-5 артефакты.
- Z-Admin / Org-Admin: `frontend/app/(authenticated)/admin/*` (ai-models, ai-usage, llm-prices, experiments, orgs, integration-keys, recordings).
- Дашборд директора + COO Operations Dashboard: `backend/src/modules/dashboard/director-dashboard.controller.ts` + `frontend/app/(authenticated)/dashboard/page.tsx`.
- Goals + strategic-alignment: `frontend/app/(authenticated)/goals/*` + `knowledge-core/workers/strategic-alignment.worker.ts`.
- Entitlements + tarifs: `backend/src/modules/entitlements/`.
- LlmRouter с обязательной записью в AiUsageLog + A/B-эксперименты: `backend/src/modules/ai/services/llm-router.service.ts` + admin UI.

**Заменён на:** [plans/tz/2026-05-22-final-roadmap.md](2026-05-22-final-roadmap.md) — зонтичный ТЗ Коры v2 (24 sub-ТЗ α/β/γ/δ), который продолжает развитие ядра: Orchestrator, ProactiveWatcher, CrossFunctionalProcess, Concierge Agent, Voice Channel, CompletenessSlot, Appointment, CompanyProfile, FunctionalDomain.
