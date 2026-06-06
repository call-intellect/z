# Технический аудит проекта Z (Кора) — 2026-06-05

## 1. Резюме для занятых

**Общий вердикт о зрелости.** Z — это зрелый по инженерной культуре, но архитектурно односерверный монолит, переросший заявленный MVP. Backend — это 97 feature-модулей (англ. feature module — функциональный модуль) NestJS, единая Prisma-схема (схема базы данных) на ~10 200 строк / 242 модели, ~160 крон-задач (англ. cron — планировщик) и десятки BullMQ-воркеров (англ. worker — фоновый обработчик очередей), фронтенд на Next.js — 262 страничных роута. Ядро продукта — «память компании» (граф знаний из встреч, документов, чатов, звонков) — реально глубокое и многоисточниковое, а не обещание в дорожной карте. Денежные расчёты, идемпотентность (англ. idempotency — устойчивость к повторам) вебхуков, дедупликация (устранение дублей) приёма данных, конечный автомат (англ. FSM — finite state machine) встречи сделаны грамотно и местами образцово.

Однако фундамент держится на ручной дисциплине без машинных гарантов в трёх критических местах: **(1) нет процессного разделения** — HTTP-сервер, все кроны и все воркеры крутятся в одном Node-процессе, что прямо противоречит собственной документации; **(2) нет CI/CD** (англ. continuous integration — непрерывная интеграция) — ~500 тест-файлов, проверка типов и линтер (англ. linter — статический анализатор) не запускаются автоматически ни на одном шлюзе; **(3) безопасность мультитенантности** (изоляция данных арендаторов) и расход на LLM (англ. large language model — большая языковая модель) держатся на дисциплине, а не на коде. Продукт работоспособен на текущем MVP (десятки компаний, до 10 участников встречи), но несколько системных дефектов гарантированно проявятся при росте ×10.

**Топ-5 критичных рисков.**

1. **Единая точка отказа домена `*.agent-lia.ru`** (critical, partially-confirmed). Вторичный и третичный уровни LLM, ASR (англ. automatic speech recognition — распознавание речи), эмбеддинги (англ. embeddings — векторные представления) — все на одном домене. Его отказ одновременно выносит транскрибацию, векторизацию и оба запасных уровня LLM, оставляя только `deepseek` как primary (первичный); для части задач — полный отказ.
2. **Изоляция тенантов без машинного гаранта** (high). `CookieAuthGuard` и `TenantGuard` не глобальные — применяются вручную на ~194 контроллерах; один забытый декоратор открывает данные одной компании другой или анониму, и нет ни линт-правила, ни архитектурного теста, ловящего это.
3. **Один процесс под всё + нет CI** (high). Тяжёлый AI-конвейер делит цикл событий (англ. event loop) с HTTP; ~97 из ~106 крон-файлов без распределённой блокировки (англ. distributed lock) — при 2+ репликах каждая крон выполнится N раз (двойные дайджесты, выплаты, расход LLM). При этом регрессия (англ. regression — откат качества) уезжает в прод без теста-гейта.
4. **Бюджет LLM только наблюдается, но не enforce-ится** (high). `OrgBudgetCap` лишь шлёт уведомление раз в 2 часа; `LlmRouter` не проверяет бюджет перед вызовом. Один взбесившийся воркер или тенант выжигает месячный лимит за часы незаметно, усугубляясь тихим `costUsd=0` для моделей вне прайс-карты.
5. **Append-only телеметрия растёт без retention** (high). `AiUsageLog` (строка на каждый LLM-вызов + два TEXT-превью до 8 КБ) не чистится ничем; `SystemLog` принимает каждый лог в боевую БД, а его очистка — одна транзакция с таймаутом 120 с, которая откатится на большом бэклоге.

**Сильные стороны.** Почти полное отсутствие циклических зависимостей при 97 модулях; зрелая единообразная структура модулей; bi-temporal (двувременное) моделирование фактов и графа; идемпотентность приёма данных и вебхуков через `@unique` + обработку `P2002`; атомарное списание баланса встреч без ухода в минус; обязательный авто-бэкап (`pg_dump`) перед деструктивным `db push`; offsite-бэкап в S3 с retention 14 дней (опровергает гипотезу «бэкапов нет»); продуманное разделение медиа-стека LiveKit от backend; грамотная обработка UX-состояний на экране встречи.

---

## 2. Что построено по факту

**Backend (97 модулей, ~1444 не-тестовых `.ts`-файла).** Монолит NestJS, собранный плоским списком ~110 импортов в [backend/src/app.module.ts](backend/src/app.module.ts). Cross-cutting инфраструктура аккуратно вынесена в `common/*` (config через `TypedConfigService`, prisma, redis, crypto AES-256-GCM, metrics через prom-client, graph, idempotency). Циклические зависимости почти отсутствуют — `forwardRef` встречается дважды, оба раза защитно. Особенность: 42 модуля помечены `@Global()` — треть графа экспортирует сервисы во всё приложение, из-за чего реальный граф зависимостей неявный (отсюда ~27 комментариев «должен идти ПОСЛЕ/ДО» в `AppModule`).

**Ядро — knowledge-core.** Конвейер `ingest → IdeaBlock + Entity → IdeaBlockLink/EntityLink (граф) → Theme (кластеры)` через очереди `core.*` и кроны. `IngestService.ingest` детерминированно дедуплицирует по `idempotencyKey = sha256(sourceId:dedupBasis:occurredAt)`, принимает 8 типов источников (встреча, документ, e-mail, звонок, Telegram, текст, трекер, веб-форма). `BlockIngestWorker` (concurrency=2) режет на сегменты, извлекает блоки через LLM, эмбеддит батчем, линкует сущности. `BlockDistillWorker` делает pgvector-KNN (поиск ближайших векторов) среди canonical-блоков с LLM-арбитром merge/distinct. `ThemeClustererCron` раз в час кластеризует. 14 специалистов Слоя 3 (`specialist-3-*`) подписаны на одну очередь `core.specialist-routing` через единый диспетчер (это место исторически было багом и уже исправлено, см. kc-01).

**Данные.** Одна Prisma-схема [backend/prisma/schema.prisma](backend/prisma/schema.prisma) — ~10 254 строки, 242 модели, 124 enum. Дисциплинированная мультитенантность: `tenantId` встречается ~600 раз, почти каждая бизнес-таблица имеет `@relation(onDelete: Cascade)` на `Org` и составной `@@index([tenantId, ...])`. 20 колонок `Unsupported("vector(1536)")`; все HNSW/GIN/partial-unique/tsvector-индексы вынесены в [backend/scripts/postgres-init.sql](backend/scripts/postgres-init.sql). Управление схемой — `prisma db push --accept-data-loss` без файловых миграций.

**Ключевые потоки.** LLM-слой — `LlmRouterService` (~1844 строки): резолвит цепочку tier'ов (primary→secondary→tertiary), фильтрует провайдеров по `dataClass`, диспатчит с hard-timeout 30 с. 7 провайдеров (anthropic, minimax, openai-via-proxy, deepseek, ollama, kie, grsai), дефолтная цепочка — `deepseek → openai-via-proxy → ollama`. Биллинг — Subscription/Invoice/MeetingsBalance, провайдер Точка; деньги в целочисленных копейках. Квоты — Redis INCR с откатом. FSM встречи — табличный, с `assertTransition`.

**Frontend (262 страничных роута).** Next.js 14 App Router, 4 route-группы: `(public)`, `(authenticated)`, `(admin)`, `(design-preview)`. Слой данных расслоён `ApiDto → DomainModel → UiModel` через единый `ApiClient` с авто-`X-Org-Id`. Гейтинг в три эшелона: edge ([frontend/proxy.ts](frontend/proxy.ts), только наличие cookie), клиентские guard-обёртки, RBAC на бэке (источник правды). Жёсткий CSP (англ. content security policy — политика безопасности контента), security-заголовки из коробки.

**Инфра.** Единый корневой [docker-compose.yml](docker-compose.yml) (postgres + redis + one-shot migrate + backend + frontend), наружу публикует nginx; TLS через certbot. Медиа-стек (LiveKit SFU + Egress + свой Redis) вынесен в отдельный compose [infra/livekit/docker-compose.yml](infra/livekit/docker-compose.yml) с `network_mode: host`. Деплой одной командой через [backend/scripts/apply-prod-deploy.ts](backend/scripts/apply-prod-deploy.ts): авто-бэкап → dedupe → `db push` → `apply-postgres-init` → ~80 seed/patch/backfill.

---

## 3. Сильные стороны (что НЕ надо трогать)

- **Почти нет циклических зависимостей при 97 модулях.** `forwardRef` использован дважды, оба защитно — для монолита такого масштаба это нетривиальное достижение, позволяющее дробить модули без распутывания колец. [backend/src/modules/webhooks/livekit-events.handler.ts:66](backend/src/modules/webhooks/livekit-events.handler.ts#L66)
- **Идемпотентность приёма данных и вебхуков через unique + P2002.** RawEvent дедуплицируется детерминированным sha256-ключом с fallback на гонку; LiveKit-вебхуки — через `WebhookSeenEvent.eventId @unique`, billing — через `BillingEventLog.jti`, реф-выплаты — через `ReferralPayout.triggerInvoiceId`. Это атомарная защита от replay без TOCTOU-окна. [backend/src/modules/ingest/ingest.service.ts:130](backend/src/modules/ingest/ingest.service.ts#L130)
- **Атомарное списание баланса встреч.** `MeetingsBalance.consume` — один `updateMany WHERE balance >= amount`; PG row-lock гарантирует, что параллельные вызовы не уведут баланс в минус. Прошлая грабля (raw-SQL по camelCase-имени таблицы) задокументирована прямо в коде. [backend/src/modules/meetings-balance/meetings-balance.service.ts:164](backend/src/modules/meetings-balance/meetings-balance.service.ts#L164)
- **Деньги — строго целочисленные копейки.** Все расчёты в Int-копейках с `Math.round` в момент вычисления; нет float-накопления; Invoice отвергает отрицательный итог. [backend/src/modules/billing/services/seat.service.ts:149](backend/src/modules/billing/services/seat.service.ts#L149)
- **Bi-temporal граф знаний.** `IdeaBlock` и `EntityLink/IdeaBlockLink` несут `validFrom/validUntil/recordedAt/supersededBy` с целевыми индексами — редкая для продуктовых схем зрелость, позволяет отвечать «что было верно на дату X». [backend/prisma/schema.prisma:2938](backend/prisma/schema.prisma#L2938)
- **Обязательный авто-бэкап перед деструктивным push + offsite в S3.** `pg_dump -Fc` обязателен (при сбое бэкапа push не выполняется), а отдельный крон [infra/cron/backup-postgres.cron](infra/cron/backup-postgres.cron) шифрует и выгружает дамп в Selectel S3 с lifecycle-retention 14 дней; есть runbook восстановления. [backend/scripts/apply-prod-deploy.ts:428](backend/scripts/apply-prod-deploy.ts#L428)
- **Разделение медиа-стека LiveKit от backend (принцип «в prod ничего на одной ноде»).** SFU + Egress + их Redis вынесены в отдельный compose, бизнес-логики в LiveKit нет. [infra/livekit/docker-compose.yml:1](infra/livekit/docker-compose.yml#L1)
- **Образцовая обработка UX-состояний встречи.** `MeetingPageShell` покрывает все состояния FSM (loading/error/finished/failed/lobby/room), тяжёлый LiveKit/Vidstack-бандл изолирован на маршруте `(public)/m/[id]`. [frontend/app/(public)/m/[id]/MeetingPageShell.tsx:9](frontend/app/(public)/m/[id]/MeetingPageShell.tsx#L9)
- **Буфер логирования с эвикцией по важности.** `LogBufferService` при переполнении отбрасывает DEBUG/INFO/WARN (ERROR/FATAL переживают всплеск), при сбое БД возвращает пачку обратно; логирование никогда не роняет бизнес-операцию. [backend/src/modules/logging/log-buffer.service.ts:71](backend/src/modules/logging/log-buffer.service.ts#L71)
- **Tier-fallback LLM-роутера с hard-timeout и телеметрией.** `call()` пробует провайдеров по уровням с `Promise.race` (30 с), на каждый исход пишет `AiUsageLog` и классифицирует причину фолбэка. [backend/src/modules/ai/services/llm-router.service.ts:1305](backend/src/modules/ai/services/llm-router.service.ts#L1305)

---

## 4. Находки по областям

Обозначения вердикта верификации: **[confirmed]** — подтверждено чтением кода; **[partially]** — суть верна, но детали/ссылки/severity неточны; **[refuted]** — проверено, не подтвердилось (в приложении); **[unverified]** — требует проверки (в приложении).

### 4.1 Архитектура backend

Структура NestJS зрелая и единообразная, циклов почти нет. Главные риски — опора на `@Global` (неявный граф зависимостей), мегамодуль `knowledge-core`, и расхождение документации с фактической in-process моделью воркеров.

| ID | severity | категория | суть | ссылка |
|---|---|---|---|---|
| arch-01 | high [confirmed] | scalability | Воркеры и ~160 @Cron в одном процессе с HTTP, без leader-election | [app.module.ts:337](backend/src/app.module.ts#L337) |
| arch-02 | medium [partially] | ops | ANTHROPIC_API_KEY required, блокирует старт, хотя «не используем» | [env.schema.ts:103](backend/src/common/config/env.schema.ts#L103) |
| arch-03 | high [partially] | maintainability | knowledge-core — мегамодуль (~62 провайдера, 54 экспорта, fan-in 18) | [knowledge-core.module.ts:251](backend/src/modules/knowledge-core/knowledge-core.module.ts#L251) |
| arch-04 | medium [confirmed] | maintainability | 42 @Global делают DI-граф неявным, границы не enforce-ятся | [dashboard.module.ts:56](backend/src/modules/dashboard/dashboard.module.ts#L56) |
| arch-05 | medium [partially] | maintainability | Параллельные семейства: chat/chat-v2, три role-модуля | [chat.module.ts:19](backend/src/modules/chat/chat.module.ts#L19) |
| arch-06 | medium [partially] | maintainability | Дрейф доков: «45 модулей / 1.7k схема» против 97 / 10.2k | [CLAUDE.md:81](CLAUDE.md#L81) |
| arch-07 | medium [unverified] | maintainability | Регистрация воркеров в ai/workers.module.ts тянет 6 чужих доменов | [workers.module.ts:11](backend/src/modules/ai/workers.module.ts#L11) |
| arch-08 | medium [unverified] | maintainability | 574 файла инжектят PrismaService напрямую, репозиториев 16 | — |
| arch-09 | low [unverified] | security | bcrypt + argon2 сосуществуют без стратегии завершения миграции | — |
| arch-10 | low [unverified] | observability | BusinessMetricsService — 7k строк / 394 метрики / 357 потребителей | [business-metrics.service.ts:47](backend/src/common/metrics/business-metrics.service.ts#L47) |

**arch-01 — Воркеры и ~160 @Cron в одном процессе с HTTP [confirmed, high].** `AppModule` импортирует `WorkersModule` прямо в HTTP-приложение ([app.module.ts:340](backend/src/app.module.ts#L340)), `ScheduleModule.forRoot()` поднимается безусловно ([app.module.ts:146](backend/src/app.module.ts#L146)). Файла `src/workers/main.ts` и скрипта `worker:dev` не существует. Воркеры создаются сырым `new Worker()` в `onModuleInit`. Leader-election не найден (grep по leader/isLeader/cronLock — 0). Следствие: (1) CPU-bound AI-конвейер и ffmpeg делят event loop с HTTP; (2) при N репликах каждая поднимет свой набор ~160 @Cron — двойные дайджесты/снимки/выплаты, гонки графа. **Рекомендация:** ввести ENV `ROLE=api|worker` (ScheduleModule + воркеры только в worker-роли); до разделения — Redis `SET NX PX` как единый cron-lock в `CronManagerService.runWrapped` для ВСЕХ кронов по умолчанию + гард в CI/compose против `scale>1`.

**arch-03 — knowledge-core мегамодуль [partially, high].** Единый `@Global`-модуль с одним DI-контейнером: ~62 провайдера, 54 экспорта, 57 сервис-классов, 48 воркеров, fan-in из 18 модулей (числа находки `106/92/52/29` завышены — посчитаны с учётом spec-файлов и импорт-сайтов). Самопризнанный долг подтверждён комментарием в коде: «Добавлено в конец providers, чтобы минимизировать конфликт» ([knowledge-core.module.ts:208](backend/src/modules/knowledge-core/knowledge-core.module.ts#L208)). Любая правка ядра рискует затронуть половину продукта; изолированное тестирование невозможно. **Рекомендация:** разбить на под-модули по доменам (ingest/extraction, graph, clustering, specialists, temporal, personas, skills) с узкими exports + единый `KnowledgeCoreFacade` для внешних потребителей.

**arch-04 — 42 @Global делают DI-граф неявным [confirmed, medium].** Треть модулей помечена `@Global()`; реальные зависимости не выражены в `imports`. Пример: `dashboard.module.ts` импортирует только `[PrismaModule, OperationsModule]`, но `director-dashboard.service.ts` инжектит `AdminCacheService` (admin) и `LlmRouterService` (ai) — обе невидимы в графе. Невозможно автоматически проверить «модуль X не должен знать про Y». **Рекомендация:** сократить `@Global` до инфраструктурных (Prisma/Redis/Config/Metrics/Crypto/Auth/Rbac); доменные модули объявлять явно; добавить dependency-cruiser/eslint-boundaries.

**arch-02 — ANTHROPIC_API_KEY блокирует старт [partially, medium↓].** `ANTHROPIC_API_KEY: z.string().min(1)` без `.optional()`, безусловно мержится в `EnvSchema`, валидируется первым при bootstrap — без ключа backend не стартует. Противоречит памяти команды «Anthropic не используем». Severity снижена high→medium: провал — громкий fail-fast с читаемым сообщением (перечисляет недостающий ключ), а не тихая рантайм-ловушка. **Рекомендация:** `.optional()` + ленивая проверка при первом dispatch к провайдеру; синхронизировать память/CLAUDE.md.

### 4.2 Модель данных

Схема — единый файл ~10 254 строки. Tenancy дисциплинированная, идемпотентность встроена в точки приёма, bi-temporal моделирование осознанное. Слабые места — `db push` без миграций, осиротевшие S3-объекты при каскадном удалении, отсутствие партиционирования телеметрии, денормализованные `String[]`-массивы FK.

| ID | severity | категория | суть | ссылка |
|---|---|---|---|---|
| dm-01 | high [confirmed] | data-integrity | db push --accept-data-loss без диффа/отката, дрейф схемы | [apply-prod-deploy.ts:469](backend/scripts/apply-prod-deploy.ts#L469) |
| dm-02 | medium [partially] | data-integrity | Каскад не чистит S3-объекты (hardDeleteMeetings без сбора ключей) | [retention-extras.cron.ts:135](backend/src/modules/retention/retention-extras.cron.ts#L135) |
| dm-03 | medium [partially] | scalability | Append-only/snapshot-таблицы без партиционирования | [schema.prisma:10191](backend/prisma/schema.prisma#L10191) |
| dm-04 | medium [partially] | data-integrity | String[]-массивы FK вместо join-таблиц, нет целостности | [schema.prisma:5548](backend/prisma/schema.prisma#L5548) |
| dm-05 | medium [partially] | data-integrity | EntityLink — полиморфные рёбра без FK на узлы | [schema.prisma:3719](backend/prisma/schema.prisma#L3719) |
| dm-06 | medium [partially] | maintainability | 124 enum при параллельных status-полях-строках без CHECK | [schema.prisma:1126](backend/prisma/schema.prisma#L1126) |
| dm-07 | low [unverified] | maintainability | Гигантские User/Org/Meeting с 60-90 обратными relation | — |
| dm-08 | medium [unverified] | correctness | @@unique([email,signupSource]) блокирует повторную регистрацию soft-deleted | — |
| dm-09 | low [unverified] | data-integrity | 118 Json-колонок без схемной валидации | — |
| dm-10 | low [unverified] | security | MeetingTranscriptChunk без tenantId — изоляция только через join | [schema.prisma:1694](backend/prisma/schema.prisma#L1694) |

**dm-01 — db push --accept-data-loss без диффа и отката [confirmed, high].** Источник правды о структуре БД — единственный `schema.prisma`, применяемый `prisma db push --accept-data-loss` (флаг хардкожен) на каждом штатном выкате. Три структурные слабости: (1) нет диффа — оператор не видит, что дропнется; (2) нет версионированной DDL-истории и отката кроме restore всего дампа; (3) дрейф — объекты вне `schema.prisma` (HNSW/GIN/extension/AGE из `postgres-init.sql`) Prisma не знает. Дамп пишется в docker-volume на той же ноде. **Рекомендация:** перед прод-push прогонять `prisma migrate diff` и сохранять SQL-дифф как артефакт ревью; детектор деструктивных операций (DROP COLUMN/TABLE/TYPE) с фейлом-по-умолчанию, требующим явного `ZSCHEMA_ALLOW_DESTRUCTIVE=true`.

**dm-02 — каскад не чистит S3-объекты [partially, medium].** Демонстрируемый активный gap: `RetentionExtrasCron.hardDeleteMeetings` делает `meeting.deleteMany` без сбора S3-ключей — каскад убивает строки `Recording`+`AudioTrack`, а объекты `mainVideoUrl`/`audioUrl` остаются сиротами в бакете. Аналогично каскад `Issue→IssueAttachment` и `Org→Table(coverImageS3)`. Orphan-reconcile воркера нет (хотя комментарии в коде его обещают). Важная поправка к находке: hard-delete Org пока не существует (только soft-delete), а основная масса записей чистится recording-retention по `expiresAt` корректно — поэтому severity high→medium. **Рекомендация:** pre-delete сбор S3-ключей в `hardDeleteMeetings`/удалении Issue/Table + периодический reconcile-воркер «объект без строки → удалить».

**dm-03 — телеметрия без партиционирования [partially, medium].** `SystemLog` (11 индексов), `AiUsageLog`, `IssueActivity`, `IssueVersion`, десятки `*Snapshot` растут линейно без партиций. `AiUsageLog` без retention вовсе. Поправка: у `SystemLog` retention ЕСТЬ (`LogCleanupService` раз в час, advisory-lock, батчи по 5000) — но он DELETE-based без партиций, что и есть проблема при бэклоге. Severity high→medium (отложенный scalability-долг). **Рекомендация:** range-партиционирование по `createdAt` (DROP PARTITION вместо DELETE) для горячих таблиц; retention для `AiUsageLog`.

**dm-05 — EntityLink без FK на узлы [partially, medium].** `EntityLink` — таблица рёбер всего графа Z. FK на узлы убраны (рёбра ссылаются полиморфно на Entity/Role/Person/Process/Document по `fromType/toType`). Чистка рёбер при удалении узла идёт только через `GraphService.removeNode`; удаление мимо этого пути (прямой SQL, баг) оставляет висячие рёбра, попадающие в retrieval и AI-чат. Каскад `Org` спасает на уровне всего тенанта (FK `tenantId`), но не на уровне отдельного узла. Integrity-воркера dangling-рёбер нет. **Рекомендация:** периодический integrity-воркер, помечающий рёбра с несуществующими узлами `deletedAt`.

### 4.3 knowledge-core

Конвейер устроен аккуратно: детерминированная идемпотентность, статусные guard'ы шагов, защита графа от LLM-галлюцинаций, многоуровневый дешёвый резолв сущностей, полный набор HNSW-индексов. Системные дефекты — гонка дубликатов Entity, смешение векторных пространств при фолбэке, синхронные per-block LLM-вызовы, O(N²) кластеризация.

| ID | severity | категория | суть | ссылка |
|---|---|---|---|---|
| kc-01 | critical [refuted] | data-integrity | 13 специалистов на одной очереди крадут чужие jobs | (исправлено, см. приложение) |
| kc-02 | high [confirmed] | data-integrity | Дубликаты Entity: нет unique на lower(canonicalName), резолв вне tx | [entity-resolution.service.ts:280](backend/src/modules/knowledge-core/services/entity-resolution.service.ts#L280) |
| kc-03 | high [confirmed] | correctness | Смешение векторных пространств при fallback на local-embedding | [embedding-fallback.service.ts:35](backend/src/modules/embeddings/services/embedding-fallback.service.ts#L35) |
| kc-04 | low [refuted] | data-integrity | Переполнение Decimal(4,3) / evidenceCount-дрейф | (опровергнуто, см. приложение) |
| kc-05 | medium [partially] | scalability | Синхронные per-block LLM (axis-classify) в ingest, нет backpressure | [block-ingest.worker.ts:688](backend/src/modules/knowledge-core/workers/block-ingest.worker.ts#L688) |
| kc-06 | medium [confirmed] | scalability | Theme-clustering O(N²) в памяти, cap 1000 блоков/Org/час | [theme-clusterer.cron.ts:40](backend/src/modules/knowledge-core/workers/theme-clusterer.cron.ts#L40) |
| kc-07 | medium [partially] | ops | Soft-deleted Org даёт бесконечные failed-jobs (gate throw вместо skip) | [worker-org-gate.ts:57](backend/src/modules/core-queue/worker-org-gate.ts#L57) |
| kc-08 | low [partially] | correctness | AGE-Cypher через интерполяцию; parseAgtype глотает ошибки | [graph.service.ts:750](backend/src/common/graph/graph.service.ts#L750) |
| kc-09 | medium [unverified] | scalability | Дедуп группы Б через findMany всех строк тенанта в память | — |
| kc-10 | medium [unverified] | correctness | HNSW + селективные post-фильтры — риск падения recall дедупа | — |
| kc-11 | low [unverified] | maintainability | Незакрытые TODO в горячем pipeline (LLM-arbiter, лемматизация) | — |

**kc-02 — дубликаты Entity [confirmed, high].** `findOrCreateEntity` при cache-miss делает `findExactByLowerName` + `create` вне транзакции при `concurrency=2`. На `Entity` нет unique-индекса по `(tenantId, type, lower(canonicalName))` — только non-unique `@@index`; схема прямо говорит «уникальность через приложение». `linkEntity` вызывается вне транзакции IdeaBlock. Два параллельных блока одной встречи с упоминанием «Маша» при холодном Redis-cache создают две Entity. Async entity-resolver merge негарантирован (порог, LLM-вердикт, вектор может быть не проставлен). Дубль расщепляет граф (`mentionsCount` размазан). Доп.: `LOWER()` в `findExactByLowerName` не использует btree-индекс на `canonicalName` → seq-scan. **Рекомендация:** partial unique на `lower(canonicalName)` в `(tenantId, type, mergedIntoId IS NULL)` + обработка `P2002` как гонки; функциональный индекс на `lower(canonicalName)`.

**kc-03 — смешение векторных пространств [confirmed, high].** `EmbeddingFallbackService` при сбое proxy молча переключается на local endpoint с тем же `model name`, но другой реализацией; нет проверки совместимости пространства/нормы и нет тега провайдера у вектора. Векторы пишутся в общую `vector(1536)` и сравниваются cosine в трёх KNN-потоках (block-merge, entity-resolution, clustering). За время инцидента часть векторов получит иное/ненормированное пространство → cosine-сравнения становятся шумом (ложные merge/distinct), смешанный индекс не откатывается без полного пересчёта. **Рекомендация:** гарантировать, что local-fallback — та же модель/пространство, ИЛИ помечать `embedding=null` + retry позже; хранить provider/model+dim рядом с вектором; размерная проверка перед записью.

**kc-06 — theme-clustering O(N²) [confirmed, medium↓].** `ThemeClustererCron` раз в час грузит до `MAX_BLOCKS_PER_ORG=1000` canonical-блоков без темы (`ORDER BY createdAt ASC LIMIT 1000`) и гоняет попарный O(N²) cosine на 1536-мерных векторах в Node-памяти. Два следствия: при притоке >1000 новых блоков/час окно никогда не догонит (residue+new накапливается); проход по Org последовательный. Комментарий в коде честно признаёт «на больших Org заменить на pgvector-side». Severity high→medium: материализуется только на >1000 блоков/час/Org — на порядки выше MVP-границ. **Рекомендация:** pgvector-side инкрементальное назначение тем (KNN к `Theme.embedding`); фан-аут по Org в очередь.

**kc-05 — синхронные per-block LLM в ingest [partially, medium↓].** Поправка к находке: `RouterService.dispatch` из block-ingest УЖЕ убран (вынесен в debounced block-distill — комментарий «Ф3 МТЗ ... ОТСЮДА УБРАН»). Остаётся один per-block синхронный LLM — `axisClassifier.classify` (`AXIS_CLASSIFY_ENABLED` дефолт true), который при `concurrency=2` на встрече 50-100 блоков держит слоты минутами. Backpressure/лимита глубины очереди raw-events нет. Severity high→medium (вдвое меньше нагрузки, чем заявлено; не критично на MVP). **Рекомендация:** вынести axis-classify в отдельный debounced-job; параметризовать concurrency; backpressure на producer.

### 4.4 AI / LLM

Слой построен вокруг `LlmRouterService` с tier-fallback, фильтром по `dataClass`, prompt-кэшированием и пост-фактум учётом стоимости. Главные риски — единый домен инфраструктуры (SPOF), отсутствие enforce бюджета, нарушение data-governance у ollama, тихий `costUsd=0`.

| ID | severity | категория | суть | ссылка |
|---|---|---|---|---|
| llm-01 | critical [partially] | scalability | *.agent-lia.ru — SPOF для secondary+tertiary LLM, ASR, embeddings | [env.schema.ts:106](backend/src/common/config/env.schema.ts#L106) |
| llm-02 | high [confirmed] | cost | Нет pre-call бюджетного предохранителя, расход не блокируется | [llm-router.service.ts:1243](backend/src/modules/ai/services/llm-router.service.ts#L1243) |
| llm-03 | high [confirmed] | data-integrity | ollama localOnly/maxDataClass=private, но ходит на удалённый хост | [llm-router.service.ts:740](backend/src/modules/ai/services/llm-router.service.ts#L740) |
| llm-04 | medium [confirmed] | ops | 4 required-ключа провайдеров, которых нет в дефолтных цепочках | [env.schema.ts:103](backend/src/common/config/env.schema.ts#L103) |
| llm-05 | high [confirmed] | cost | Тихий costUsd=0 для моделей вне прайс-карты искажает биллинг | [model-prices.ts:78](backend/src/modules/ai/services/model-prices.ts#L78) |
| llm-06 | medium [confirmed] | correctness | A/B-роутинг через Date.now()/Math.random — нет стабильного назначения | [llm-router.service.ts:1184](backend/src/modules/ai/services/llm-router.service.ts#L1184) |
| llm-07 | medium [confirmed] | correctness | dataClass-фильтр ПОСЛЕ выбора A/B — sensitive падает без fallback | [llm-router.service.ts:1274](backend/src/modules/ai/services/llm-router.service.ts#L1274) |
| llm-08 | medium [partially] | scalability | Vox/GigaAM — единственный ASR без независимого fallback | [vox.service.ts:72](backend/src/modules/ai/services/vox.service.ts#L72) |
| llm-09 | medium [unverified] | security | PROXY_PREFIX как auth-секрет с дефолтом в коде | [env.schema.ts:163](backend/src/common/config/env.schema.ts#L163) |
| llm-10 | low [unverified] | observability | Синхронный emit ai.invocation.completed с полным промптом в hot-path | — |
| llm-11 | low [unverified] | maintainability | Мёртвый код ensureJsonWord в DeepSeekService | — |
| llm-12 | low [unverified] | correctness | OpenAI-proxy всегда strict:false для caller-tools | — |

**llm-01 — единый домен *.agent-lia.ru [partially, critical].** Декларируется 3-tier LLM-resilience, но tier'ы не независимы по инфраструктуре: secondary (`proxy.agent-lia.ru`), tertiary (`ollama.agent-lia.ru`), ASR (`vox.agent-lia.ru`), embeddings (`proxy.agent-lia.ru/embeddings`), опц. Anthropic-proxy — ВСЕ на одном домене. При его отказе одновременно теряются 2 из 3 LLM-уровней, вся транскрибация и вся векторизация; остаётся только `deepseek` (api.deepseek.com), а для `clip-title`/`theme-classify`/`meeting-quality-score` (primary=openai-via-proxy) — полный отказ. Local-fallback эмбеддингов в дефолте не сконфигурирован (`EMBEDDING_FALLBACK_LOCAL_URL` optional без default — бросает `LocalEmbeddingNotConfiguredError`). Поправка: 3 из 5 ENV-ссылок смещены на 2 строки, но значения и суть верны. **Рекомендация:** развести tier'ы по независимым апстримам (прямой `api.openai.com`/MiniMax вне agent-lia.ru как secondary); fallback-ASR на независимой инфраструктуре; health-probe + алерт; задокументировать blast-radius.

**llm-02 — нет pre-call бюджетного предохранителя [confirmed, high].** `BudgetAlertCron` (раз в 2 ч) считает MTD-cost и только шлёт уведомление при 80/100%. `LlmRouter.call()` нигде не проверяет `OrgBudgetCap` перед dispatch; `costUsd` пишется пост-фактум. Поле `capKind ('soft'|'hard')` заложено в схему, но НИГДЕ не используется как блокирующий гейт. Один взбесившийся воркер (re-enqueue, debate-цикл, аномальный транскрипт) намолотит расход кратно лимита, обнаружение — через 2 часа и без остановки. **Рекомендация:** hard-cap kill-switch: при utilization≥N% `call()` для не-критичных taskType бросает `BudgetExceededError` либо переключает на cheap-tier; MTD-cost инкрементить в Redis (O(1) гейт без скана).

**llm-03 — ollama localOnly, но удалённый [confirmed, high].** `PROVIDER_CAPABILITY.ollama = { maxDataClass: 'private', localOnly: true }` — роутер допускает к ollama самые чувствительные private-данные. Но `OLLAMA_BASE_URL` по умолчанию = `https://ollama.agent-lia.ru/v1` — удалённый сторонний хост. Поле `localOnly` объявлено, но НИГДЕ не читается. Docstring прямо лжёт: «localOnly — провайдер живёт локально (никогда не уходит наружу)». Private-данные уходят на внешний хост под ложной гарантией локальности. **Рекомендация:** понизить `ollama.maxDataClass` до `internal`, пока ollama не self-hosted в периметре; вынести карту в config-driven с валидацией loopback.

**llm-05 — тихий costUsd=0 [confirmed, high].** `calcCostUsd` возвращает 0 для моделей вне `MODEL_PRICES` (в карте уже есть нулевые записи: MiniMax-M2.7, gemini-3-flash, gpt-5-4). На полном промахе — только `logger.debug` и возврат 0; нет метрики, нет алерта. Поскольку `OrgEconomicsCron`/`BudgetAlertCron` суммируют `costUsd` из БД, заниженный/нулевой трафик не учитывается в бюджете — алерт о превышении не срабатывает. Доп.: промо-цена `deepseek-v4-pro` истекла 31.05.2026 (комментарий в коде просит обновить 1.74→6.96, ровно 4×). **Рекомендация:** при price-miss писать sentinel + метрику `llm_price_missing_total` + алерт; тест/линт: запрет model в `LlmTaskRoute` без записи в `LlmModelPrice`/`MODEL_PRICES`.

**llm-04 — 4 required-ключа неиспользуемых провайдеров [confirmed, medium].** `ANTHROPIC/MINIMAX/GRSAI/KIE_API_KEY` заданы `z.string().min(1)`, смержены в `EnvSchema` — без них backend не стартует, хотя ни один не в дефолтных цепочках (`seed-llm-task-routes-default.ts`: комментарий «Anthropic в дефолтных цепочках НЕ присутствует»). Латентная ловушка фиктивного ключа (проходит `min(1)`, но падает при реальном выборе провайдера). Severity high→medium: happy-path не ломается, прод уже работает с плейсхолдерами. **Рекомендация:** `.optional()` + ленивая проверка наличия ключа в момент dispatch.

### 4.5 Воркеры, очереди, кроны

Идемпотентность джоб через детерминированные jobId — сильная сторона. Управляемые расписания из админки + история запусков. Главные риски — один процесс под всё, отсутствие распределённой блокировки на большинстве кронов, неограниченный рост failed-jobs, мёртвый алертинг.

| ID | severity | категория | суть | ссылка |
|---|---|---|---|---|
| wq-01 | medium [partially] | scalability | ~97/106 крон-файлов без distributed-lock → дубли при >1 реплике | [cron-manager.service.ts:631](backend/src/modules/admin/crons/cron-manager.service.ts#L631) |
| wq-02 | medium [partially] | scalability | Cron-стампед: 16× «0 * * * *», 12× «0 4», без джиттера | [strategic-alignment.cron.ts:30](backend/src/modules/knowledge-core/workers/strategic-alignment.cron.ts#L30) |
| wq-03 | high [confirmed] | ops | removeOnFail:false на ai.*/core.* без авто-очистки — рост Redis | [ai/queues.ts:71](backend/src/modules/ai/queues.ts#L71) |
| wq-04 | high [confirmed] | observability | Нет алертинга на failed-jobs/cron; правила инцидентов — in-memory stub | [admin-incidents.service.ts:26](backend/src/modules/admin/incidents/admin-incidents.service.ts#L26) |
| wq-05 | medium [partially] | observability | Админ-панель видит 3 из ~15 семейств очередей | [workers-admin.service.ts:60](backend/src/modules/admin/platform/workers/workers-admin.service.ts#L60) |
| wq-06 | medium [confirmed] | scalability | ffmpeg-воркеры грузят весь MP4 двумя буферами в heap HTTP-процесса | [faststart.worker.ts:125](backend/src/modules/recordings/workers/faststart.worker.ts#L125) |
| wq-07 | medium [confirmed] | ops | Graceful shutdown без stop_grace_period — длинные jobs убиваются SIGKILL | [main.ts:157](backend/src/main.ts#L157) |
| wq-08 | medium [unverified] | scalability | >100 worker-слотов на единый неконфигурируемый Prisma-пул | — |
| wq-09 | medium [unverified] | correctness | Sweep-cron take:500 без пагинации — хвост профилей не обрабатывается | — |
| wq-10 | medium [unverified] | maintainability | Доки массово утверждают «отдельный worker-процесс» | — |
| wq-11 | low [unverified] | scalability | ~50+ блокирующих Redis-соединений из одного процесса | — |
| wq-12 | medium [unverified] | cost | AnalyzeWorker — каскад стадий без общего LLM-семафора | — |

**wq-03 — removeOnFail:false на ядре [confirmed, high].** `DEFAULT_JOB_OPTIONS` для `ai.*` и `core.*` задают `removeOnFail:false` — провалившиеся после `attempts:5` джобы остаются в Redis навсегда с полным payload+stacktrace. Авто-очистки нет (grep по `.clean()`/`obliterate` — 0). Соседние очереди (tracker/conversational/exports/webhooks-out) уже на `{age,count}` — паттерн осознан, но ядро не мигрировано. Redis in-memory и критичен (BullMQ + idempotency + cache + quota); при стабильном проценте провалов LLM/ASR failed-набор растёт линейно → OOM всего pipeline. **Рекомендация:** `{age:N дней, count:M}` во всех ai.*/core.*/dashboard/feedback очередях либо ночной cron `queue.clean('failed')`.

**wq-04 — нет алертинга на failed-jobs/cron [confirmed, high].** `AdminIncidentsService` помечен `mvpInactive:true` и хранит правила только в `Map` процесса — никакой cron не проверяет условия. Упавший cron (`CronRunHistory.status='failed'`) и накапливающиеся failed-jobs не отслеживаются автоматически. Алерт `BullMqFailedJobsHigh` завязан на метрику `bullmq_failed`, которую backend НИГДЕ не эмитит (мёртвый алерт). Для платформы с money-cron (`tochka-recurring-charge`) молчаливый отказ обнаружится по жалобе клиента. **Рекомендация:** реальный cron-чекер: опрашивать `counts.failed` по ВСЕМ очередям + `CronRunHistory.status='failed'`, эмитить Prometheus-gauge + алерт в Grafana/Alertmanager.

**wq-06 — ffmpeg грузит весь MP4 в heap [confirmed, medium].** `FaststartWorker`/`ClipRenderWorker` качают `s3.getObject(key)` → Buffer, пишут на диск, читают результат → Buffer, заливают `putObject(Buffer)`. Для гигабайтного composite в heap одновременно ДВА полных буфера; собственный докстринг файла: 383 МБ на 17-мин встрече, «гигабайты на 1-2 ч». Воркеры in-process с HTTP → OOM/GC-stalls кладут заодно API. `FaststartWorker` гейтится `RECORDING_FASTSTART_ENABLED` (дефолт OFF), но `ClipRenderWorker` нет. **Рекомендация:** стримить S3↔ffmpeg↔S3 без полного буфера; вынести CPU/IO-воркеры в отдельный процесс.

**wq-01 — кроны без distributed-lock [partially, medium↓].** Distributed-lock есть лишь у 13 из ~106 крон-файлов; `runWrapped` лока не берёт. При `scale>1` незащищённые кроны выполнятся N раз. Поправка: значительная часть кронов (включая дорогие графовые/AI) уже защищена `SET NX EX`, а из «реальных дублей» подтверждён только `operations-daily-digest`/`manager-digest` (recognition-weekly и feed-digest — ложные примеры: первый дедуплицируется по jobId, второй — TODO без доставки). Деплой документированно single-replica. Severity high→medium (дремлющий риск). **Рекомендация:** единый cron-lock wrapper в `runWrapped` + гард против `scale>1`.

### 4.6 Мультитенантность и безопасность

Двухслойная изоляция (`TenantGuard` проверяет реальный Membership + ручной `where{tenantId}` в сервисах). RBAC default-deny с super_admin-bypass. Гость получает только LiveKit-JWT, не секрет. Главный риск — отсутствие машинного гаранта изоляции.

| ID | severity | категория | суть | ссылка |
|---|---|---|---|---|
| sec-01 | high [confirmed] | security | Cookie+Tenant guard не глобальные, ~194 контроллера вручную | [app.module.ts:626](backend/src/app.module.ts#L626) |
| sec-02 | high [confirmed] | security | Нет ротации ключа шифрования, CRYPTO_MASTER_KEY default('') | [crypto.service.ts:34](backend/src/common/crypto/crypto.service.ts#L34) |
| sec-03 | high [confirmed] | security | SSRF-guard уязвим к DNS-rebinding (fetch на hostname, не на IP) | [webhook-delivery.worker.ts:119](backend/src/modules/webhooks-out/webhook-delivery.worker.ts#L119) |
| sec-04 | medium [partially] | security | Нет trust proxy — req.ip недостоверен в аудите/сессиях | [main.ts:52](backend/src/main.ts#L52) |
| sec-05 | low [partially] | security | ThrottlerModule in-memory + @Throttle без guard = троттлинг выключен | [app.module.ts:159](backend/src/app.module.ts#L159) |
| sec-06 | medium [confirmed] | security | 60-сек кэш membership отдаёт доступ после отзыва прав | [rbac.service.ts:414](backend/src/modules/rbac/rbac.service.ts#L414) |
| sec-07 | medium [unverified] | correctness | RBAC owner-проверка зависит от caller — нет принуждения движком | — |
| sec-08 | low [unverified] | maintainability | Дрейф доков про Anthropic SDK и масштаб | — |
| sec-09 | low [unverified] | product | switch-org возвращает success без смены контекста сессии | — |

**sec-01 — Cookie+Tenant не глобальные [confirmed, high].** Глобально зарегистрированы только Subscription/Entitlement/MustChangePassword/DemoObserver guards. `CookieAuthGuard` и `TenantGuard` применяются вручную через `@UseGuards` на ~194 контроллерах; машинного гаранта (lint/архитектурный тест) нет. Забытый декоратор на новом контроллере = анонимный доступ или cross-tenant утечка. `DemoObserverGuard` при отсутствии tenantId/membership молча пропускает, полагаясь на TenantGuard ниже. По мере роста команды и модулей вероятность пропуска стремится к 1, цена — раскрытие чужой памяти компании. **Рекомендация:** инвертировать на безопасный дефолт — Cookie+Tenant в `APP_GUARD` с opt-out `@Public`; архитектурный тест через `DiscoveryService`, падающий при `@Controller` без guard/маркера.

**sec-02 — нет ротации ключа шифрования [confirmed, high].** `CryptoService` шифрует все секреты источников (Telegram botToken, Mango, IMAP-пароли) на одном `CRYPTO_MASTER_KEY`. Формат `gcm:v1:iv:tag:ct` не содержит key-id → ротация невозможна без сплошной перешифровки (механизма backfill нет). `CRYPTO_MASTER_KEY` имеет `.default('')` — приложение стартует без ключа и падает лениво при первой операции. Непоследовательность: соседний `WEBHOOK_SECRETS_ENCRYPTION_KEY` сделан правильно (`.min(1).refine`). **Рекомендация:** key-id (`gcm:v2:<kid>`) + реестр ключей + backfill; в prod `CRYPTO_MASTER_KEY` обязателен через `refine` по `NODE_ENV` (fail-fast).

**sec-03 — SSRF-guard и DNS-rebinding [confirmed, high].** `assertSafeOutboundUrl` резолвит DNS и проверяет IP, но возвращает URL с hostname, а воркеры делают обычный `fetch(url)` — проверенный IP игнорируется (подтверждено в webhook-delivery, slack-sender, generic-sender). Окно TOCTOU: владелец Org регистрирует домен, который при проверке резолвится в публичный IP, а при доставке — в `169.254.169.254`/`10.x` → доступ к cloud-metadata из доверенной сети воркера. Атака требует роли владельца Org (легитимная self-service операция). **Рекомендация:** коннектиться по проверенному IP с сохранением Host/SNI (custom agent / undici lookup-callback с ревалидацией).

**sec-06 — 60-сек кэш membership [confirmed, medium].** `RbacService.loadContext` кэширует роль/visibility/isSuperAdmin на 60 с per-instance, без распределённой инвалидации. При удалении из Org/понижении роли старые права действуют до минуты. Найден реальный пропуск `invalidate`: `subscription-activated.listener.ts` делает `membership.deleteMany` без вызова `rbac.invalidate` — read-only роль demo_observer живёт до 60 с. **Рекомендация:** снизить TTL для security-полей либо Redis pub/sub при любой смене membership/роли; тест на вызов `invalidate` во всех мутациях.

**sec-04 — нет trust proxy [partially, medium].** `app.set('trust proxy')` не вызывается; backend за nginx → `req.ip` = IP прокси, пишется недостоверно в `UserSession.ip` и audit. Поправка: обоснование через throttler некорректно — `ThrottlerGuard` вообще не зарегистрирован глобально, а `@Throttle` на auth-роутах без `@UseGuards(ThrottlerGuard)` инертен (троттлинг де-факто выключен — это отдельный, более серьёзный gap, см. sec-05). **Рекомендация:** `app.set('trust proxy', <число хопов/подсеть nginx>)` точным значением (не `true`).

### 4.7 Frontend

Слой данных аккуратно расслоён, нет сырых fetch мимо apiClient в компонентах, чистая миграция URL админки, образцовая обработка UX встречи. Риски — fail-open edge-гейтинг, кэш SWR без orgId, отсутствие error-границ, английский в UI.

| ID | severity | категория | суть | ссылка |
|---|---|---|---|---|
| fe-01 | high [confirmed] | security | Edge-гейт proxy.ts покрывает 6 из ~50 сегментов (authenticated) | [proxy.ts:60](frontend/proxy.ts#L60) |
| fe-02 | low [partially] | security | (design-preview) публична в проде (/leak-v1, /charts) | [proxy.ts:29](frontend/proxy.ts#L29) |
| fe-03 | low [partially] | correctness | SSE concierge/orchestrator без X-Org-Id и шины auth:expired | [concierge.api.ts:110](frontend/src/api/concierge.api.ts#L110) |
| fe-04 | medium [partially] | data-integrity | Массивные SWR-ключи без orgId не сбрасываются при смене Org | [OrgSwitcher.tsx:164](frontend/src/ui/components/app-shell/OrgSwitcher.tsx#L164) |
| fe-05 | medium [confirmed] | ops | Нет error.tsx/loading.tsx/not-found.tsx на 262 роута | [app/layout.tsx](frontend/app/layout.tsx) |
| fe-06 | medium [unverified] | product | Английские слова в UI-строках (ru.ts) | — |
| fe-07 | medium [unverified] | security | Org-admin-функции в super_admin-группе (admin) | — |
| fe-08 | low [unverified] | correctness | Гонка инициализации defaultOrgId — первые SWR без X-Org-Id | — |
| fe-09 | low [unverified] | scalability | Минимальное code-splitting (~2 next/dynamic на 317 компонентов) | — |
| fe-10 | low [unverified] | maintainability | README/комментарии противоречат модели гейтинга | — |

**fe-01 — edge-гейт покрывает 6 из ~50 сегментов [confirmed, high].** `proxy.ts` защищает только хардкод-список из 6 префиксов (`/dashboard`, `/meetings`, `/tasks`, `/settings`, `/integrations`, `/invitations`) + `/admin`. Остальные 44 сегмента `(authenticated)` (`/clones`, `/goals`, `/chat`, `/projects`, `/persons`, `/roles` и др.) падают в `NextResponse.next()` без проверки cookie на edge. Защита держится только на клиентском `AuthenticatedShell` (редирект после загрузки JS-бандла). Не утечка данных (API защищён RBAC), но: мигание приватного UI неавторизованным; новый раздел по умолчанию НЕ защищён на edge. **Рекомендация:** инвертировать — `if (!isPublic(pathname)) require cookie`, тогда новый authenticated-роут защищён автоматически.

**fe-04 — SWR-ключи без orgId [partially, medium↓].** `OrgSwitcher` сбрасывает только строковые ключи `key.startsWith('/api/v1/')`; массивные ключи `['card', id]`, `['theme', id]`, `['referrals-me']` переживают смену Org и могут кратковременно показать закэшированные данные до ревалидации. Поправка: серверной cross-tenant утечки НЕТ (themes имеют tenant-fence, cards — user-scoped по ownerId, referrals — персональны; ID глобально уникальны cuid). Реальный эффект — показ собственных недавно увиденных данных по тому же resource ID. Severity high→medium. **Рекомендация:** orgId первым элементом всех массивных ключей + расширить фильтр `mutate` на массивные ключи.

**fe-05 — нет error/not-found границ [confirmed, medium].** На 267 page.tsx нет ни одного `error.tsx`/`loading.tsx`/`not-found.tsx`/`global-error.tsx`, нет ручного ErrorBoundary. Непойманный throw в RSC/клиентском рендере или 404 показывает дефолтный англоязычный экран Next без брендинга и recovery — нарушает правило «UI только на русском». **Рекомендация:** корневой `global-error.tsx` + per-group `error.tsx`/`not-found.tsx` на русском с recovery-действиями.

### 4.8 Инфра, деплой, ops

Деплой реально автоматизирован одной командой с продуманной семантикой отказов и обязательным бэкапом. Медиа-стек отделён. Грамотный multi-stage Dockerfile под непривилегированным пользователем, split liveness/readiness. Риски — один процесс под всё, `db push` на каждом выкате, отсутствие CI/IaC, открытый /metrics.

| ID | severity | категория | суть | ссылка |
|---|---|---|---|---|
| ops-01 | high [confirmed] | scalability | Весь backend + кроны + воркеры в одном процессе; доки лгут | [Dockerfile:6](backend/Dockerfile#L6) |
| ops-02 | high [confirmed] | data-integrity | db push --accept-data-loss на каждом деплое | [docker-compose.yml:106](docker-compose.yml#L106) |
| ops-03 | low [refuted] | data-integrity | «Единственная копия БД и бэкапов на ноде» (offsite S3 ЕСТЬ) | (опровергнуто, см. приложение) |
| ops-04 | high [confirmed] | ops | Нет CI/CD и нет IaC — деплой и инфра полностью ручные | [prod-deploy-log.md:18](docs/operations/prod-deploy-log.md#L18) |
| ops-05 | high [confirmed] | correctness | ANTHROPIC_API_KEY required блокирует старт | [env.schema.ts:103](backend/src/common/config/env.schema.ts#L103) |
| ops-06 | medium [partially] | security | /metrics открыт наружу через nginx (allow/deny закомментирован) | [z-backend.conf:54](deploy/nginx/z-backend.conf#L54) |
| ops-07 | medium [confirmed] | ops | Нет resource limits и log-rotation у контейнеров | [docker-compose.yml:152](docker-compose.yml#L152) |
| ops-08 | medium [confirmed] | observability | Healthcheck дёргает /health (liveness), а не /health/ready | [docker-compose.yml:172](docker-compose.yml#L172) |
| ops-09 | medium [unverified] | maintainability | Двусмысленность: prod-PG managed (Yandex) или контейнер? | — |
| ops-10 | low [unverified] | maintainability | GEPA Python-сервис в prod-compose в backend/python (вне infra/*) | — |
| ops-11 | low [unverified] | security | Egress с cap_add SYS_ADMIN в host-сети | — |
| ops-12 | low [unverified] | ops | Нет ретенции авто-бэкапов в volume z-backups | — |

**ops-04 — нет CI/CD и IaC [confirmed, high].** Нет `.github/workflows`, `.gitlab-ci.yml`, `.circleci`, `Jenkinsfile`; `.husky` отсутствует, `.git/hooks` только `*.sample`; нет `.pre-commit-config`. ~500 тест-файлов, strict-tsc и строгий ESLint не выполняются ни на commit/push/PR. Качество держится только на дисциплине. Инфраструктура нигде не описана как код (только Markdown с плейсхолдерами). Bus-factor по знанию инфры = 1. **Рекомендация:** минимальный GitHub Actions — на PR backend+frontend typecheck/lint/test:unit; отдельный job с postgres+pgvector+redis services — обязательные integration/e2e; обязательно для merge в main.

**ops-06 — /metrics открыт наружу [partially, medium↓].** В [deploy/nginx/z-backend.conf](deploy/nginx/z-backend.conf) `location /metrics` проксирует на backend, а строка `allow/deny` закомментирована; на уровне приложения guard отсутствует (`PrometheusModule` без auth). `/metrics` отдаёт бизнес-телеметрию (cost, биллинг, рефералы, счётчики тенантов). Поправка: это шаблон для ручной установки с явным inline-предупреждением «не публиковать наружу» и плейсхолдерами (не запустится без правки оператором). Severity high→medium. **Рекомендация:** раскомментировать allow/deny по умолчанию (или убрать location из публичного блока); то же для `/api/docs`.

### 4.9 Наблюдаемость и надёжность

Буфер логирования, единый фильтр ошибок, санитайзер секретов, split health — образцово. Слабые места слабо связаны: cardinality-риск метрик, мёртвый алерт, removeOnFail:false, LLM без таймаута, логи в боевую БД.

| ID | severity | категория | суть | ссылка |
|---|---|---|---|---|
| obs-01 | medium [partially] | scalability | Cardinality: ~44 метрики с сырым tenant, gauge без reset | [business-metrics.service.ts:133](backend/src/common/metrics/business-metrics.service.ts#L133) |
| obs-02 | high [confirmed] | observability | Мёртвый алерт BullMqFailedJobsHigh (метрика не эмитится) | [business-alerts.yml:57](infra/grafana/alerts/business-alerts.yml#L57) |
| obs-03 | high [confirmed] | scalability | removeOnFail:false на всех очередях — рост памяти Redis | [ai/queues.ts:71](backend/src/modules/ai/queues.ts#L71) |
| obs-04 | medium [partially] | ops | LLM-SDK без таймаута/circuit-breaker (fallback-путь не прикрыт) | [llm-fallback.service.ts:53](backend/src/modules/ai/services/llm-fallback.service.ts#L53) |
| obs-05 | medium [partially] | scalability | Все логи в PostgreSQL SystemLog (11 индексов, без партиций) | [db-logger.bridge.ts:53](backend/src/modules/logging/db-logger.bridge.ts#L53) |
| obs-06 | medium [confirmed] | observability | Нет RED-метрик HTTP (latency/throughput/5xx) в Prometheus | [logging.module.ts:20](backend/src/modules/logging/logging.module.ts#L20) |
| obs-07 | medium [confirmed] | scalability | Воркеры и HTTP в одном event loop; Prometheus один таргет | [prometheus.yml:22](infra/prometheus/prometheus.yml#L22) |
| obs-08 | medium [partially] | ops | Захардкоженные пороги алертов, нет алертов на очереди/Redis | [business-alerts.yml:23](infra/grafana/alerts/business-alerts.yml#L23) |
| obs-09 | medium [unverified] | security | Санитайзер маскирует по имени ключа, не по значению (PII в логах) | — |
| obs-10 | medium [unverified] | ops | Нет unhandledRejection/uncaughtException хуков | — |
| obs-11 | medium [unverified] | maintainability | BusinessMetricsService 7k строк / 394 метрики в 357 файлах | — |
| obs-12 | low [unverified] | maintainability | Дрейф доков (pino, worker-процесс, числа) | — |

**obs-02 — мёртвый алерт BullMqFailedJobsHigh [confirmed, high].** Алерт завязан на `increase(bullmq_failed[10m]) > 5`, но метрика `bullmq_failed` нигде в `backend/src` не эмитится (это известное ограничение, документированное в `docs/known-issues.md` как ожидающее стороннего exporter'а). ~50 воркеров на `failed` только логируют. Алерт молчит всегда. Частичная видимость есть через admin-REST (`getJobCounts`), но не алертинг. **Рекомендация:** экспортёр BullMQ-метрик (gauge глубины + counter failed/completed) в `BusinessMetricsService` либо подключить bull-exporter; до этого переписать алерт на реальную метрику.

**obs-03 — removeOnFail:false [confirmed, high].** Дублирует wq-03 с другого ракурса: failed-jobs ядра копятся в общем критичном Redis (BullMQ + idempotency + cache) без потолка; при устойчивой деградации LLM/ASR — медленный OOM всего pipeline. **Рекомендация:** `{age,count}` как в exports/webhook + алерт на `used_memory` Redis.

**obs-06 — нет RED-метрик HTTP [confirmed, medium].** `RequestLoggingInterceptor` отключён (D3, 2026-06-03) и в Prometheus метрики не клал; `AllExceptionsFilter` на 5xx инкрементирует ноль метрик. SLI «доля 5xx» и p95-latency доступны только через тяжёлый SQL по `SystemLog`. Алерта на рост 5xx нет. **Рекомендация:** глобальный interceptor с `http_requests_total{method,route,status}` и `http_request_duration_seconds{route}` (route нормализованный, не сырой path) + алерты доли 5xx и p95.

**obs-04 — LLM-SDK без таймаута [partially, medium↓].** Все LLM-клиенты конструируются без `timeout`/`maxRetries` (дефолт SDK 10 мин + ретраи ×2). Поправка: главный путь `LlmRouter.dispatch` прикрыт hard-timeout 30 с (`Promise.race`); незащищён именно `LlmFallbackService` (analyze-воркер, генерация отчётов) — без circuit-breaker залипший провайдер держит слот до 10 мин, а внутренние SDK-ретраи множат стоимость. Severity high→medium (scope ограничен fallback-путём). **Рекомендация:** `timeout: 60-120s` + `maxRetries: 0` (ретраи только на уровне BullMQ); лёгкий circuit-breaker в `LlmFallbackService`.

### 4.10 Тестирование и качество

Есть осмысленный набор юнит-тестов на критичные пути (баланс встреч, tier-fallback, LiveKit-вебхуки, квоты, RBAC, SSRF, шифрование). Главные дыры — нет CI вообще, иллюзия покрытия (74% на моках, ~10 БД-тестов фактически не гоняются), пустой golden-гейт AI-ядра.

| ID | severity | категория | суть | ссылка |
|---|---|---|---|---|
| qa-01 | critical [confirmed] | ops | Нет CI/CD вообще — тесты/typecheck/lint не гоняются автоматически | [backend/package.json:6](backend/package.json#L6) |
| qa-02 | critical [refuted] | security | «Нет ни одного теста на межтенантную изоляцию» (есть для knowledge-core) | (опровергнуто, см. приложение) |
| qa-03 | high [confirmed] | ops | Integration молча скипаются без БД; e2e без CI не гоняются | [db-availability.ts:18](backend/test/integration/knowledge-core/db-availability.ts#L18) |
| qa-04 | high [confirmed] | correctness | Golden-set knowledge-core — пустой каркас, runner бросает «не реализован» | [golden.spec.ts:183](backend/tests/golden/knowledge-core/golden.spec.ts#L183) |
| qa-05 | medium [partially] | maintainability | ~9 пустых describe.skip-заглушек центральных модулей | [block-extraction.service.spec.ts:18](backend/src/modules/knowledge-core/services/block-extraction.service.spec.ts#L18) |
| qa-06 | high [confirmed] | correctness | ESLint без no-floating-promises — пропавшие await не ловятся | [eslint.config.mjs:12](backend/eslint.config.mjs#L12) |
| qa-07 | medium [confirmed] | correctness | FSM assertTransition напрямую не тестируется | [meeting-fsm.ts:39](backend/src/modules/meetings/fsm/meeting-fsm.ts#L39) |
| qa-08 | medium [confirmed] | data-integrity | Идемпотентность LiveKit-вебхуков без unit-теста; seen вне tx с handle | [livekit-webhooks.service.ts:58](backend/src/modules/webhooks/livekit-webhooks.service.ts#L58) |
| qa-09 | medium [unverified] | maintainability | business-metrics (7k) и clones.service (2.7k) без прямых тестов | — |
| qa-10 | medium [unverified] | maintainability | Нет порогов покрытия; фронт ~22 теста на ~46k строк | — |
| qa-11 | low [unverified] | observability | Дрейф доков (45 vs 96 модулей) без теста-сторожа | — |

**qa-01 — нет CI/CD [confirmed, critical].** Отсутствует любой CI. ~527 тест-файлов, strict-tsc и строгий ESLint не проверяются автоматически ни на commit/push/PR — всё на дисциплине. С учётом `db push` без safety-миграций откат дорог, и любое красное уезжает в main. **Рекомендация:** GitHub Actions — на PR typecheck/lint/test:unit (back+front); отдельный job с postgres+pgvector+redis — обязательные integration/e2e без молчаливого skip; merge-блокировка.

**qa-04 — golden-set AI-ядра пустой [confirmed, high].** `runKnowledgeCorePipeline` бросает «не реализован»; каталоги `meetings/` и `expected/` содержат только `.gitkeep` → весь suite skip, gate не срабатывает. Eval-наборы goal-extract/skill-trait имеют реальные фикстуры и mock-тесты инвариантов, но live-LLM регрессия помечена `it.todo`. Для ядра продукта (извлечение блоков/сущностей/графа) НЕТ работающего гейта качества. С учётом правила self-improving агентов без human-in-loop (авто-обновление промптов через judge+A/B) golden-гейт — единственный предохранитель от тихой деградации. **Рекомендация:** разметить минимальный набор (10-15 встреч), реализовать runner, считать F1/recall@10/cosine как блокирующий gate.

**qa-06 — ESLint без no-floating-promises [confirmed, high].** Подключён только `tseslint.configs.recommended` (не `recommendedTypeChecked`), нет `no-floating-promises`/`no-misused-promises`, хотя `parserOptions.project` задан (type-aware lint доступен). Для backend на async Prisma/BullMQ/Redis забытый await на записи/enqueue — fire-and-forget: данные теряются без падения и лога. **Рекомендация:** включить `@typescript-eslint/no-floating-promises` и `no-misused-promises` (поэтапно warn→error), гонять в CI.

**qa-08 — идемпотентность вебхуков без теста [confirmed, medium].** `LivekitWebhooksService` помечает `WebhookSeenEvent` ДО `eventsHandler.handle`, и при падении handler ошибка проглатывается (catch+log, return 200) — событие помечено seen, но FSM/participant не обновлены, и LiveKit не ретраит. Сценарий «seen, но не обработан» не покрыт тестом. **Рекомендация:** тест на дубликат + решение по «handler упал после seen» (outbox/повторно-обрабатываемая очередь либо seen только после успеха).

### 4.11 Продуктовая когерентность

Ядро многоисточниковое, Action Center и дашборд CEO построены глубоко, удалённые поверхности — чистые редиректы. Главная проблема — не недоделанность, а дублирование диалоговых поверхностей и фрагментация точек входа.

| ID | severity | категория | суть | ссылка |
|---|---|---|---|---|
| pc-01 | low [partially] | product | Сайдбар «Помощник компании» ведёт на deprecated /chat, не /chat-v2 | [Sidebar.tsx:258](frontend/src/ui/components/app-shell/Sidebar.tsx#L258) |
| pc-02 | medium [partially] | product | Три точки входа «спроси Кору»: /chat, /chat-v2, /assistant | [chat-v2/page.tsx](frontend/app/(authenticated)/chat-v2/page.tsx) |
| pc-03 | medium [partially] | product | Два домена задач: Task (action items) vs Issue (трекер) | [schema.prisma:1496](backend/prisma/schema.prisma#L1496) |
| pc-04 | medium [partially] | maintainability | Доки: 45 vs 97 модулей, «Anthropic не используем» vs живой сервис | [anthropic.service.ts:1](backend/src/modules/ai/services/anthropic.service.ts#L1) |
| pc-05 | medium [confirmed] | product | Половинчатые 501/no-op кнопки видны как реальные | [admin-bots.service.ts:355](backend/src/modules/admin/integrations/bots/admin-bots.service.ts#L355) |
| pc-06 | medium [unverified] | scalability | Объём разросся в полноценные бизнес-домены за рамки MVP | — |
| pc-07 | low [unverified] | product | Два org-сайдбара настроек (/settings/admin vs /company-admin) | — |
| pc-08 | low [unverified] | product | Пересекающиеся клоновые/профильные поверхности человека | — |

**pc-05 — 501/no-op кнопки видны как реальные [confirmed, medium].** Несколько поверхностей выглядят как фичи, но бросают 501 или молча ничего не делают: тест IMAP-подключения (`NotImplementedException`, при этом фронт показывает `toast.success`), `rotateIpSalt` (501, фронт тоже «успех»), push-доставка напоминаний о событиях (TODO, лог вместо отправки — канал push выбираем пользователем), дайджест активности (доставка TODO), бейдж `goal_alignment` (всегда false). Для нетехнического владельца это «вроде есть, но молча не работает» — дорогой класс UX-долга, рушащий доверие. **Рекомендация:** реестр «видимое, но 501/no-op», для каждого — скрыть за feature-flag или доделать (особенно push событий и дайджесты).

**pc-02 — три точки входа «спроси Кору» [partially, medium↓].** Сосуществуют `/chat` (живая поверхность с fallback-баннером на v2, НЕ deprecated по коду), `/chat-v2` («AI-чат компании», RAG по графу — работает без флага), `/assistant` (Concierge — tool-use агент, делает действия). Нейминг пересекается в палитре команд и сайдбаре, один значок переиспользован. Для нетехнической ЦА разница «отвечает» vs «делает» не очевидна. Поправка: `/chat-v2` доступен по дефолту (флаг `CHAT_V2_ENABLED` гейтит только legacy-endpoint в модуле chat, не флагман); ярлык «deprecated» для /chat в коде не подтверждён. Severity high→medium (UX/IA, не функциональный баг). **Рекомендация:** свести к двум сущностям с разными названиями/иконками — «Спросить Кору» (ответы) и «Сделай за меня» (действия).

### 4.12 Стоимость и масштабирование (горизонт год)

Реальная per-org экономика с бюджет-капами и алертами, атомарные квоты, AnswerCache, богатый набор HNSW-индексов. Денежные/нагрузочные обрывы — неограниченный рост AiUsageLog, бюджет без enforce, выключенные по умолчанию sweep'ы, per-Org кроны.

| ID | severity | категория | суть | ссылка |
|---|---|---|---|---|
| cost-01 | high [confirmed] | scalability | AiUsageLog растёт неограниченно, retention отсутствует | [ai-usage-log.service.ts:72](backend/src/modules/ai/services/ai-usage-log.service.ts#L72) |
| cost-02 | high [confirmed] | cost | OrgBudgetCap только алертит, не останавливает расход | [budget-alert.cron.ts:45](backend/src/modules/admin/economics/budget-alert.cron.ts#L45) |
| cost-03 | high [confirmed] | scalability | Retention RawEvent/blocks/audit ВЫКЛЮЧЕНЫ по умолчанию | [env.schema.ts:205](backend/src/common/config/env.schema.ts#L205) |
| cost-04 | medium [partially] | scalability | Вся логика в одном процессе, без cron-gating/leader-election | [app.module.ts:146](backend/src/app.module.ts#L146) |
| cost-05 | medium [partially] | scalability | Per-Org кроны org.findMany→for(org) с последовательными LLM | [entity-graph-builder.cron.ts:45](backend/src/modules/knowledge-core/workers/entity-graph-builder.cron.ts#L45) |
| cost-06 | low [partially] | cost | Эмбеддинги без content-hash дедупа; вставка чанков по одному | [transcript-indexer.service.ts:80](backend/src/modules/embeddings/services/transcript-indexer.service.ts#L80) |
| cost-07 | medium [confirmed] | cost | AnswerCache привязан к userId — низкий hit-rate в команде | [answer-cache.service.ts:57](backend/src/modules/dialog-layer/services/answer-cache.service.ts#L57) |
| cost-08 | medium [confirmed] | ops | Failed knowledge-core jobs копятся в Redis вечно | [core-queue/queues.ts:206](backend/src/modules/core-queue/queues.ts#L206) |
| cost-09 | medium [unverified] | ops | Retention-purge deleteMany без батчинга — блокирующая операция | — |
| cost-10 | medium [unverified] | maintainability | Документация недооценивает объём; ни одна таблица не партиционирована | — |
| cost-11 | low [unverified] | scalability | HNSW-индексы с дефолтными m/ef_construction | — |
| cost-12 | low [unverified] | cost | Заметка «Anthropic не используем» vs живой сервис в роутере | — |

**cost-01 — AiUsageLog без retention [confirmed, high].** Строка на каждый LLM-вызов + два TEXT-превью до 8 КБ; `aiUsageLog.deleteMany` нигде в prod-путях нет — единственная крупная телеметрическая таблица без retention при наличии свипов у соседей. Она же источник дорогих SUM-агрегаций `OrgEconomicsCron`/`BudgetAlertCron`. **Рекомендация:** retention 90-180 дней (либо обнулять превью через 30 дней, оставляя costUsd/tokens/tier) + range-партиционирование по `createdAt`; регистрация в retention-cron и apply-prod-deploy.

**cost-03 — retention sweep'ы выключены по умолчанию [confirmed, high].** Дефолты `RETENTION_RAW_EVENTS_ENABLED=false`, `RETENTION_AUDIT_ENABLED=false`, `RETENTION_BLOCKS_ENABLED=false` (включён только chat). `RawEvent` (payload событий графа) и `IdeaBlock` (ядро + vector+tsvector) растут безгранично до ручного включения флагов. Поправка: `OrgRetentionPolicy`-дефолты уже разумны (rawEventDays 2555 под 152-ФЗ, archivedBlockDays 365). **Рекомендация:** включить sweep'ы по умолчанию после первого полного бэкапа; алерт при превышении объёма с выключенным sweep.

**cost-07 — AnswerCache per-user [confirmed, medium].** Ключ `dlg:ans:{tenantId}:{userId}:{hash}` — кэш per-user. Одинаковый вопрос от двух сотрудников считается заново. Поправка: дорогой retrieval уже кэшируется tenant-wide (`RetrievalCache` без userId), поэтому при answer-miss + retrieval-hit заново гоняется только LLM-синтез — масштаб переплаты меньше, но реален. **Рекомендация:** tenant-level кэш для фактологических вопросов без per-user RBAC-фильтрации (учитывать роль/доступ в ключе вместо userId).

### 4.13 Целостность и корректность данных

Ядро (деньги в копейках, идемпотентность вебхуков, дедуп ingest, FSM) сделано зрело. Слабые места — на стыках «транзакция БД ↔ побочный эффект вне транзакции» и в продуктовой полноте грантов.

| ID | severity | категория | суть | ссылка |
|---|---|---|---|---|
| di-01 | high [confirmed] | data-integrity | Платное продление через вебхук не пополняет баланс встреч | [billing.service.ts:434](backend/src/modules/billing/services/billing.service.ts#L434) |
| di-02 | high [confirmed] | data-integrity | Списание баланса до tx без компенсации; нет Idempotency-Key на POST | [meetings.service.ts:228](backend/src/modules/meetings/meetings.service.ts#L228) |
| di-03 | medium [confirmed] | data-integrity | Грант баланса после commit без идемпотентного ключа | [manual-billing.service.ts:258](backend/src/modules/billing/services/manual-billing.service.ts#L258) |
| di-04 | medium [confirmed] | data-integrity | Optimistic-lock admin-настроек опционален и read-вне-tx (TOCTOU) | [admin-settings.service.ts:201](backend/src/modules/admin/settings/admin-settings.service.ts#L201) |
| di-05 | medium [confirmed] | correctness | FSM-переход read-then-write без блокировки строки (гонка) | [meetings.service.ts:798](backend/src/modules/meetings/meetings.service.ts#L798) |
| di-06 | medium [unverified] | data-integrity | consume молча пропускает списание при !=1 Org-membership | — |
| di-07 | medium [unverified] | data-integrity | fail-open на consume/quota без алерта при затяжной деградации | — |
| di-08 | low [unverified] | correctness | Несовпадение invoice unitKopecks*qty != totalKopecks для SEATS | — |
| di-09 | low [unverified] | correctness | Byte-квота ingest инкрементится до create — двойной учёт при гонке | — |

**di-01 — продление не пополняет баланс [confirmed, high].** `MeetingsBalanceService.grant` вызывается ТОЛЬКО в ручной admin-активации и `adjustSeats`. Авто-продление через вебхук (`finalizePaidInvoice`) обновляет период и `totalPaid`, но НЕ грантует и не эмитит грант-событие; ни один `@OnEvent INVOICE_PAID` не пополняет баланс. Платящий клиент после исчерпания стартовых 150 встреч получает баланс 0 и `ForbiddenException` «дождитесь продления» сразу после успешного списания карты — текст ошибки прямо обещает то, чего код не делает. Прямой отток. **Рекомендация:** таблица-факт `MeetingsBalanceGrant` с `@unique(invoiceId)`, грантовать через неё во ВСЕХ путях (activate, adjustSeats, renewal-webhook в `@OnEvent INVOICE_PAID`) — идемпотентно + реконсайл-крон.

**di-02 — списание до tx без компенсации [confirmed, high].** `consume()` вызывается ДО транзакции создания встречи; при откате (NotAuthorizedError card_not_found/user_not_found, любой FK-сбой) баланс уже списан, компенсирующего `grant(+1)` нет — кредит сгорает. Дополнительно: на `POST /meetings` нет Idempotency-Key — двойной клик/ретрай = две встречи, два списания (при том что `IdempotencyInterceptor` есть в проекте и применён на crossmark-контроллере). **Рекомендация:** перенести consume внутрь транзакции (или try/catch + grant(+1) при откате); подключить `IdempotencyInterceptor` на `POST /meetings`.

**di-05 — FSM-переход read-then-write [confirmed, medium].** `transitionStatus` делает `findUnique(current)` + `assertTransition` + `update` в одной tx на Read Committed без блокировки строки. Параллельные вебхуки/контролы могут оба пройти проверку и задвоить FSM-события и AI-jobs. Пред-проверки вебхука лишь сужают, но не закрывают окно. **Рекомендация:** условный `update where {id, status: from}`, `count=0` = проигранная гонка (no-op), без перехода на Serializable.

### 4.14 Дрейф документации

Документация живёт на трёх уровнях и рассинхронизирована. CLAUDE.md (главный вход для AI-агентов) отстал на несколько эпох продукта и ссылается на несуществующие артефакты — это не косметика, а источник реальных ошибочных действий агентов.

| ID | severity | категория | суть | ссылка |
|---|---|---|---|---|
| dd-01 | high [confirmed] | dx | CLAUDE.md/README предписывают несуществующие worker:dev и src/workers/main.ts | [CLAUDE.md:66](CLAUDE.md#L66) |
| dd-02 | medium [partially] | ops | prod-deploy-log внутренне противоречив про модель воркеров | [prod-deploy-log.md:2119](docs/operations/prod-deploy-log.md#L2119) |
| dd-03 | medium [confirmed] | maintainability | CLAUDE.md: «45 модулей / 1.7k схема» против 97 / 10.2k | [CLAUDE.md:81](CLAUDE.md#L81) |
| dd-04 | medium [partially] | maintainability | «Anthropic не используем» vs боевой AnthropicService в роутере | [llm-router.service.ts:1617](backend/src/modules/ai/services/llm-router.service.ts#L1617) |
| dd-05 | medium [confirmed] | maintainability | Модуль-призрак mail-inbound в module-map (реального нет) | [module-map.md:1712](second-brain/02_architecture/module-map.md#L1712) |
| dd-06 | medium [unverified] | maintainability | ~50 реальных модулей и practice-skills не покрыты документацией | — |
| dd-07 | medium [unverified] | maintainability | module-map.md выродился в append-only журнал фаз (2171 строка) | — |
| dd-08 | low [unverified] | maintainability | index.md устарел по числам процессов (27/3) | — |
| dd-09 | low [unverified] | correctness | Заметка памяти безапелляционно «Anthropic НЕ используем» | — |
| dd-10 | medium [unverified] | ops | Нет машинной защиты от дрейфа: ничто не сверяет доки с кодом | — |

**dd-01 — несуществующие worker:dev и src/workers/main.ts [confirmed, high].** CLAUDE.md и backend/README предписывают команду `bun run worker:dev` и файл `src/workers/main.ts` как «отдельный процесс воркеров». В `package.json` есть только `dev/build/start`, директории `backend/src/workers/` не существует, воркеры in-process в `AppModule`. CLAUDE.md грузится в каждую сессию — любой человек/агент выполнит несуществующую команду и будет искать несуществующий файл. Корректная модель уже задокументирована рядом (tech-stack.md, prod-deploy-log.md:349) — чистый дрейф. **Рекомендация:** удалить упоминания, заменить на «воркеры in-process через WorkersModule»; вычистить stale-комментарии «отдельный процесс» в app.module.ts; CI-гард, что все `bun run X` из доков есть в package.json.

**dd-05 — модуль-призрак mail-inbound [confirmed, medium].** `module-map.md` заводит раздел `backend/src/modules/mail-inbound/` с подробным деревом файлов (`mail-inbound.service.ts`, `imap-client.service.ts`, `dto/enable-inbox.dto.ts`), которых не существует. Реальный модуль — `backend/src/modules/mail/inbound/` с другими именами. Дрейф глубже заявленного: расходятся и путь, и структура, и имена файлов. **Рекомендация:** исправить путь и имена; добавить в чек-лист проверку реального пути через `ls`.

---

## 5. 10+ причин сломаться через год

| # | Риск | Механизм | Ранний признак | Митигейшн |
|---|---|---|---|---|
| 1 | Один процесс под всё (HTTP + ~160 @Cron + воркеры на одном event loop/пуле, без leader-election и backpressure) | Заявленный worker-процесс физически не существует; CPU/LLM-задачи конкурируют с HTTP за event loop; ~97/106 кронов без lock → на 2+ репликах N-кратное выполнение (двойные дайджесты/выплаты/decay, гонки графа) | Рост p95/p99 строго в окна 03:00–05:00 и при росте глубины очередей; по 2 одинаковых уведомления после второй реплики; исчерпание Prisma-пула и LLM 429 ночью | ENV `ROLE=api|worker`; до разделения — Redis `SET NX PX` для ВСЕХ кронов в `runWrapped`; гард против `scale>1`; тяжёлые sweeps → job-на-Org в BullMQ с rate-limit; джиттер ночным кронам |
| 2 | Единый домен *.agent-lia.ru — SPOF для secondary+tertiary LLM, ASR, embeddings | Tier'ы не независимы по инфраструктуре; отказ домена выносит 2/3 LLM + транскрибацию + векторизацию; для clip-title/theme-classify primary сам на proxy → полный отказ | Одновременный рост latency на secondary+tertiary + всплеск `status=fallback`; корреляция vox.timeout и LLM-ошибок; рост очереди transcribe | Secondary через НЕ тот прокси (прямой api.openai.com/MiniMax вне домена); fallback-ASR на независимой инфре; health-probe + алерт; рабочий local-fallback эмбеддингов |
| 3 | Бюджет LLM только наблюдается, costUsd занижается до 0 | `LlmRouter.call()` не проверяет `OrgBudgetCap`; `BudgetAlertCron` раз в 2 ч только алертит; `calcCostUsd=0` для моделей вне прайса; истёкшая промо deepseek-v4-pro (4×) | Резкий рост ai_cost для одного tenant_top; alert на 100% без спада; расхождение счёта вендора и SUM(costUsd); рост доли costUsd=0 при ненулевых токенах | Hard-cap kill-switch при utilization≥N%; Redis MTD-счётчик per tenant; sentinel + метрика `llm_price_missing` на price-miss; снизить период BudgetAlertCron |
| 4 | Append-only телеметрия растёт без партиционирования/retention; AiUsageLog без очистки | Класс таблиц растёт линейно; AiUsageLog не чистится и сам источник дорогих SUM; SystemLog cleanup в одной 120s-транзакции откатится на бэклоге; снапшоты без TTL | Рост `pg_total_relation_size`; рост durationMs у org-economics; лог «cleanup упал»; падение свободного места | Range-партиции по месяцу (DROP PARTITION); retention AiUsageLog 90-180д; инкрементальный cleanup SystemLog; pg_trgm GIN; logging max-size в compose |
| 5 | db push --accept-data-loss на каждом выкате без diff/approval | Деструктив (drop/rename) применяется молча; нет версионированной DDL; дрейф объектов из postgres-init; restore многогб-дампа = часы | В логах migrate «will be lost»/DROP COLUMN; рост времени schema-фазы; жалобы на пропавшие данные после выката | `migrate diff` как артефакт ревью; детектор DROP с фейлом-по-умолчанию + `ZSCHEMA_ALLOW_DESTRUCTIVE`; migrate для shadow-diff/CI-gate |
| 6 | Тихая порча графа: смешение векторных пространств при fallback + дубликаты Entity | Local-fallback в общий vector(1536) без проверки совместимости → шум cosine; нет unique на `lower(canonicalName)`, резолв вне tx при concurrency=2 → дубли узлов | Массовый fallback на local в инцидент; рост дублей Entity по lower(name); жалобы AI-чата на удалённые объекты; lag темообразования | Та же модель в fallback или embedding=null+retry; provider/dim рядом с вектором; partial unique на lower(name) + обработка P2002; integrity-воркер |
| 7 | Failed-jobs ядра копятся в Redis вечно (removeOnFail:false) без алерта | Нет авто-очистки; soft-deleted Org даёт 5 бесполезных ретраев на job; мёртвый алерт `bullmq_failed`; админка видит 3/15 очередей | Рост used_memory Redis при стабильной нагрузке; рост `bull:*:failed`; незамеченный lastRunError у money-кронов | `{age,count}` во всех ai.*/core.*; skip для soft-deleted Org; реальный cron-чекер инцидентов + Prometheus-gauge; единый QUEUE_REGISTRY |
| 8 | Каскад чистит строки, но не S3-объекты и не висячие ссылки | FK не каскадит во внешнее хранилище; `hardDeleteMeetings` без сбора ключей; orphan-reconcile воркера нет; риск 152-ФЗ | Расхождение числа объектов в бакете и строк Recording/AudioTrack; рост счёта S3 при стабильном числе встреч | Pre-delete сбор S3-ключей в очередь; reconcile-воркер «объект без строки → удалить»; integrity-воркер dangling-рёбер |
| 9 | LLM-SDK без таймаута/circuit-breaker; синхронный axis-classify в ingest | Залипший провайдер держит слот до 10 мин в fallback-пути; BullMQ ×5 + SDK-ретраи множат cost; нет backpressure на raw-events | Рост p95 коррелирует с глубиной очередей; всплески 429 в пики обработки; рост lag темообразования | timeout 60-120s + maxRetries:0; circuit-breaker в LlmFallbackService; axis-classify в debounced-job; общий rate-limiter LLM |
| 10 | Биллинг встреч теряется на стыках | Нет гранта на авто-продлении; consume вне tx без компенсации; нет Idempotency-Key на POST; бесплатные встречи для мультиоргов | Рост «оплатил, но не могу создать встречу»; 403 у Org со статусом ACTIVE и свежим paidAt; balance=0 при активной подписке | `MeetingsBalanceGrant @unique(invoiceId)` во всех путях; consume в tx; Idempotency-Key; явный tenantId в consume |
| 11 | Изоляция тенантов на ручной дисциплине без гаранта | Cookie+Tenant не глобальные (194 контроллера вручную); нет lint/арх-теста; edge-гейт 6/50; 574 файла инжектят Prisma напрямую | Контроллер без TenantGuard в diff; падение cross-tenant e2e; «вижу кусок приватной страницы перед редиректом» | Cookie+Tenant в APP_GUARD с opt-out @Public; deny-by-default proxy.ts; арх-тест через DiscoveryService; orgId первым в SWR-ключах |
| 12 | Нет CI/CD и работающего quality-gate AI-ядра | typecheck/lint/~500 тестов не гоняются; integration молча скипаются; golden-set пустой каркас; авто-обновление промптов без human-in-loop проходит незамеченно | Учащение hotfix/revert в prod-deploy-log; рост meetings без aiResult; деградация ответов AI-чата без ошибок в логах | Минимальный CI с обязательными integration/e2e; разметить golden-набор + реализовать runner (блокирующий gate) |
| 13 | Конфиг-ловушки и дрейф документации | Обязательные ключи неиспользуемых провайдеров; ленивый CRYPTO_MASTER_KEY; несуществующий worker-процесс в доках; ollama maxDataClass=private на удалённом хосте | Boot падает на «ANTHROPIC_API_KEY required»; первое IMAP/Telegram-подключение падает в рантайме; PR со ссылками на src/workers/main.ts | Ключи неиспользуемых провайдеров `.optional()` + ленивая проверка; CRYPTO обязателен в prod через refine + key-id; ollama → internal; CI drift-check |

---

## 6. Продуктовая когерентность

**Дублирующиеся/параллельные модули (пары):**

- **chat ↔ chat-v2 ↔ assistant** — три диалоговые поверхности: `/chat` (живая, fallback-баннер на v2), `/chat-v2` (RAG по графу, флагман), `/assistant` (Concierge tool-use). Нейминг пересекается, один значок переиспользован. Свести к двум: «Спросить Кору» (ответы) и «Сделай за меня» (действия).
- **Task ↔ Issue** — два домена задач: legacy `Task` (action items встреч) и `Issue` (полноценный трекер). Дублирование: из одного транскрипта параллельно пишутся и Task (для таба встречи), и `IntakeIssue→Issue` (в трекер) двумя независимыми путями. Флаг `meetingTasksToTrackerOnly` дефолт OFF.
- **roles-domain ↔ role-map ↔ role-profiles** — роль размазана по трём модулям + отдельное понятие role в RBAC; границы концептуальные, не доменные.
- **clones ↔ knowledge-clone** — «клон роли» (исполняемый персонаж) vs «профиль знаний человека» — граница в UX размыта.
- **/settings/admin/* ↔ /company-admin/*** — два org-сайдбара с пересекающимися разделами (встречи, источники, доступ к памяти) — две точки правды.

**Половинчатые/заглушки (видимые, но 501/no-op):** тест IMAP-подключения (501, фронт показывает success), `rotateIpSalt` (501, фронт success), push-доставка напоминаний (TODO/лог), дайджест активности (доставка TODO), бейдж `goal_alignment` (всегда false). Дашборд CEO: 4 из 7 сигналов burnout активны, 3 честно помечены TODO.

**Чего не хватает для заявленного продукта.** Сам по себе функционал «памяти компании» построен глубоко. Не хватает не фич, а фокуса и enforce: (1) флагманский AI-чат разнесён по трём поверхностям с непоследовательной обнаружимостью; (2) ключевые предохранители заявлены, но не работают (бюджет LLM не enforce-ится, golden-гейт пустой, retention выключен); (3) объём разросся в полноценные бизнес-домены (трекер уровня Jira, recognition, referrals, brand-voice) за рамки MVP — нужна явная классификация модулей на «ядро / поддержка / спекуляция».

---

## 7. Дорожная карта

### Быстрые победы (effort S–M, высокая отдача)

1. **[S] Ключи неиспользуемых LLM-провайдеров → `.optional()`** + синхронизировать память про Anthropic. Backend не стартует без 4 секретов к провайдерам, которых нет в дефолтных цепочках. (arch-02, llm-04, ops-05)
2. **[S] Закрыть /metrics на nginx** (раскомментировать allow/deny) + то же для /api/docs. Шаблон по умолчанию публикует бизнес-телеметрию. (ops-06)
3. **[S] removeOnFail `{age,count}` для core.*/ai.*** + ночной cleanup. Failed-jobs копятся в общем Redis вечно. (wq-03, obs-03, cost-08)
4. **[S] trust proxy в main.ts** точным значением — недостоверный IP в аудите/сессиях. (sec-04)
5. **[S] Метрики/алерты на fail-open квот/баланса и память Redis** — при деградации бесплатное потребление дорогих LLM без сигнала. (di-07, obs-08)
6. **[S] Сериализовать FSM-переход условным UPDATE** `where {id, status: from}` — устраняет гонку без Serializable. (di-05)
7. **[S] Drift-check в CI** — команды из CLAUDE.md есть в package.json, пути модулей существуют, числа сверяются. (dd-01, dd-03, dd-05, arch-06)
8. **[S] Переключить сайдбар «Помощник компании» на /chat-v2**, /chat → редирект. (pc-01, pc-02)
9. **[S] Fail-fast на пустой CRYPTO_MASTER_KEY в prod** через refine по NODE_ENV. (sec-02)
10. **[S] @Throttle на auth-эндпоинты в рабочее состояние** — навесить `ThrottlerGuard`. (sec-05)
11. **[M] `migrate diff` как артефакт перед prod-push** + детектор деструктива. (dm-01, ops-02)
12. **[M] Денормализовать tenantId в MeetingTranscriptChunk** + интеграционный тест. (dm-10)

### Стратегические направления (effort L–XL)

1. **[L] Вынести воркеры/cron в отдельный процесс (ROLE=api|worker) + leader-lock на cron.** Сквозной корень самой высокой плотности high-находок: разделить event loop HTTP и AI-pipeline, исключить N-кратное выполнение кронов при репликах. (arch-01, wq-01, ops-01, obs-07, cost-04)
2. **[L] Партиционировать append-only/телеметрию по createdAt + retention/TTL.** AiUsageLog/SystemLog/RawEvent/IdeaBlock/snapshots; DROP PARTITION вместо DELETE; включить sweep-флаги после бэкапа. (dm-03, obs-05, cost-01, cost-03)
3. **[M] CI/CD-гейт обязательным для merge** (typecheck+lint+test+docker build) с postgres+pgvector+redis services. Снимает класс регрессий FSM/биллинга/изоляции. (qa-01, qa-03, ops-04)
4. **[M] Закрыть пробелы биллинга:** грант MeetingsBalance на продлении + идемпотентность через invoiceId + Idempotency-Key на POST. (di-01, di-02, di-03)
5. **[M] Pre-call бюджетный предохранитель LLM** (hard-cap kill-switch + Redis MTD-счётчик) + метрика на price-miss. (llm-02, llm-05, cost-02)
6. **[L] Развести LLM/ASR/embeddings с единого домена agent-lia.ru** — secondary вне домена, fallback-ASR на независимой инфре, health-probe. (llm-01, llm-08)
7. **[L] Безопасный дефолт авторизации:** Cookie+Tenant в APP_GUARD с opt-out + архитектурный тест через DiscoveryService. (sec-01)
8. **[M] Гарантировать единое векторное пространство эмбеддингов** + тег провайдера. (kc-03)
9. **[M] Устранить дубликаты Entity:** partial unique на lower(canonicalName) + сериализация резолва. (kc-02)
10. **[M] Реальный алертинг очередей/cron + RED-метрики HTTP** — экспортёр BullMQ-метрик, cron-чекер инцидентов, единый QUEUE_REGISTRY, RED-interceptor. (obs-02, obs-06, wq-04, wq-05)
11. **[XL] Разбить мегамодули:** knowledge-core (фасад + под-модули), BusinessMetricsService (доменные метрик-модули), schema.prisma (prismaSchemaFolder); dependency-cruiser на границы. (arch-03, arch-04, arch-10, obs-01, obs-11)
12. **[L] Регрессионный quality-gate AI-ядра** (golden-set knowledge-core) — единственный предохранитель при self-improving агентах без human-in-loop. (qa-04)
13. **[L] Уйти от db push к ревьюируемому DDL + PITR/restore-test** (offsite-бэкап уже есть). (dm-01)
14. **[M] Pin IP при исходящих fetch** (устранить DNS-rebinding в webhook/slack/generic-senders). (sec-03)
15. **[M] Очистка осиротевших S3-объектов и висячих рёбер/ссылок графа** при удалении. (dm-02, dm-04, dm-05)
16. **[L] Перевести knowledge-core sweep-cron на BullMQ fan-out + вынести синхронные LLM из ingest; pgvector-side кластеризация.** (kc-05, kc-06, wq-02, cost-05)
17. **[M] Стриминг ffmpeg-обработки** + stop_grace_period + resource limits контейнеров. (wq-06, wq-07, ops-07)

---

## 8. Открытые вопросы к владельцу

1. **Сколько реплик backend в проде сейчас?** От этого зависит фактическая критичность дублирования кронов (arch-01, cost-04, wq-01) — при single-replica риск дремлющий, при 2+ уже активен.
2. **Prod-Postgres — managed (Yandex) или контейнер z-postgres из compose?** Конфиг и комментарии расходятся; влияет на критичность DR-стратегии и смысл healthcheck-gate. (ops-09)
3. **Реально ли задан ANTHROPIC_API_KEY в проде** (тогда Anthropic используется и память неверна) или это плейсхолдер? Меняет модель угроз исходящих данных. (arch-02, sec-08, dd-04)
4. **Включены ли в проде RETENTION_RAW_EVENTS/AUDIT/BLOCKS_ENABLED?** Код по дефолту false; если в проде true — cost-03 не активен.
5. **Есть ли в LlmTaskRoute (БД, редактируется из админки) хоть один route с anthropic/kie/grsai?** Это меняет реальную стоимость; в коде видна только дефолтная цепочка. (cost-12)
6. **Какова продуктовая стратегия по трём чат-поверхностям?** Свести к двум сущностям или оставить три? (pc-02)
7. **Классификация 97 модулей на «ядро / поддержка / спекуляция»** — какие домены замораживать ради фокуса на флагмане? (pc-06)
8. **Реестр «видимое, но 501/no-op»** — что скрыть за флагом до готовности, а что доделать в первую очередь (push событий, дайджесты)? (pc-05)

---

## 9. Приложение: методология

**Как делался аудит.** Аудит проводился чтением реального кода (не grep по памяти) по 14 областям: backend-архитектура, модель данных, knowledge-core, AI/LLM, воркеры/очереди/кроны, мультитенантность/безопасность, frontend, инфра/деплой/ops, наблюдаемость/надёжность, тестирование/качество, продуктовая когерентность, стоимость/масштабирование, целостность данных, дрейф документации. Каждая находка фиксировалась с конкретными file:line, затем проходила независимую верификацию: повторное чтение указанных файлов, проверка номеров строк, эмпирическая проверка поведения фреймворка где применимо, и присвоение вердикта (confirmed/partially-confirmed/refuted/unverified) с возможной коррекцией severity.

**Охват.** Прочитано ~150 файлов backend (модули ai, knowledge-core, billing, meetings, rbac, auth, crypto, retention, quotas, webhooks, logging, metrics, admin, embeddings, core-queue и др.), ключевые файлы frontend (api-client, contexts, layouts, proxy.ts, ключевые страницы), инфра (docker-compose, nginx, prometheus, grafana alerts, livekit), документация (CLAUDE.md, second-brain, prod-deploy-log), Prisma-схема и postgres-init.sql.

**Чем ограничен.** Аудит read-only: не было доступа к prod-окружению, реальному `.env`, размерам таблиц на проде, фактическому числу реплик. Поэтому оценки роста («десятки-сотни ГБ за год», «×10 тенантов») — экстраполяция по структуре кода, а не замеры. Часть находок помечена unverified именно потому, что требует прод-данных или чтения файлов вне выборки. Промпт аудита местами оперировал устаревшими цифрами (45 модулей, 119 @Cron) — фактические значения (97 модулей, ~160 @Cron) уточнены в ходе верификации.

### Проверено, не подтвердилось (refuted)

- **kc-01 «13 специалистов на одной очереди крадут чужие jobs» (заявлено critical).** Проблема описана как существующая, но в коде УЖЕ исправлена ровно тем способом, который сама находка рекомендует: один `SpecialistRoutingDispatcherWorker` на `core.specialist-routing` делегирует по `job.name` через `Map<string, SpecialistHandler>`; неизвестное имя → throw (job в failed, виден), а не молча completed. Есть регрессионный гард `specialist-routing-single-worker.guard.spec.ts`, падающий при >1 Worker на очереди. Исторический баг дословно задокументирован в JSDoc диспетчера как устранённый.
- **kc-04 «Переполнение Decimal(4,3) / evidenceCount-дрейф» (заявлено medium).** Опровергнуто по коду: неверная ссылка (block-ingest:751 — другой метод), а сам текст находки признаёт «переполнения нет». `avgConf` — выпуклая комбинация двух confidence из [0,1], всегда ∈ [0,1]. Найдены все места, трогающие IdeaBlockEvidence (ровно два, без удалений) — инвариант `evidenceCount == COUNT(evidence)` сохраняется по индукции. Остаётся лишь отсутствие явного reconcile-теста (low robustness-nitpick, не баг).
- **ops-03 «Единственная копия БД и бэкапов на ноде, нет offsite/restore-test» (заявлено critical).** Опровергнуто: находка ограничила grep областью `backend/scripts` и пропустила `infra/`. Существует `infra/scripts/backup-postgres.sh` (pg_dump → AES → `aws s3 cp` в Selectel), ежедневный крон `infra/cron/backup-postgres.cron`, lifecycle-retention 14 дней (`infra/selectel/lifecycle-policy.json`), `restore-postgres.sh` + runbook + еженедельный restore-test на staging. Остаточное зерно (нет PITR/streaming-реплики, restore-test ручной) — это low-улучшения, а не «данные не защищены».
- **qa-02 «Нет ни одного теста на межтенантную изоляцию» (заявлено critical).** Опровергнуто: существует suite на живом Postgres — `fixtures.ts` создаёт две Org, сеет данные в одну; `blocks.controller.spec.ts`/`entities.controller.spec.ts`/`graph.controller.spec.ts`/`themes.controller.spec.ts` проверяют, что userB с X-Org-Id=orgB читает данные orgA → NotFound, причём с `makeRbacAllowAll()` (доказывает фильтр tenantId именно в where-условии сервиса, а не в guard'е). Остаточный валидный gap: реальная-БД изоляция не покрыта для meetings/cards/documents/persons — улучшение низкого приоритета, не critical-дыра.

### Требует проверки (unverified)

Следующие находки не прошли независимую верификацию (не хватило времени/файлов вне выборки) и требуют подтверждения чтением кода: arch-07, arch-08, arch-09, arch-10, dm-07, dm-08, dm-09, kc-09, kc-10, kc-11, llm-09, llm-10, llm-11, llm-12, wq-08, wq-09, wq-10, wq-11, wq-12, sec-07, sec-08, sec-09, fe-06, fe-07, fe-08, fe-09, fe-10, obs-09, obs-10, obs-11, obs-12, ops-09, ops-10, ops-11, ops-12, di-06, di-07, di-08, di-09, pc-06, pc-07, pc-08, cost-09, cost-10, cost-11, cost-12, dd-06, dd-07, dd-08, dd-09, dd-10, qa-09, qa-10, qa-11. Среди них наиболее приоритетны для проверки: **obs-09** (PII в логах — 152-ФЗ-релевантно), **obs-10** (нет unhandledRejection-хуков — необработанный промис валит весь процесс с HTTP+воркерами), **di-06** (бесплатные встречи для мультиоргов — утечка выручки), **sec-09** (switch-org без смены контекста сессии), **fe-07** (org-admin-функции в super_admin-группе).