---
type: tz
status: draft
feature: Демо-режим (демо-кабинет) для новых Org без оплаты — универсальные маркетинговые фикстуры, бейдж в UI, disabled-кнопки реальных операций, авто-стирание данных при переходе в ACTIVE
date: 2026-05-25
relates_to:
  - plans/analysis/2026-05-25-billing-and-referrals.md
  - plans/tz/2026-05-25-billing-and-referrals-tz.md
  - plans/tz/2026-05-25-inn-lookup-tz.md
  - second-brain/01_projects/ai-analysis-by-type.md
  - second-brain/02_architecture/knowledge-core.md
depends_on:
  - 2026-05-25-billing-and-referrals-tz.md (модель Subscription и событие SubscriptionStatusChanged)
---

# ТЗ: Демо-кабинет для новых Org

> Анализ-источник: `plans/analysis/2026-05-25-billing-and-referrals.md` (Часть 2 «Регистрация компании и демо-режим»).
> Это ТЗ #2 из связки трёх (см. таблицу в Части 10 анализа).

## Цель

После регистрации новой Org (через ИНН) её кабинет сразу заполнен универсальным набором маркетинговых демо-данных (встречи, отчёты, граф знаний, темы, клоны ролей, дашборд директора за месяц), помечен бейджем «Режим демокабинета», все кнопки реальных операций disabled с подсказкой «доступно после оплаты»; при первой смене статуса подписки на `ACTIVE` (оплата или бонус) демо-данные автоматически и без следа удаляются.

## Scope

**Входит:**

- Новый Nest-модуль `backend/src/modules/demo-mode/` с двумя сервисами: `DemoSeedService` (наполнение) и `DemoCleanupService` (стирание).
- База фикстур (универсальный набор для всех новых Org) — отдельный файл-источник правды; см. раздел «Генерация».
- Поле-флаг `isDemo: Boolean @default(false)` на всех моделях, которые наполняются (см. раздел «Контент»), плюс индексы для быстрого cleanup.
- Backend-интеграция: вызов `DemoSeedService.seed(tenantId)` сразу после создания Org в потоке регистрации (точку расширения предоставляет ТЗ #1 — `orgs/registration`-pipeline).
- Backend-интеграция: `@OnEvent('subscription.status_changed')` слушатель → если переход `DEMO → ACTIVE` → вызов `DemoCleanupService.cleanup(tenantId)` в воркере (BullMQ-очередь `demo.cleanup`).
- Frontend: бейдж «Режим демокабинета» в `AuthenticatedShell` (виден на всех страницах для `subscription.status === 'DEMO'`).
- Frontend: единый компонент-обёртка `DemoLockedAction` для disabled-кнопок реальных операций с tooltip «Доступно после оплаты тарифа. [Выставить счёт]».
- Frontend: ревизия всех страниц (см. раздел «Frontend matrix» ниже) — кнопки реальных операций обёрнуты в `DemoLockedAction`.
- Тесты: unit на сервисы, e2e «регистрация → демо → ACTIVE → cleanup».

**Не входит:**

- Сам FSM подписки и переход `DEMO → ACTIVE` — это ТЗ #1 (`2026-05-25-billing-and-referrals-tz.md`). В этом ТЗ только подписка на событие `subscription.status_changed`.
- API по ИНН и сам поток регистрации (включая создание Org / Subscription) — это ТЗ #3 (`2026-05-25-inn-lookup-tz.md`). В этом ТЗ только точка расширения «после создания Org вызвать seed».
- Биллинг, генерация счетов, реферальная программа (отдельные модули в ТЗ #1).
- Демо-режим для уже существующих Org (миграция исторических Org не требуется — все они уже на `tier_pro` и будут переведены ТЗ #1 в `ACTIVE` `paid` или `bonus`).
- Поток «выйти из демо без оплаты» (демо длится бесконечно до первой оплаты/бонуса).

---

## Принципы демо-данных

1. **Маркетинговая подача — «живая компания на 30 человек».** Демо-кабинет должен убеждать с первого экрана: разделы наполнены, графики имеют тренды (рост недели к неделе, сезонность), есть свежие записи «за сегодня» и исторические «за месяц». Никаких lorem ipsum, никаких пустых заглушек.
2. **Единый универсальный набор.** Все новые Org получают одни и те же фикстуры. Это позволяет владельцу заранее проверить, что «всё красиво», не отлаживать каждый запуск.
3. **Изоляция через `isDemo`-флаг.** Каждая создаваемая сущность получает `isDemo=true`. Cleanup идёт ровно по этому флагу — никакой эвристики по датам, никакого «удалить всё кроме owner'а». Реальные данные клиента демо-стиратель не увидит даже теоретически.
4. **Изоляция через `tenantId`.** Стандартный `TenantGuard` уже не пропускает чужие Org. Демо-данные одной Org из-под другой Org не видимы — `isDemo` не пробивает изоляцию.
5. **Никаких внешних эффектов.** Демо-данные не вызывают LiveKit, ASR, embedding-провайдеров, S3, webhook'ов, не отправляют push/email. Все «отчёты» и «embedding'и» заранее зафиксированы в фикстуре как готовые JSON / pgvector-значения (либо `NULL` — для тех полей, где это переживёт UI).
6. **Маппинг внешних связей — синтетические User'ы.** Все ссылки `Meeting.ownerId`, `Person.userId`, `Membership.userId` ведут на одного-двух «фейковых» демо-`User`'ов с `isDemo=true` (НЕ на реального owner'а Org — иначе при cleanup нельзя будет отличить демо-связь от реальной). Реальный owner Org в демо-данных не участвует.
7. **Реалистичность.** Имена сотрудников — узнаваемые русские (Иванов, Петрова, Сидоров, Морозова и т.п.). Отделы — типовые (Продажи, Маркетинг, Продукт, Разработка, Операции, HR). Темы — узнаваемые бизнес-сюжеты (запуск B2B-тарифа, проблема с воронкой продаж, найм middle-разработчика, ретеншен корпоративных клиентов, перенос инфраструктуры).
8. **Версионирование.** Файл-фикстура имеет поле `fixtureVersion: number`. При обновлении схемы Prisma (поломавшем фикстуру) — bump версии, регенерация, повторный e2e-тест. На самом флаге `Org.demoFixtureVersion` фиксируется, какая версия применена к этой Org (для будущей сверки).

---

## Контент

### Сущности, которые наполняем

| Сущность Prisma | Кол-во | Что наполняем | Изолируется |
|---|--:|---|---|
| `User` (тех. демо-пользователи) | 6 | По одному на каждого «сотрудника-главного спикера» демо-встреч; email `demo-user-N@kora-demo.local`, пароль не задаётся (login невозможен) | `isDemo=true`, `email` начинается с `demo-` |
| `Membership` | 6 | Привязка демо-User'ов к Org с ролями `owner/admin/manager/member` (распределённо) | `isDemo=true` |
| `Person` | 30 | 30 сотрудников: имя, email, primaryDepartmentId, relationship='employee', knowledgeProfile (JSON), profileBuildVersion=1 | `isDemo=true` |
| `Department` | 6 | Продажи, Маркетинг, Продукт, Разработка, Операции, HR — с headPersonId | `isDemo=true` |
| `Role` | 12 | По 2 типовые должности на отдел | `isDemo=true` |
| `Meeting` | 30 | По встречи разного типа: 9 типов из `ai-analysis-by-type.md` × среднее 3-4 встречи на тип, распределены за 30 дней (с трендом «больше во вторник-четверг») | `isDemo=true`, `tenantId` Org |
| `MeetingReport` / `AiResult` | 30 | По одному отчёту на встречу, под её тип (заранее зафиксированный markdown + structured_data) | `isDemo=true` |
| `RawEvent` | 30 | По одному на встречу (источник `meeting`), payload — заранее зафиксированный диалог | `isDemo=true` |
| `IdeaBlock` | 200 | Покрывают 5–10 сюжетных линий; signalType распределён по всем 19 значениям (decision/insight/pain/idea/reasoning и т.д.); `status='canonical'` | `isDemo=true`, индекс `(tenantId, isDemo)` |
| `IdeaBlockEvidence` | 400 | По 2 evidence на блок в среднем, ссылаются на демо-RawEvent | `isDemo=true` |
| `Entity` | 50 | 12 типов (person/customer/vendor/project/product/topic/...); canonicalName реалистичный | `isDemo=true` |
| `IdeaBlockEntity` | 600 | M:M связи блок ↔ сущность | через `IdeaBlock.isDemo` каскадом |
| `IdeaBlockLink` | 500 | Плотный граф между блоками; relationType всех 7 типов | через `IdeaBlock.isDemo` |
| `EntityLink` | 100 | Связи сущностей | через `Entity.isDemo` |
| `Theme` | 10 | Сюжетные темы (запуск тарифа, воронка продаж, найм и т.д.); branch=strategy/clients/sales/... | `isDemo=true` |
| `ThemeIdeaBlock` / `ThemeEntity` | ~300 / ~80 | Привязка блоков и сущностей к темам | каскадом через `Theme.isDemo` |
| `Card` | 8 | По одной карточке на тип (client/deal/project/topic/vendor/custom) | `isDemo=true` |
| `Decision` | 15 | Записанные решения с rationale; статусы approved/implemented/superseded | `isDemo=true` |
| `Insight` | 10 | Insight-радар: 3 pain, 2 risk, 2 churn_risk, 3 objection с frequency/dynamic | `isDemo=true` |
| `Idea` | 12 | 8 internal + 4 client_request; статусы captured/under_review/accepted | `isDemo=true` |
| `IdeaCluster` | 3 | Кластеры идей | `isDemo=true` |
| `SkillProfile` | 5 | Профили навыков ключевых сотрудников | `isDemo=true` |
| `SkillTrait` | 50 | По 10 черт на профиль | каскадом через `SkillProfile.isDemo` |
| `ExecutablePersona` | 5 | Клоны ролей: Маркетолог, Продажник, Продуктовый менеджер, Разработчик, Операционный директор (`scope='role'`, `publicName` заполнен) | `isDemo=true` |
| `Goal` | 6 | OKR / KPI отделов | `isDemo=true` |
| `ProbeEvent` | 20 | События дашборда директора (на разные даты), `status='dispatched'` | `isDemo=true` |
| `Notification` (опц.) | 10 | Свежие уведомления для главной | `isDemo=true` |

**Итого порядок: ~1900 строк во вставке** — приемлемо для одной транзакции (PostgreSQL это переварит за единицы секунд).

### Чего НЕ заполняем

- Реальных файлов в S3 (`Recording.objectKey` оставляем `NULL` или ссылку на статическую «демо-запись» в публичном бакете — TODO согласовать с владельцем; на старте — `NULL` и UI рендерит «запись недоступна в демо»).
- Аудио-дорожек / LiveKit-комнат / Egress.
- `Webhook` / `IntegrationDestination` / реальных `Source` (Telegram/Email/Call/WebForm) — никаких внешних подписок.
- `PushSubscription` / email-получателей — никаких push/email на демо-User'ов.
- `embedding`-векторов pgvector — оставляем `NULL`. UI на чтение не падает (поиск/чат не работают в демо — кнопки disabled). Это экономит ~10 МБ на Org и устраняет зависимость от embedding-провайдера при seed.
- `AuditLog` / `AiUsageLog` — нет реальных вызовов, нет и логов.

### Frontend matrix (где блокировать реальные операции)

Из всех страниц `(authenticated)/` перечисляем те, где есть кнопки/формы реальных операций. У каждой такой кнопки — обёртка `DemoLockedAction`.

| Раздел | Кнопки/формы, которые блокируем |
|---|---|
| `/dashboard/meetings/new`, любая «Создать встречу» | «Создать встречу», «Запустить встречу сейчас» |
| `/dashboard/meetings/[id]` | «Подключиться к комнате», «Начать запись» (host), «Сгенерировать дополнительный отчёт» |
| `/dashboard/sources` (Telegram/Email/Call/WebForm) | «Подключить источник», «Импортировать» |
| `/dashboard/knowledge/chat` (AI-чат) | «Отправить запрос» — поле отключено |
| `/clones/[id]` | «Спросить клона», «Обновить клона сейчас» (Trigger 1, после ТЗ clone-reliability) |
| `/dashboard/cards/[id]` | «Добавить заметку», «Связать с встречей», «Запустить rollup» |
| `/dashboard/decisions/new` | «Сохранить решение» |
| `/dashboard/ideas/new` | «Подать идею» (если ручной ввод предусмотрен) |
| `/settings/integrations` | «Сгенерировать API-ключ», «Подключить webhook» |
| `/settings/members` | «Пригласить сотрудника» |
| `/settings/billing` | **НЕ блокируем** — выставление счёта в демо доступно (см. анализ §2.3, §2.5) |
| `/referrals` | **НЕ блокируем** — реферальный функционал доступен в демо (см. анализ §3.1) |

Для остальных страниц (просмотр графа, тем, дашборда директора, отчётов по встречам, статистики, профилей сотрудников) — никаких блокировок: всё показывается как есть.

---

## Генерация

Это центральная часть ТЗ. Сравниваем два подхода и фиксируем рекомендацию.

### Вариант A — LLM-промпт + JSON-фикстура в репозитории

**Идея.** Один раз пишем большой промпт для языковой модели (DeepSeek V4 Pro или GPT-5.4), который описывает компанию, отделы, сотрудников, 30 встреч, 200 блоков, 10 тем, 5 клонов и т.д. Прогоняем промпт, получаем JSON-файл. Коммитим JSON в `backend/src/modules/demo-mode/fixture/demo-fixture.v1.json`. На рантайме `DemoSeedService` читает JSON и вставляет в БД.

**Плюсы.**

- Контент получается живым, неоднородным, маркетингово-убедительным — модель напишет реалистичные диалоги и формулировки блоков лучше, чем человек вручную.
- 1 раз сделал — забыл. Регенерация только при изменении схемы.
- Промпт сам по себе документирует «как должен выглядеть демо».
- Легко итерировать: «добавь больше cancel'нутых сделок», «сделай Маркетолога более конкретным».

**Минусы.**

- JSON-файл — ~1–2 МБ, в git хранится, в diff'ах нечитаем (но это акцептабельно — мы его не правим вручную).
- Зависимость от LLM на этапе генерации (один раз) — нужен ключ, нужно проверять качество.
- Сложнее ссылаться на типы TypeScript: JSON свободен, при изменении схемы Prisma поломка не словится компилятором, только e2e-тестом.

### Вариант B — Hardcoded TypeScript-фикстура

**Идея.** Пишем `backend/src/modules/demo-mode/fixture/demo-fixture.v1.ts` руками — массивы объектов с типизацией от Prisma-клиента. `DemoSeedService` просто разворачивает массивы в БД.

**Плюсы.**

- Полная типизация: при ALTER TABLE в Prisma TypeScript сразу красным подсветит сломанные места.
- Чистый git diff, легко ревьюить, легко править по месту.
- Никакой зависимости от LLM.

**Минусы.**

- Писать вручную 200 IdeaBlock + 500 IdeaBlockLink + 30 диалогов встреч — это **2–4 человеко-дня** скучной работы. Контент получится либо однообразным, либо некачественным.
- Высокий порог поддержки: «добавить ещё 20 блоков» — снова руками.
- Маркетинговая убедительность ниже (человек не напишет 30 разных правдоподобных встреч за разумное время).

### Рекомендация — гибрид A + B (взять лучшее из обоих)

**Промпт-генератор (A) для контента + типизированный loader (B) для вставки.**

1. **Фикстура хранится как JSON** (`demo-fixture.v1.json`), но с обязательной **Zod-схемой** `DemoFixtureSchema` рядом (`demo-fixture.schema.ts`).
2. На старте приложения (один раз, в unit-тесте) JSON прогоняется через Zod — если структура не сошлась со схемой, тест валится. Это даёт типобезопасность не хуже варианта B.
3. **Zod-схема выводится из Prisma-моделей** через типы (`Prisma.MeetingCreateInput` и т.д.) — изменили Prisma → пересобрали Zod → JSON начал валиться → перегенерировали JSON LLM-промптом → закоммитили.
4. **Промпт-генератор** — отдельный скрипт `backend/scripts/generate-demo-fixture.ts` (НЕ запускается ни на CI, ни в проде; зовётся вручную разработчиком при обновлении). Промпт лежит рядом — `prompts/demo-fixture-generator.prompt.ts`, версионируется как обычный промпт-агент.
5. **Загрузка в БД** — типизированный `DemoSeedService` (B-стиль), на вход — провалидированная фикстура.

**Итог рекомендации:** хранение и наполнение — JSON + Zod (как в A), но с runtime-валидацией под типы Prisma и гарантией компилятора, что loader не сломается при изменении схемы (как в B). Промпт-генератор переиспользует существующий `LlmRouterService` через тот же `LlmTaskRoute`-механизм; задача-`taskType` — `demo-fixture-generate` (primary `deepseek:deepseek-v4-pro`, JSON Schema strict).

---

## Технические изменения

### Backend

**Новый модуль `modules/demo-mode/`:**

- `demo-mode.module.ts` — Nest-модуль, регистрирует BullMQ-очередь `demo.cleanup` (через `BullModule.registerQueue`).
- `services/demo-seed.service.ts` — `seed(tenantId, ownerUserId): Promise<DemoSeedResult>`. Транзакционная вставка всей фикстуры. Возвращает счётчики по типам.
- `services/demo-cleanup.service.ts` — `cleanup(tenantId): Promise<DemoCleanupResult>`. Удаляет всё, помеченное `isDemo=true` в рамках `tenantId`, в правильном порядке зависимостей. Тоже транзакционно.
- `services/demo-fixture-loader.service.ts` — чтение `demo-fixture.v1.json` + валидация Zod-схемой.
- `fixture/demo-fixture.v1.json` — данные.
- `fixture/demo-fixture.schema.ts` — Zod-схема.
- `workers/demo-cleanup.worker.ts` — consumer очереди `demo.cleanup` (concurrency=1).
- `listeners/subscription-status.listener.ts` — `@OnEvent('subscription.status_changed')`, фильтрует переход `DEMO → ACTIVE`, ставит job в `demo.cleanup`.
- `prompts/demo-fixture-generator.prompt.ts` — промпт LLM-генератора (используется только скриптом `generate-demo-fixture.ts`).
- `demo-mode.controller.ts` (только админ-API):
  - `POST /api/v1/admin/orgs/:tenantId/demo/seed` — ручной seed (для повторного наполнения при тесте; только `super_admin`).
  - `POST /api/v1/admin/orgs/:tenantId/demo/cleanup` — ручной cleanup (для отладки; только `super_admin`).
  - `GET /api/v1/admin/orgs/:tenantId/demo/status` — `{ isDemo: boolean, fixtureVersion: number | null, counts: Record<string, number> }`.

**Изменения существующих модулей:**

- `orgs/orgs.service.ts` — после `prisma.org.create()` в регистрационном flow (приходит из ТЗ #3 inn-lookup) вызывается `DemoSeedService.seed(org.id, ownerUserId)`. Вызов синхронный (внутри той же транзакции регистрации) — для тестируемого и предсказуемого UX. Если seed падает — регистрация откатывается, пользователь видит «Не удалось создать кабинет, повторите попытку».
- `billing/subscription.service.ts` (ТЗ #1) — при переходе `DEMO → ACTIVE` эмитит событие `subscription.status_changed` (контракт: `{ tenantId, oldStatus: 'DEMO', newStatus: 'ACTIVE', paymentMode: 'paid' | 'bonus' }`). Подписчик `subscription-status.listener.ts` ставит job в `demo.cleanup`.

**Скрипт-генератор:**

- `backend/scripts/generate-demo-fixture.ts` — one-off скрипт (см. `safe-seed-rules`); читает промпт, вызывает `LlmRouterService.execute({ taskType: 'demo-fixture-generate', ... })`, валидирует ответ Zod-схемой, пишет в `demo-fixture.v1.json` (`--write`) или печатает diff (`--check`). НЕ запускается на CI.

**Новые BullMQ-очереди:**

- `demo.cleanup` — фоновое удаление демо-данных. Concurrency=1 (избегаем гонки внутри одной Org). idempotent — повторный запуск ничего не ломает (DELETE WHERE isDemo=true возвращает 0).

### База данных

**Новое поле `isDemo: Boolean @default(false)` добавляется в следующие модели:**

`Org`, `User`, `Membership`, `Person`, `Department`, `Role`, `Meeting`, `MeetingReport`, `AiResult`, `RawEvent`, `IdeaBlock`, `Entity`, `IdeaBlockLink`, `EntityLink`, `Theme`, `Card`, `Decision`, `Insight`, `Idea`, `IdeaCluster`, `SkillProfile`, `SkillTrait`, `ExecutablePersona`, `Goal`, `ProbeEvent`, `Notification`.

> **На `IdeaBlockEvidence`, `IdeaBlockEntity`, `ThemeIdeaBlock`, `ThemeEntity` `isDemo` НЕ добавляем** — у них есть FK с `onDelete: Cascade` от родителя (`IdeaBlock`/`Theme`/`Entity`), и при удалении родителя они уберутся автоматически. Это экономит индексы.

**Новое поле в `Org`:**

- `demoFixtureVersion: Int?` — версия фикстуры, применённой к этой Org (`NULL` для не-демо Org и Org, прошедших cleanup). Заполняется в `DemoSeedService`, обнуляется в `DemoCleanupService`.

**Индексы:**

- `@@index([tenantId, isDemo])` — на `IdeaBlock`, `Entity`, `Meeting`, `Person` (самые большие таблицы; ускоряет DELETE).
- Для остальных моделей с `isDemo` — достаточно существующих индексов по `tenantId` (объём данных небольшой, full scan по tenant приемлем).

**Миграция:**

- `bun run prisma:push` (не `migrate`, см. `prisma-db-push-rules`). Все добавления — nullable / с default=false → совместимы.
- `bun run prisma:generate` после правки моделей.

### Frontend

**Новые компоненты:**

- `frontend/src/ui/components/demo-mode/DemoBadge.tsx` — бейдж «Режим демокабинета» в шапке `AppShell` (рядом с логотипом или в правом верхнем углу). Тёплый янтарный цвет, кликабелен → ведёт на `/settings/billing`.
- `frontend/src/ui/components/demo-mode/DemoLockedAction.tsx` — обёртка над любой кнопкой/формой. API:
  ```tsx
  <DemoLockedAction tooltipReason="meeting-create">
    <Button onClick={openCreateMeetingModal}>Создать встречу</Button>
  </DemoLockedAction>
  ```
  Если контекст `subscription.status === 'DEMO'` — кнопка рендерится как `disabled`, при наведении показывает tooltip «Доступно после оплаты тарифа. Выставить счёт» со ссылкой на `/settings/billing`.
- `frontend/src/contexts/demo-mode-context.tsx` — провайдер, читает `subscription` (из `entitlement-context`, расширяемого в ТЗ #1) и пробрасывает флаг `isDemo` вниз по дереву. Помещается в `AuthenticatedShell` рядом с `EntitlementProvider`.

**Изменения существующих:**

- `frontend/app/(authenticated)/AuthenticatedShell.tsx` — оборачивает `<AppShell>` в `<DemoModeProvider>`, в шапку `<AppShell>` добавляется `<DemoBadge />` (рендерится условно по контексту).
- Все страницы из «Frontend matrix» выше — кнопки реальных операций оборачиваются в `<DemoLockedAction>`.

**Локализация:**

- Все тексты на русском (см. `feedback_admin_ui_russian_only`). Терминология: «демо-кабинет», «режим демокабинета» (не «sandbox», не «trial»).

### Интеграции

**Внешние сервисы:** нет.

**Очереди / воркеры:**

- `demo.cleanup` (BullMQ, concurrency=1) — фоновое стирание демо-данных по событию `subscription.status_changed`.

**События:**

- Подписка на `subscription.status_changed` (эмитится модулем `billing` из ТЗ #1).
- Эмитит `demo.cleaned` (`{ tenantId, removedCounts }`) после успешного cleanup — для аудита, ApplicationLogger логирует.

### Конфигурация

- `cfg.demoMode.enabled: boolean` (default `true`) — глобальный kill-switch. На локальной разработке можно выключить, чтобы не наполнять кабинет каждый раз.
- `cfg.demoMode.fixtureVersion: number` (default `1`) — какую версию фикстуры брать. Под мониторингом, поднимается со сменой фикстуры.
- `cfg.demoMode.cleanupTimeoutMs: number` (default `60_000`) — таймаут одной cleanup-транзакции.

---

## Endpoint'ы

| Метод | Путь | Доступ | Body | Ответ |
|---|---|---|---|---|
| `POST` | `/api/v1/admin/orgs/:tenantId/demo/seed` | super_admin | `{}` | `{ ok: true, counts: Record<string, number>, fixtureVersion: number }` |
| `POST` | `/api/v1/admin/orgs/:tenantId/demo/cleanup` | super_admin | `{}` | `{ ok: true, removedCounts: Record<string, number> }` |
| `GET` | `/api/v1/admin/orgs/:tenantId/demo/status` | super_admin | — | `{ isDemo: boolean, fixtureVersion: number \| null, counts: Record<string, number> }` |

> Обычные endpoint'ы реальных операций (создание встречи, AI-чат и т.д.) — этим ТЗ не меняются на бэкенде: блокировка делается фронтом (`DemoLockedAction`). На бэке достаточно того, что в демо-режиме нет реальных подключений источников/LiveKit и `entitlements`-квоты `meetings_per_month` равны 0 (статус подписки `DEMO` — фактический gate уже в ТЗ #1). Дополнительной проверки в этом ТЗ не вводим, чтобы не дублировать логику.

---

## Принципы реализации DemoCleanupService

Порядок удаления критичен (FK-зависимости). Идём от листьев к корням:

1. `Notification`, `ProbeEvent` — листья без зависимых.
2. `MeetingReport`, `AiResult`, `RawEvent`, `Meeting` (cascade чистит `Participant`, `Recording`, `Transcript`, `Tasks`, `Chapters`, etc.).
3. `IdeaBlockLink`, `EntityLink`, `Theme` (cascade чистит `ThemeIdeaBlock`, `ThemeEntity`).
4. `IdeaBlock` (cascade чистит `IdeaBlockEvidence`, `IdeaBlockEntity`, `IdeaBlockAxisLabel`).
5. `Decision`, `Insight`, `Idea`, `IdeaCluster`.
6. `Card`.
7. `SkillTrait`, `ExecutablePersona`, `SkillProfile`.
8. `Entity` (cascade чистит `Vendor`, `Event`, `Goal`-Entity-линк и т.д. — те, что были созданы как демо).
9. `Goal`.
10. `Role`, `Person` (cascade чистит `PersonRole`, `Appointment`).
11. `Department`.
12. `Membership` демо-User'ов.
13. `User` (только тех, у кого `isDemo=true`).
14. `Org.demoFixtureVersion = NULL`.

Каждый шаг — `prisma.<model>.deleteMany({ where: { tenantId, isDemo: true } })`. Транзакция одна. Лимит — `cfg.demoMode.cleanupTimeoutMs`.

**Идемпотентность:** повторный вызов не упадёт — `deleteMany` вернёт `count: 0`. Если worker упал на полпути — повторная постановка job'а добьёт остатки.

---

## Критерии готовности (DoD)

### Глобальный DoD ТЗ

- [ ] Регистрация новой Org (через flow из ТЗ #3) → у Org сразу есть все 9 типов встреч, граф знаний, темы, клоны, дашборд.
- [ ] На любой странице, кроме `/settings/billing` и `/referrals`, бейдж «Режим демокабинета» видимый.
- [ ] Все кнопки реальных операций из «Frontend matrix» — disabled с tooltip'ом.
- [ ] Симуляция оплаты (super_admin вручную → `ACTIVE`) → через ≤30 секунд кабинет пуст (никаких демо-сущностей), бейдж исчез, кнопки работают.
- [ ] При попытке зайти в Org A из-под пользователя Org B демо-данные Org A не видны (стандартный `TenantGuard`-тест).
- [ ] e2e-тест прошёл целиком (см. «Фаза 7»).
- [ ] Second Brain обновлён: `01_projects/demo-mode.md` (новый файл) + ссылка из `02_architecture/module-map.md`.

---

## Фазы реализации

### Фаза 1 — Prisma: `isDemo`-флаги и индексы

- [ ] Добавить `isDemo Boolean @default(false)` в 26 моделей (см. список выше).
- [ ] Добавить `Org.demoFixtureVersion Int?`.
- [ ] Добавить `@@index([tenantId, isDemo])` на `IdeaBlock`, `Entity`, `Meeting`, `Person`.
- [ ] `bun run prisma:push` + `bun run prisma:generate`.
- [ ] `bun run typecheck` зелёный.

**DoD фазы 1:** все 26 моделей имеют поле `isDemo`, `Org` имеет `demoFixtureVersion`, индексы созданы, типы TypeScript обновлены, билд проходит.

---

### Фаза 2 — Генерация фикстуры (промпт + JSON + Zod-схема)

- [ ] Написать `backend/src/modules/demo-mode/fixture/demo-fixture.schema.ts` — Zod-схема всей фикстуры (вложенная, типы соответствуют `Prisma.<Model>CreateInput`).
- [ ] Написать `prompts/demo-fixture-generator.prompt.ts` — текст промпта (русский, с примерами компании на 30 человек, 9 типов встреч, 5 клонов).
- [ ] Зарегистрировать `LlmTaskRoute { taskType: 'demo-fixture-generate', primary: 'deepseek:deepseek-v4-pro', secondary: 'openai-via-proxy:gpt-5.4', responseFormat: 'json_object' }` через seed-скрипт `seed-llm-task-routes-demo-mode.ts`.
- [ ] Реализовать `backend/scripts/generate-demo-fixture.ts` — one-off скрипт; вызывает LLM, валидирует ответ, пишет в `demo-fixture.v1.json`.
- [ ] Прогнать скрипт вручную, итерировать промпт до получения корректного JSON (≥1900 сущностей, Zod-валидация зелёная).
- [ ] Закоммитить `demo-fixture.v1.json` в репо.
- [ ] Unit-тест `demo-fixture.spec.ts` — читает JSON, проверяет Zod-валидацию, проверяет инварианты (30 встреч, 9 типов представлены, 200 IdeaBlock, 5 клонов с разными `publicName`).

**DoD фазы 2:** `demo-fixture.v1.json` существует в репо, Zod-валидация проходит, инварианты по количеству и типам сущностей проверены unit-тестом.

---

### Фаза 3 — `DemoSeedService` + интеграция в регистрацию

- [ ] Реализовать `DemoSeedService.seed(tenantId, ownerUserId)` — транзакционная вставка фикстуры в правильном порядке (см. «Принципы реализации» инвертно для seed: сначала корни — User/Department, потом листья).
- [ ] Все вставленные сущности — `isDemo=true`, `tenantId=tenantId`.
- [ ] Создать `demo-fixture-loader.service.ts`.
- [ ] Демо-User'ы получают email `demo-user-N+@kora-demo.local` (уникальный по Org через salt с `tenantId`-хэшем).
- [ ] Интеграция в `OrgsService.create` (точка расширения из ТЗ #3) — после успешного создания Org вызвать `DemoSeedService.seed`.
- [ ] Admin-endpoint `POST /admin/orgs/:tenantId/demo/seed`.
- [ ] Unit-тест: моки Prisma, проверка порядка вставки и `isDemo=true` на каждом write'е.
- [ ] Интеграционный тест на dev-БД: вызвать seed → проверить через raw SQL что вставились нужные count'ы.

**DoD фазы 3:** seed работает end-to-end в dev, новая Org через регистрационный flow получает полный набор фикстур, admin-endpoint доступен.

---

### Фаза 4 — `DemoCleanupService` + подписка на `subscription.status_changed`

- [ ] Реализовать `DemoCleanupService.cleanup(tenantId)` — транзакционное удаление в правильном порядке (см. «Принципы реализации DemoCleanupService»).
- [ ] Создать BullMQ-очередь `demo.cleanup` и worker `demo-cleanup.worker.ts`.
- [ ] Создать `subscription-status.listener.ts` — `@OnEvent('subscription.status_changed')`, при `DEMO → ACTIVE` enqueue cleanup-job.
- [ ] Admin-endpoint `POST /admin/orgs/:tenantId/demo/cleanup`.
- [ ] Idempotency: повторный enqueue не ломает; повторный cleanup возвращает `removedCounts: 0` по всем сущностям.
- [ ] Unit-тест: моки Prisma, проверка порядка удаления.
- [ ] Интеграционный тест: seed → cleanup → проверка `prisma.ideaBlock.count({ where: { tenantId, isDemo: true } }) === 0`.

**DoD фазы 4:** cleanup работает end-to-end, событие `subscription.status_changed` корректно ставит job, после ACTIVE кабинет пуст.

---

### Фаза 5 — Frontend: бейдж «Режим демокабинета»

- [ ] Расширить `entitlement-context.tsx` (или создать `demo-mode-context.tsx`) — пробрасывать `subscription.status` из API.
- [ ] Создать `DemoBadge.tsx` — рендерится в `<AppShell>` только когда `subscription.status === 'DEMO'`.
- [ ] Стилизация: тёплый янтарный, заметный, не мигает, кликабелен → `/settings/billing`.
- [ ] Mobile: бейдж адаптируется к компактному виду (только иконка + tooltip).
- [ ] Snapshot-тест Storybook (если есть) или RTL-тест: для `DEMO` бейдж рендерится, для `ACTIVE` — нет.

**DoD фазы 5:** бейдж видим на всех страницах `(authenticated)` для DEMO-Org, не виден после перехода в ACTIVE.

---

### Фаза 6 — Frontend: disabled-кнопки реальных операций

- [ ] Создать `DemoLockedAction.tsx` — обёртка, через контекст определяет `isDemo`; рендерит детей в `disabled`-состоянии с tooltip'ом.
- [ ] Пройтись по всем страницам из «Frontend matrix» — обернуть каждую кнопку/форму реальной операции.
- [ ] Тексты tooltip'ов — единый русский «Доступно после оплаты тарифа. Выставить счёт».
- [ ] Smoke-проверка: открыть демо-Org → проверить, что во всех перечисленных местах кнопка disabled и tooltip срабатывает.
- [ ] RTL-тесты на 2-3 ключевые страницы (создание встречи, AI-чат, подключение источника).

**DoD фазы 6:** во всех разделах «Frontend matrix» кнопки реальных операций disabled в демо; в `/settings/billing` и `/referrals` всё работает как обычно.

---

### Фаза 7 — Тесты: e2e «регистрация → демо → ACTIVE → cleanup»

- [ ] e2e-тест (Playwright) в `frontend/e2e/demo-mode.spec.ts`:
  1. Зарегистрировать новую Org (заглушка ИНН-lookup → синтетический ответ).
  2. После регистрации страница `/dashboard` показывает бейдж, разделы наполнены.
  3. Открыть `/dashboard/meetings/new` → кнопка «Создать встречу» disabled с tooltip'ом.
  4. Открыть `/clones` → видны 5 клонов (Маркетолог, Продажник, Продуктовый менеджер, Разработчик, Операционный директор).
  5. Через admin-API `POST /admin/orgs/:tenantId/billing/activate` (моделируем ручной переход в `ACTIVE`) → ждём ≤30 секунд.
  6. Открыть `/dashboard` снова → бейдж исчез, все разделы пусты.
  7. Открыть `/dashboard/meetings/new` → кнопка «Создать встречу» enabled.
- [ ] Backend integration test `demo-mode.spec.ts`:
  - seed → cleanup → second seed (для проверки idempotency).
  - cross-tenant: создать Org B, проверить что демо-сущности Org A не видны под пользователем Org B.
  - Edge: cleanup упал на полпути (симулируем `prisma.<model>.deleteMany` throw на 5-м шаге) → повторный enqueue добивает остатки.

**DoD фазы 7:** e2e и интеграционные тесты зелёные, покрывают happy-path и обе edge-cases (cross-tenant, fail-resume).

---

## Edge-cases

| Кейс | Решение |
|---|---|
| Org перешла в `ACTIVE`, но пользователь не успел увидеть демо | Это акцептабельно: демо — маркетинговый каркас, после оплаты кабинет должен быть чистым. Если пользователь хочет посмотреть демо — `super_admin` может вручную пересеять через `POST /admin/orgs/:tenantId/demo/seed` (с предупреждением: «эта Org уже ACTIVE, демо-данные смешаются с реальными» — на самом деле не смешаются, потому что у демо-сущностей `isDemo=true`, но **бейдж не появится** — он привязан к `Subscription.status`, а не к `isDemo`). Решение: admin-seed-endpoint **запрещён** для Org со статусом не `DEMO` (400). |
| Cleanup упал на полпути | Транзакция откатилась → данные остались в исходном состоянии (`isDemo=true`). Worker BullMQ retry (3 попытки с экспоненциальным backoff). Если 3 raза подряд упало — alerт на дашборд `super_admin`. На приёмной стороне эндпоинты приложения с `subscription.status === ACTIVE` НЕ блокируются за демо-данные — реальные операции уже доступны, демо-сущности просто рудимент, который чистится следующей попыткой. UI: бейдж исчезает по статусу подписки, не по факту cleanup. |
| Фикстура содержит FK на User → как маппим? | Создаём отдельных «демо-User»'ов в той же фикстуре (6 шт., с `isDemo=true`, `email=demo-user-N@kora-demo.local`, пароль не задан). Реальный owner Org в демо-сущностях не участвует. При cleanup эти User'ы удаляются вместе с остальным. |
| Фикстура устарела при обновлении схемы Prisma | Zod-схема падает при загрузке → unit-тест `demo-fixture.spec.ts` валится в CI → ответственный регенерирует JSON через `bun run scripts/generate-demo-fixture.ts --write`, прогоняет тесты, бампит `cfg.demoMode.fixtureVersion`. Существующие демо-Org остаются на старой версии (поле `Org.demoFixtureVersion`) до следующего seed'а или ручного резисева. |
| В фикстуре есть pgvector-`embedding`-поля | Оставляем `NULL`. Поиск/AI-чат в демо disabled (см. Frontend matrix), они единственные потребители embedding'ов. Граф знаний на просмотр (`/dashboard/knowledge/graph`) рендерится по link'ам, не по embedding'ам. |
| Параллельные регистрации (две Org одновременно) | seed работает в транзакции по своему `tenantId`. PostgreSQL обрабатывает параллельные транзакции независимо. Race-condition исключён. |
| Cleanup для Org, в которой уже было ручное добавление реальных данных в демо-режиме | Невозможно по дизайну: в `DEMO` все кнопки реальных операций disabled на фронте. Если кто-то полез через API (минуя UI) и добавил реальную встречу — у неё `isDemo=false` → cleanup её не тронет. То, что пометилось `isDemo=true` фикстурой — будет удалено. Это и есть страховка флага. |
| Super_admin вручную выдал `ACTIVE (bonus)` сразу при регистрации (минуя DEMO) | Тогда seed не вызывается (потому что `Subscription.status` сразу `ACTIVE`, не `DEMO`). Кабинет чистый — это нормальный сценарий. |
| Пользователь оплатил, кабинет очистился, через час передумал и потребовал refund | Это сценарий ТЗ #1 (rollback подписки). Если возврат включает `ACTIVE → DEMO` (не рекомендую, но если будет) — нужно ПЕРЕсеять. Решение: переход `ACTIVE → DEMO` НЕ предусмотрен FSM (см. ТЗ #1 §4.3); refund даёт переход в `EXPIRED` без возврата в `DEMO`. Демо-данные не воссоздаются. |

---

## Безопасность

- **Cross-tenant isolation:** все запросы на чтение демо-данных проходят `TenantGuard`. `isDemo=true` НЕ влияет на изоляцию — это просто маркер «эти данные мусорные/нужно стереть». Из под-пользователя Org B демо-сущности Org A не видны (стандартный `WHERE tenantId = orgB.id` отсечёт).
- **Утечка через демо-User'ов:** демо-User'ы имеют `isDemo=true`, пароль не задан, email на `@kora-demo.local` (несуществующий домен). Они не могут залогиниться. В `AuthService.login` добавить проверку `user.isDemo === false` (защита от взлома пароля по словарю — даже если злоумышленник подставит пароль `admin123`, демо-User в login не пустит).
- **Admin-endpoint'ы:** `POST /demo/seed` и `POST /demo/cleanup` доступны только `super_admin` (платформенный администратор Z), не `owner`/`admin` Org. Любая Org не должна иметь возможности самостоятельно перезапустить демо или стереть данные.
- **Уровень `dataClass`:** все демо-блоки помечаются `dataClass: 'internal'` (не `private`/`sensitive`). На случай если в будущем добавится фильтр «private не показывать кроме автора» — демо не сломает UI.

---

## Связь с ТЗ #1 (`2026-05-25-billing-and-referrals-tz.md`)

| Что приходит из ТЗ #1 | Что нужно этому ТЗ |
|---|---|
| Модель `Subscription` со статусами `DEMO/ACTIVE/PAST_DUE/SUSPENDED/CANCELED/EXPIRED` | Условие триггера cleanup (`DEMO → ACTIVE`). |
| Событие `subscription.status_changed` через `EventEmitter` | Подписчик `subscription-status.listener.ts`. |
| Регистрация Org с автосозданием `Subscription { status: DEMO }` | Точка вызова `DemoSeedService.seed` (внутри `OrgsService.create`). |
| Контекст подписки на фронте (через `entitlement-context` или новый `subscription-context`) | Источник флага `isDemo` для `DemoBadge` и `DemoLockedAction`. |
| Admin-endpoint `POST /admin/orgs/:tenantId/billing/activate` | Используется e2e-тестом для симуляции перехода `DEMO → ACTIVE`. |

**Сценарий совместного развёртывания:**

1. Сначала катится ТЗ #1 (на проде создаётся `Subscription` для всех существующих Org со статусом `ACTIVE (paid|bonus)`).
2. Потом катится этот ТЗ (на проде только для будущих Org — у существующих `Subscription.status !== DEMO`, seed не вызывается).
3. Потом катится ТЗ #3 (включается реальная регистрация по ИНН).

---

## Риски и ограничения

| Риск | Митигация |
|---|---|
| LLM-генерация выдаст некачественный JSON (повторяющиеся имена, нереалистичные диалоги, маркетинговая водянистость) | Промпт версионируется и итерируется до прохождения чек-листа (5 клонов с разными `publicName`, 9 типов встреч представлены, нет повторов имён сотрудников). Это разовые трудозатраты, окупаются. |
| Фикстура размером ~2 МБ замедляет seed | Транзакционная вставка в PostgreSQL ~1900 строк — единицы секунд. На регистрации это акцептабельно (UX «создаём ваш кабинет» с прогресс-баром). |
| `isDemo`-флаг забыт на одной из вставок — данные не вычищаются | Юнит-тесты `DemoSeedService` проверяют, что **на каждом `prisma.*.create*` стоит `isDemo: true`**. Линт-правило (или ручной checklist в PR-ревью). |
| Pre-merge обновление схемы Prisma (другая команда добавила NOT NULL поле в `Meeting`) — фикстура перестаёт валидироваться | `demo-fixture.spec.ts` валится в CI. Ответственный регенерирует фикстуру через LLM-промпт. Время фикса — час. |
| Cleanup долгий → пользователь видит «полупустой кабинет» в момент оплаты | Cleanup выполняется в фоне (очередь `demo.cleanup`, до 30 сек). UI обновляется через стандартный SWR-rerender при изменении подписки. Между «оплачено» и «всё стёрто» окно ~30 сек — пользователю покажется «обновляем кабинет», что приемлемо. |
| Демо-User просочился в почтовые рассылки / push | `isDemo=true` фильтруется во всех рассылочных сервисах. Конкретные точки правки — `NotificationDispatcher`, `EmailService`, `PushService` — добавляются как guard'ы в фазах 3-4. |

---

## Итог

_Заполняется по факту: реализовано целиком или нет, что осталось._
