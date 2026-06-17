---
type: decisions-log
feature: knowledge-core (Фазы 0–12)
status: living
date: 2026-05-10
---

# Журнал решений оркестратора

Здесь фиксируется каждое спорное / архитектурное решение, принятое оркестратором (Claude) без явного подтверждения пользователя — согласно режиму работы из [plans/archive/2026-05-10-knowledge-core-tz.md](plans/archive/2026-05-10-knowledge-core-tz.md) и команды от 2026-05-10 «решения принимай сам, в конце собери файл».

Формат записи: дата → вопрос → принятое решение → обоснование → как откатить.

---

## 2026-05-10 — Раздробление Фаз 7/8/9 в отдельные ТЗ

**Вопрос.** Фазы 7 (Z-Admin + Org-Admin), 8 (Дашборд директора) и 9 (Цели + strategic alignment) описаны в родительском `knowledge-core-tz.md` высокоуровнево (Фаза 7 — ~150 строк, Фазы 8/9 — по 30 строк). Передавать их агенту-исполнителю напрямую — мало (Фазы 8/9 без шагов и файлов) либо избыточно перемешано с другими фазами (Фаза 7).

**Решение.** Создаю **отдельные дочерние ТЗ** в `plans/tz/`:
- `plans/archive/2026-05-10-phase-7-admin.md` — Z-Admin + Org-Admin (9 шагов, schema/guards/services/controllers/UI).
- `plans/archive/2026-05-10-phase-8-director-dashboard.md` — Дашборд директора (6 шагов, role-based split).
- `plans/archive/2026-05-10-phase-9-goals-strategic-alignment.md` — Goal/strategic-alignment (9 шагов, новая модель + воркер + cron + UI + расширение Фазы 8).

В родительском `knowledge-core-tz.md` оставляем высокоуровневое описание + ссылку на дочернее ТЗ.

**Почему.**
- Каждое дочернее ТЗ self-contained — агент-исполнитель может работать без чтения остальных фаз.
- Лимит контекста агента не пропустит весь `knowledge-core-tz.md` (1497 строк) + код одновременно.
- Фазы 8 и 9 связаны (Фаза 9 расширяет дашборд из Фазы 8) — это явно зафиксировано в каждом ТЗ.
- Формат идентичен: цель → что входит → архитектурные решения → DoD → текущее состояние → пошаговый план → затронутые файлы → итог.

**Откат.** Если ТЗ окажется недостаточно детальным — агент-исполнитель уточняет open-questions через decisions-log, не возвращается к родителю.

---

## 2026-05-10 — Архитектурные развилки в Фазе 7 (Z-Admin)

**Зафиксированные ключевые решения** (полный список — в `plans/archive/2026-05-10-phase-7-admin.md` §«Архитектурные решения»):

1. **Два guard'а** (`SuperAdminGuard` для `/api/v1/admin/*`, `OrgAdminGuard` для `/api/v1/org-admin/*`) — не один общий с `?scope=` параметром. Унификация на уровне сервисов через `{scope: 'global'|'org', tenantId?}`.
2. **`SuperAdminAccessLog`** — новая таблица для compliance: каждое drill-down действие super_admin'а пишется через `SuperAdminAuditInterceptor`. Email-отчёт — vNext.
3. **`Org.workersEnabled jsonb`** — новое поле для тумблеров в Org-Admin. Воркеры на старте processor'а через `WorkerOrgGate.checkOrThrow(tenantId, name)` пропускают/тратят retry. Default `{}` = все включены.
4. **Soft-delete связей** через новые поля `IdeaBlockLink.deletedAt/By`, `EntityLink.deletedAt/By`. Hard-delete через 30 дней (отнесено в Фазу 11 retention).
5. **`AiUsageLog.requestPreview` + `responsePreview`** (text, truncate 8KB каждый) — новые поля для drill-down в Z-Admin. Заполняются `LlmRouter` для всех новых вызовов; для исторических — null.
6. **A/B-эксперименты** через `LlmTaskRoute.experiment` (поле уже есть, Фаза 0). Новый `AdminExperimentsService`. На finish: winner=B → переставить modelB первой в `providers`.
7. **Существующий `AdminGuard`** (legacy, проверяет `User.role==='admin'`) на Фазе 7 заменяется `SuperAdminGuard` для `/admin/api/v1/ai-usage` и `/api/v1/admin/llm-routes`. Legacy `User.role='admin'` без `isSuperAdmin=true` теряет доступ — намеренно.

**Откат.** Каждое решение откатывается отдельно. См. соответствующий шаг в дочернем ТЗ.

---

## 2026-05-10 — Архитектурные развилки в Фазе 8 (Дашборд директора)

**Зафиксированные ключевые решения** (полный список — в `plans/archive/2026-05-10-phase-8-director-dashboard.md`):

1. **Один эндпоинт `GET /api/v1/dashboard/director?period=`** — все 6 виджетов одним ответом (не отдельные `/widgets/themes`, `/widgets/signals`). Cache key один на всю страницу.
2. **Период `week|month`** — `custom from/to` отнесён в vNext.
3. **Роль `admin` тоже видит дашборд директора** (партнёрская роль). `manager` — нет. Реализуется через `RbacService.canViewDirectorDashboard`.
4. **AI-чат встраивается в дашборд** через `chat-v2` org-scope (Фаза 6). Не отдельный Q&A-агент. Извлекаем общий компонент `<OrgChatPanel>` из `/chat`.
5. **`narrativeSummary` LLM-блок** — опциональный 7-й блок, отдельный кэш TTL 24h. На фейл LLM — `null`, UI скрывает блок (а не показывает заглушку). LlmTaskRoute для `dashboard-summary` создаётся одноразовым патч-скриптом.
6. **Manager-вид остаётся прежним** — текущий `DashboardClient.tsx` не трогаем, добавляем рядом `DirectorDashboardClient.tsx`. Split логика — клиентская через `useAuth()`. URL остаётся `/dashboard`.
7. **`hotEntities` через SQL `groupBy(entityId)`** без денормализованного поля — на малых Org быстро. MV — vNext.

---

## 2026-05-10 — Архитектурные развилки в Фазе 9 (Цели + strategic alignment)

**Зафиксированные ключевые решения** (полный список — в `plans/archive/2026-05-10-phase-9-goals-strategic-alignment.md`):

1. **3 новые модели** `Goal`, `GoalTheme`, `GoalAlignmentSnapshot` + 2 enum'а (`GoalStatus`, `GoalThemeSource`). Snapshot **иммутабельный**, перерасчёт = новый snapshot.
2. **Кэш `cachedAlignment*` в `Goal`** для быстрого чтения списка без JOIN'а на последний snapshot. Атомарно обновляется в транзакции воркера.
3. **Cron `@Cron('0 4 * * *')`** + воркер `strategic-alignment.worker` (consumer `core.strategic-alignment`, concurrency 2). Окно по умолчанию 30 дней (`Org.strategicAlignmentWindowDays`, диапазон 7–90).
4. **Delta** = разница со snapshot **20-50h назад** (не «вчерашний») — устойчивость к пропуску cron-запуска. **Alert** = `delta <= -15 AND score <= 60`. Email/push — vNext.
5. **Авторизация:** только `owner` создаёт/редактирует/удаляет цели. `admin` и `manager` — read. Новый ресурс `'goal'` в RBAC + правила в `policy.csv`.
6. **Quota на ручной recompute** — 5/сутки/Org через `QuotaService` (`MAX_GOAL_RECOMPUTE_PER_DAY`). Защита от LLM-злоупотреблений.
7. **Перерасчёт по триггеру (новая встреча → пересчёт целей)** не делаем — только cron + ручной trigger. Снижает стоимость LLM.
8. **AI-suggester тем для цели** — НЕ входит, только manual-привязка. vNext.
9. **Расширение Фазы 8:** `DirectorDashboardDto.strategicAlignment` опциональное поле + UI-индикатор «Согласованность стратегии» — это часть **Фазы 9**, не Фазы 8.
10. **JSON Schema strict в LLM-вызове** + температура 0.0 для стабильности score. UI-подпись: «AI-индикатор движения, точность ±10 пунктов».

---

## 2026-05-10 — Casbin engine

**Вопрос.** ТЗ Фазы 0 требует «Casbin как первичный engine RBAC». В коде реализован in-house policy CSV engine (`backend/src/modules/rbac/rbac.service.ts`) с Casbin-style форматом строк `p, role, visibility, owner_match, obj, act`.

**Решение.** Принимаю. Не переделываю на `@nestjs/casbin`.

**Почему.**
- Функционально эквивалентно: все требуемые проверки (super_admin / owner / admin / manager × open/strict × resource × action) реализованы.
- Формат policy.csv совместим с Casbin → миграция в один шаг при необходимости.
- Меньше зависимостей в bundle.
- Уже работает, typecheck зелёный.

**Откат.** Заменить `evaluate()` в [rbac.service.ts](backend/src/modules/rbac/rbac.service.ts) на `enforcer.enforce()` из `@nestjs/casbin`, policies переключить на адаптер. Стоимость — 1-2 часа.

---

## 2026-05-10 — LlmRouter и DeepSeek/Ollama: перенос в Фазу 2 Шаг 0

**Вопрос.** ТЗ Фазы 0 («Шаг 1, расширение `LlmRouter`») предписывает добавить адаптеры `DeepSeekService` и `OllamaService`, A/B-логику, чтение `LlmModelPrice` из БД. В коде (на 2026-05-10) этого нет: схема `LlmModelPrice` создана, но `LlmRouter` всё ещё использует только `Anthropic / MiniMax / OpenAi-via-proxy` и считает `costUsd` по in-code карте.

**Решение.** Эту работу сделать в **Фазе 2 Шаг 0**, а не возвращаться к Фазе 0. ТЗ Фазы 2 само ссылается на это в детализации (строки 635, 672–716).

**Почему.**
- Фаза 2 без DeepSeek/Ollama не имеет смысла (новые `block-ingest` / `block-distill` taskType маршрутятся именно туда).
- Объединение даёт один атомарный коммит.
- Семантически Фаза 0 закрыта: всё, что нужно для multi-tenancy + биллинга, работает; LLM-инфра — отдельная зона.

**Откат.** Не нужен — это не риск, а реорганизация порядка.

---

## 2026-05-10 — embedding dim = 1536 в IdeaBlock/Entity

**Вопрос.** Политика 2026-05 ставит primary embedding `bge-m3` (1024-dim). ТЗ Фазы 2 (строка 572) указывает `vector(1536)`. Конфликт.

**Решение.** На Фазе 2 — `vector(1536)` через `text-embedding-3-small` (proxy). BGE-M3 включается как fallback через `EMBEDDING_PROVIDER=local`. Полная миграция на 1024-dim — Фаза 11 / vNext.

**Почему.**
- `MeetingTranscriptChunk` уже на 1536, ENV `EMBEDDING_DIMENSIONS=1536` зашит.
- Менять размерность сейчас = ломать существующий cross-meeting RAG.
- Переход на 1024 требует ресайза hnsw-индекса, новой миграции, тестирования качества — отдельная задача.

**Откат.** Когда дойдём до Фазы 11 — `ALTER COLUMN embedding TYPE vector(1024)`, ресайз индекса, ребилд эмбеддингов одним job'ом.

---

## 2026-05-10 — block-ingest сегментация (упрощение)

**Вопрос.** ТЗ Фазы 2 (строка 577) предлагает «LLM-вызов "найди границы тем"», что = 2 LLM-вызова на сегмент.

**Решение.** Упрощённая стратегия: группировка turns одного speaker'а ≤2000 токенов, скользящее окно 5-7 сегментов на один LLM-вызов `block-ingest`. Дедуп между окнами — задача `block-distill.worker`.

**Почему.**
- Прямо предписано детализацией ТЗ Фазы 2 (строки 660-666): «упрощённая стратегия» как baseline.
- На 1ч встречи дает ~15 LLM-вызовов вместо 200.
- Качество — измеряется бенчмарком в Шаге 6.

**Откат.** Если бенчмарк не пройдёт, ввести `topic-boundaries.service` + дополнительный LLM-вызов; интерфейс `block-extraction` это не сломает.

---

## 2026-05-10 — Шаг 0 Фазы 2: набор технических решений субагента

Зафиксировано после делегации Шагов 0+1 (коммиты `95d0313`, `758eb2f`).

1. **Default fallback chain LlmRouter** заменён с `[anthropic, minimax, openai-via-proxy]` на `[deepseek, openai-via-proxy, ollama]` (политика 2026-05). Тесты `llm-router.service.spec.ts` обновлены.
2. **`taskTypeToAgentType` маппинг:** `summary-v2 → summary`, `task-extract-v2 → tasks`, остальные новые knowledge-core taskType → `custom`. `AiAgentType` enum намеренно не расширен — drill-down делается по `taskType`.
3. **`AiProvider` расширен** на `deepseek`, `ollama` (вместо использования `'openai'` как fallback для DeepSeek). Чище для биллинга.
4. **JSON Schema через OpenAI Responses API** (`openai-proxy.service.ts`) — поле `text.format` (новый формат). Если прокси не поддерживает — авто-fallback на DeepSeek (primary в `block-distill` route).
5. **`reasoning.effort` в DeepSeek** включается только если `model.includes('pro')`. V4-flash thinking-off дефолт.
6. **`response_format`**: DeepSeek поддерживает `json_schema strict`, Ollama — только `json_object`. Если caller просит `json_schema` от Ollama → `LlmFormatNotSupportedError` → роутер делает fallback на следующего провайдера.
7. **Расчёт `costUsd`** — сначала `LlmModelPrice` (БД, in-memory кэш 60 сек), фолбэк на `MODEL_PRICES` (код). Учёт `cachedTokens` отдельной строкой с `cachedCostPerMillionTokens`.
8. **`IdeaBlock.search_tsv`** — `GENERATED ALWAYS AS STORED` колонка с весами `name=A, criticalQuestion=B, trustedAnswer=C`, GIN-индекс. Создаётся через `backend/scripts/apply-postgres-init.ts` (Prisma не умеет GENERATED).
9. **`Entity.canonicalName`** — `@@index`, не `@@unique`. Дубли допустимы до `entity-merge-arbiter`.
10. **Smoke-скрипт** поднимает урезанный Nest-context через `Test.createTestingModule` — даёт DI-граф с конфигом и Prisma без HTTP/workers.

**Открытые вопросы (требуют верификации в проде):**
- Поддерживает ли `proxy.agent-lia.ru` Responses API формат `text.format=json_schema`. Smoke-скрипт это покажет.
- Цены MiniMax-M2.7 = 0 (TBD, оставлен fallback в `summary-v2`). Сверить и обновить `MODEL_PRICES` + добавить запись в `LlmModelPrice` с `effectiveFrom=now`.
- Ollama embeddings (BGE-M3) намеренно отложены до Фазы 11.

---

## 2026-05-10 — Шаги 2+3 Фазы 2 (block-ingest + block-distill)

Зафиксировано после Subagent 2 (коммиты `d64c1a1`, `c89c5cf`).

1. **`KnowledgeCoreModule` сделан `@Global()`** — `WorkersModule` вручную провайдит `LlmRouterService` и embeddings, дубль через AiModule был бы коллизией.
2. **`CoreQueueService.TypedConfigService`** инжектится `@Optional()` с hardcoded fallback 30000ms — для тестов без ConfigModule.
3. **`EntityResolutionService.findOrCreateEntity`** на Шаге 2 — `findMany + filter в TS` (case-insensitive), не индекс. Замена на full LLM-арбитр — Шаг 4.
4. **Защита LLM-арбитра в block-distill**: если `canonicalId` из ответа не в списке кандидатов → fallback в `distinct`. Иначе риск merge в чужой tenant.
5. **Защита от устаревшего KNN**: если target-canonical уже `merged_into` (race) — abort транзакции с throw, BullMQ retry с новым KNN.
6. **Сегментация на «too-long» turn**: не режем символьно, переносим turn целиком в новый сегмент. Семантика сохраняется. Гипер-длинный turn (>2000 токенов) идёт в свой сегмент один.
7. **Перенос evidence/entity-mention при merge** — не в одной транзакции с `findOrCreateEntity` (там `$executeRawUnsafe` для embedding конфликтует с interactive transaction). Повторный upsert даст +1 к mentionsCount — приемлемо.
8. **`LlmTaskRoute` для `block-ingest` / `block-distill`** не создан в этом блоке — fallback на default chain `[deepseek, openai-via-proxy, ollama]`. Если нужно — добавится через Z-Admin позже.

---

## 2026-05-10 — Шаги 4+5+6 Фазы 2 (entity-resolver + Search API + smoke + second-brain)

Зафиксировано после Subagent 3 (коммиты `bc88d49`, `073fcde`, `66eaea9`).

1. **Search API под префиксом `/api/v1/knowledge/`** — `/api/v1/search` уже занят `SearchController` (cards/meetings/tasks). Чтобы не путать knowledge-search с global ⌘K-search.
2. **`block` / `entity` — отдельные RBAC resource type** в `policy.csv`, не наследование от `meeting`. У IdeaBlock нет `ownerId` → strict-режим даёт manager только `read` (без write/delete).
3. **`KnowledgeCoreModule` подключён ПОСЛЕ `AiModule`** в `AppModule` — `BlockMergeService`/`EntityMergeService` инжектят `LlmRouterService` из @Global() AiModule.
4. **`@Cron('*/5 * * * *')` зашит литералом** в `EntityResolverCronService` — декоратор берёт значение в момент class-decoration. ENV `ENTITY_RESOLVER_CRON` оставлен для будущей динамической перерегистрации через `SchedulerRegistry`.
5. **`EntityResolverCronService.scanAndEnqueue` отдаёт только `a.id`** в очередь, worker сам подгружает кандидатов. Идемпотентность через jobId=`entity_resolver_<entityId>`.
6. **Smoke degraded-mode** — без LLM, создаёт IdeaBlock+Evidence+Entity+IdeaBlockEntity напрямую через Prisma. Проверяет структуру + Search SQL (BM25-ветку). Полный pipeline — TODO для отдельной сессии (требует API-ключей + Nest worker context).
7. **Concurrency `EntityResolverWorker` = 1** (а не 2): cron + on-event пересекаются, серийная обработка проще чем advisory locks.

---

## 2026-05-10 — Фаза 3 (связи + reframing)

Зафиксировано после Subagent 4 (коммиты `c7a129d`, `53672ba`, `54fa63d`, `3a4a109`).

1. **Cron-выражения литералом** (`@Cron('0 * * * *')`, `@Cron('0 3 * * *')`). Декораторы NestJS вычисляются на class-evaluation, до DI — нельзя через `cfg.knowledgeCore.*`. ENV оставлены для будущего перехода на `SchedulerRegistry`.
2. **Reframing пишет анализ в Logger**, не в `ReframingLog`-таблицу. Таблица — задача Фазы 7 (Z-Admin). Лог структурный, готов к парсингу.
3. **`createdBy='linker'` и для block-link, и для entity-graph-builder.** Не плодим enum-варианты. Если потребуется различать в Z-Admin — добавим `entity-linker`.
4. **BFS на 3 уровня в памяти контроллера**, не CTE. Лимит 100 nodes — приемлемо. На больших Org переписать.
5. **`block-entity` edges в graph BFS — ориентация block→entity.**
6. **dynamicScore decay через `$executeRawUnsafe`** — Prisma не умеет SQL-арифметику на Decimal с GREATEST. Формула: `dynamicScore = max(0.1, dynamicScore - 0.1)` для блоков `updatedAt < now - 90 days`.
7. **Архивация слабых связей применена к обеим таблицам** (IdeaBlockLink + EntityLink) — слабые EntityLink бы жили вечно.
8. **Graph API фильтрует `status='active'`** — архивные связи невидимы в UI до Фазы 7.

---

## 2026-05-10 — Фаза 4 backend (Theme + clusterer + card-rollup-v2)

Зафиксировано после Subagent 5 (коммиты `19559e0`, `9fa2ebc`, `d256f04`, `0fac6e1`).

1. **`Card.cachedTopThemeIds: String[]`** вместо отдельной `CardThemeRollup` — проще, без новой модели. v2-воркер пересчитывает на каждом тике.
2. **theme-clusterer на TS-side O(N²)** (KNN-greedy union-find). Для N≤1000 ≈1.5s. Перенос на pgvector-side query — отложен до жалоб на крупных Org.
3. **`POST .../save-as-card` создаёт Card напрямую через Prisma** в knowledge-core controller — избегаем циклической зависимости knowledge-core → cards. Уникальность имени защищена `@@unique([ownerId, name])` + 409 при P2002.
4. **`themeSplits` из reframing — только лог-сигнал.** Авторазделение слишком рискованно. Owner Org разберёт через UI Фазы 5/6.
5. **`themeMerges` транзакционно**: перенос ThemeIdeaBlock/ThemeEntity с source на target (skipDuplicates) → удаление source-связей → `source.status='merged_into'`.
6. **theme-clusterer вызывает только `theme-classify`**, отдельной `theme-clusterer` LLM-route нет. ENV `THEME_CLUSTERER_CRON` — только расписание.
7. **Старый `card-rollup.worker` НЕ трогали** — параллельная работа до Фаз 5/6.
8. **Source блоков карточки**: через `RawEvent.sourceExternalId = meeting.id` (meetings) + `IdeaBlockEntity.entityId IN (Card.entityId ∪ Card.relatedEntityIds)` (entities). dedup, status=canonical, top 50.
9. **`GET /cards/:id/themes`** добавлен в существующий `cards.controller.ts` — один origin для фронта, без отдельного контроллера.
10. **Frontend Фазы 4 отложен** в следующую сессию — `/themes` страница, секция «AI-темы» на Card, save-as-card UI.

---

## 2026-05-10 — Фаза 4 frontend (themes UI)

Зафиксировано после фронтенд-сессии Фазы 4 (страницы `/themes`, секция «AI обнаружил эти темы» на карточке, sidebar).

1. **Domain `ThemeBranch` без `null` в типе, ветка темы — `ThemeBranch | null`.** Бэкенд хранит ветку как `null`, если LLM ответил `'none'`. Не дублируем `'none'` в TS-енам — на ui всё равно показываем «без ветки» (пилюля просто не рендерится).
2. **`ThemeStatus` — три значения** (`active`, `archived`, `merged_into`), маппинг строк из API через `KNOWN_STATUSES` set с дефолтом `active` (защищается от расширения enum'а на бэке).
3. **Mapper'ы `themeFromApi`/`themeBlockFromApi`/`themeEntityFromApi`/`themeDetailFromApi`/`cardThemeMiniFromApi`** — отдельные функции, без `any`. Прибиты narrow'ы веток/статусов/dynamic строго к union'у.
4. **`themesApi.list`** принимает `branch?` строго `ThemeBranch` (т.е. UI-слой сам преобразует `'all' → omit`). Не передаём `'all'` на бэк — это упрощает back-валидацию.
5. **Save-as-card UI — отдельный shadcn `Dialog`**, не отдельная страница. Дефолтное имя = `theme.name`, при открытии диалога имя сбрасывается к актуальному `theme.name` (чтобы прошлая правка не «прилипала»).
6. **409 `card_name_taken` обрабатывается явно** — `ApiError` нарративно конвертируется в локализованный toast «Карточка с таким названием уже существует». Остальные ошибки — общий msg.
7. **`CardThemesSection` рендерится как `null`, если items пуст.** Не показываем «здесь ещё нет тем» — тема обнаруживается AI асинхронно; пустая карточка-плейсхолдер визуально шумит.
8. **Tooltip заменён на нативный `title`-атрибут.** Shadcn `<Tooltip>` есть в репо, но `TooltipProvider` нигде не подключён — поднимать его в `AuthenticatedShell` ради одной подсказки нерационально. Использован `<span title="...">` с `<HelpCircle>` иконкой.
9. **Деталка темы — без подгрузки evidence.** Показываем `name + criticalQuestion + trustedAnswer` блока, без таймкодов/quotes/source. Это требование ТЗ (детально не нужно), и соответствует тому, что эндпоинт `themes/:id` не возвращает evidence.
10. **Иконка темы — `Sparkles` (lucide).** Совпадает с иконкой AI-сводки на карточке — единый визуальный язык «всё, что от AI».
11. **`/themes` фильтр статуса — bool-тумблер (active/archived)**, не Select. `merged_into` темы доступны только по прямой ссылке (баннер «Перейти к актуальной теме»), на листинге — только active или archived.
12. **Pagination на `/themes` — `limit: 100`** одной страницей. Если в будущем тем станет >100 — добавим offset-based пагинацию (бэкенд её уже поддерживает).
13. **Sidebar — пункт «AI-темы» помещён между «Карточки» и «Мои встречи».** «AI-темы» это «знание о бизнесе», логически рядом с «Карточками».

---

## 2026-05-10 — Фаза 5 (Tasks-2.0/Chapters-2.0/Summary-2.0)

Зафиксировано после backend-сессии Фазы 5.

1. **Legacy НЕ удаляется в этой фазе.** `tasks-extract.worker`, `chapters.worker`, `task-extraction.service.ts`, `chapter-extraction.service.ts` остаются. Их вызовы из `analyze.worker.ts` не тронуты. Причина: ТЗ Фазы 5 требует A/B-сравнения с golden-set'ом — без legacy сравнивать не с чем + риск регрессии UX. Удаление = отдельная фаза после ручного решения владельца.
2. **V2-агенты пишут в новые поля БД, не перезаписывают старые.** На Task/MeetingChapter добавлены `evidenceBlockIds: String[]` + `extractorVersion: String?` ('v2' маркирует knowledge-core, NULL = legacy). На AiResult — `summaryV2`/`summaryV2Model`/`summaryV2GeneratedAt` (отдельно от `summary`). На Meeting — `analyzeV2Status`/`analyzeV2GeneratedAt`/`analyzeV2Error` (status строкой, не enum'ом — проще расширять).
3. **Master-флаг ENV `KNOWLEDGE_CORE_V2_AGENTS_ENABLED`** (default `false`). Когда `false` — `meeting-analyze-v2.cron` не публикует jobs. Включается на проде вручную для A/B.
4. **Cron-выражение `'*/10 * * * *'` зашито литералом** в декораторе `@Cron`. Декоратор Nest cron вычисляется на class-evaluation, до DI — нельзя через `cfg.knowledgeCore.meetingAnalyzeV2Cron`. ENV оставлен для будущей перерегистрации через `SchedulerRegistry`.
5. **Дебаунс `MEETING_ANALYZE_V2_DEBOUNCE_MS = 120_000` (2 мин)** — даёт block-distill стабилизироваться (canonical блоки могут «доезжать» спустя несколько секунд после `meeting.status='ai_ready'`).
6. **`MeetingAnalyzeV2Worker.concurrency = 1`.** Один LLM-сервис проекта Z имеет общие rate-limits, поэтому «один meeting за раз» проще, чем bookkeep'ить параллельно (тот же подход что у `EntityResolverWorker`).
7. **Один LLM-вызов на каждого агента**, три параллельных через `Promise.allSettled`. Tasks/Chapters — `json_schema strict`; Summary — текстовый markdown. taskType: `task-extract-v2`, `chapter-extract-v2`, `summary-v2` (уже зарегистрированы в `LlmTaskType` union'е, никаких правок в `llm-router.service.ts` не понадобилось).
8. **Tasks-write — без unique-индекса.** Task не имеет `(meetingId, title)` unique constraint, поэтому используется `findMany existing → filter в TS → create по одной`. Дедуп по `title.trim().toLowerCase()` против ВСЕХ существующих задач (legacy + предыдущие v2-результаты). На P2002 защищён try/catch на каждой `create`. Альтернатива — добавить `@@unique([meetingId, title])` — отвергнута: legacy задачи могут иметь одинаковые titles (LLM был неидеален), сломает существующие данные.
9. **Chapters-write — `deleteMany {extractorVersion='v2'} → createMany`.** Legacy главы (`extractorVersion=null`) не трогаются. Это позволяет UI показывать оба набора (или переключатель) без миграции.
10. **Summary-write — log warn + skip если AiResult отсутствует.** Это значит legacy ai-pipeline ещё не отработал — cron на следующем тике подхватит когда AiResult появится.
11. **Фильтр для Tasks по `signalType ∈ {'commitment', 'decision'}`.** Не включаем `'task'` — этого значения нет в `SignalType` enum (есть в TS-кортеже `SIGNAL_TYPE_VALUES` для будущей расширяемости, но Prisma enum его не содержит). Если block-ingest когда-либо начнёт ставить `signalType='task'` — добавится в фильтр одной правкой.
12. **`BlockFetchService` через цепочку RawEvent → Evidence → IdeaBlock,** только canonical, фильтр tenantId. Сортировка по min `evidence.startMs`. Альтернатива — JOIN запросом — отвергнута: Prisma не любит сложные include'ы с фильтрами по nested fields, проще тремя findMany.
13. **Защита от LLM-выдумок blockId.** В extractor-сервисах после парсинга — `evidenceBlockIds.filter(id => validBlockIds.has(id))`. Если LLM сослался на чужой/несуществующий блок — отбрасываем. Если все ссылки выпали — задача всё равно принимается (с пустым `evidenceBlockIds`).
14. **`Promise.allSettled`, не `Promise.all`.** Один упавший агент не должен валить остальные двое. Финальный статус — `ready` если все ок, `partial` если 1-2 упали, `failed` если все три. На `failed` worker делает throw → BullMQ зачтёт attempt → retry по политике очереди.
15. **MeetingHighlight.evidenceBlockId добавлен превентивно** (требование ТЗ Фазы 5), но highlights-v2-генератор — vNext (этой фазы не касается).
16. **`MEETING_ANALYZE_V2_CRON` ENV не используется в @Cron, но в config есть** — документирует ожидаемую частоту в логах (как `ENTITY_RESOLVER_CRON` в Фазе 2 Шаг 4).

---

## 2026-05-10 — Фаза 6 (единый AI-чат поверх IdeaBlock'ов, 5 scope)

Зафиксировано после backend+frontend сессии Фазы 6.

1. **Legacy `chat.service` НЕ удаляется в этой фазе.** Оставляем `askSingleMeeting`/`askCrossMeeting`/`askCard` живыми. Причина — A/B бенчмарк качества (без legacy сравнивать не с чем) + риск регрессии UX. Удаление = отдельная фаза после ручного решения владельца. Тот же подход что в Фазе 5 с tasks/chapters.

2. **ENV-флаг `CHAT_V2_ENABLED` (default `false`).** Единая «ручка» включения. Когда `true` — существующие эндпоинты (`POST /meetings/:id/chat`, `POST /chat`, `POST /cards/:id/chat`) внутри контроллера switch'атся на новые `askXV2()` методы `ChatService` (тот же контракт ответа `{message, citations, modelUsed}`). История общая (`MeetingChatMessage`), формат citations совместим. ENV `CHAT_V2_TOP_BLOCKS=12`, `CHAT_V2_GRAPH_HOPS=1` — параметры retrieval'а.

3. **Switching через chat.service, не через DI-провайдер.** Альтернатива (DI factory: при `chatV2Enabled` подменять `ChatService`-провайдер) отвергнута — лишняя сложность, и тесты ChatService становятся непрозрачными. Текущий вариант: контроллер делает `if (cfg.chatV2Enabled) return svc.askXV2() else return svc.askX()`. ChatService инжектит `ChatV2Service` напрямую (через `@Global() KnowledgeCoreModule` без явного import).

4. **SSE/streaming НЕ реализуем в этой фазе.** Текущий API синхронный (POST → JSON-ответ). Это требует переделать chat.controller на event-stream + изменения api-client'а. Вынесено в vNext. ТЗ Фазы 6 строки 1136-1137 на «поток (SSE)» отложен.

5. **Citations в v2 — через regex `[BLOCK:<id>]`.** LLM просим явно ставить маркер `[BLOCK:<id>]` рядом с фактом. Парсинг — `/\[BLOCK:([a-z0-9]+)\]/gi`. Для каждого валидного blockId — primaryMeetingEvidence (первая по startMs ASC). Если блок не имеет meeting evidence (например, evidence только из chat-source) — citation пропускается. Альтернатива (LLM возвращает structured `citations[]` через JSON Schema) отвергнута — текущий ответ markdown, structured output потребовал бы либо отдельного call'а с json_schema, либо двух прогонов. Regex проще и работает на любом провайдере.

6. **Retrieval pool по scope — отдельный ChatV2RetrievalService.** Не расширяю `SearchService` новым методом — там общий гибридный поиск, scope-логика чужеродна. Отдельный сервис: `fetchCandidates({scope, scopeId, ...})` собирает blockIds, ранжирует cosine SQL-запросом по подмножеству (`b.id = ANY($ids)`), затем 1-hop через `IdeaBlockLink` (active links, ANY direction). Org-scope pool лимитирован 5000 блоков (защита от org с десятками тысяч; за рамками лимита нужен полноценный гибридный поиск, vNext).

7. **History — последние 6 сообщений в system prompt.** LlmRouter в Z не поддерживает `messages[]` нативно (один system + один user message). Вместо этого встраиваем последние 6 (3 user + 3 assistant) в system prompt как Q/A блок. Длинные сообщения обрезаются до 600 символов. Альтернатива (расширять LlmRouter/Anthropic-API на native history) отвергнута — повторное усложнение для одной фазы; полный native messages — отдельная задача.

8. **Persist в `MeetingChatMessage` остаётся в chat.service, не в knowledge-core.** ChatV2Service stateless — он только retrieval+LLM. История пишется в обёрточном методе `chat.service.askXV2()` через `ChatRepository`. Для unified endpoint `POST /chat/v2` — персистим по правилу: meeting → meetingId; card → cardId; иначе cross-history (meetingId=null, cardId=null). Scope-aware история (отдельные ленты для theme/entity) отложена в vNext.

9. **RBAC под scope в unified endpoint.**
   - `meeting` → owner-проверка `meeting.ownerId===userId` (как legacy single-meeting).
   - `card` → `cards.getById(cardId, userId)` (owner-проверка).
   - `theme` → `theme.tenantId===tenantId` + `RbacService.canRead(userId, tenantId, 'theme')`.
   - `entity` → `entity.tenantId===tenantId` + `RbacService.canRead(userId, tenantId, 'entity')`.
   - `org` → `RbacService.canRead(userId, tenantId, 'block')` — минимально достаточный resource (как в knowledge-search).

10. **Frontend — graceful fallback при 503.** `/chat` страница пробует `POST /chat/v2` (org-scope). Если backend вернул `ApiError.code === 'chat_v2_disabled'` — fallback на legacy `POST /chat`. Так UI работает на любом окружении без знания флага. Альтернатива (новый endpoint `GET /api/v1/chat/v2/status`) отвергнута — лишний HTTP-запрос, текущий вариант проще и self-healing.

11. **`chat-v2` taskType уже в LlmTaskType enum** (был добавлен в Фазе 2 Шаг 0 превентивно). `taskTypeToAgentType` маппинг — default `'custom'` agentType (drill-down в Z-Admin делается по taskType). Никаких правок в `llm-router.service.ts` не понадобилось. Default chain `[deepseek, openai-via-proxy, ollama]` подходит для chat-v2 (markdown text, не json_schema).

12. **`incChatRequest` метрика — узкий enum.** `BusinessMetricsService.incChatRequest` принимает `'single' | 'cross' | 'card'`. В unified endpoint мы маппим v2-scope: meeting→single, card→card, иначе cross. Расширение enum'а на `theme`/`entity` отложено — пока не нужно (V2 ещё в A/B).

13. **`ContextBlock.primaryMeetingEvidence` — первое evidence по startMs ASC.** Не самое релевантное, не самое цитируемое — просто хронологически первое. Достаточно для citation-link на встречу+таймкод. Расширение (выбор «лучшей» evidence — по совпадению с запросом) — vNext.

14. **Pool blockIds для org-scope SQL — `b.id = ANY($ids::text[])`.** Альтернатива (`b.id IN ($1, $2, ...)` с N плейсхолдеров) отвергнута — для 5000 блоков это 5000 параметров. `ANY($1::text[])` принимает массив одним параметром — чище.

15. **`fromGraph: true` блоки получают score `≈ -1`.** Это гарантирует, что они идут после top-K cosine-результатов в финальном списке (но не выкидываются). Простой способ маркировки без отдельного флага в SQL.

16. **DTO `ChatV2AskSchema` — `query` (не `message`).** Сознательное расхождение с legacy `ChatAskSchema {message}`. Причина: ChatV2 — новый контракт, поле `query` точнее отражает интент (это поисковый запрос для retrieval). На legacy эндпоинтах поле осталось `message` для совместимости с фронтом.

---

## 2026-05-10 — Фаза 7 backend (шаги 1-8): фактические решения исполнителя

Зафиксировано после backend-сессии Фазы 7 (коммиты `0a03275`, `6e73787`, `2f921d4`, `31dba5a`, `9af69cd`, `b6cc470`, `80fb281` + финал-коммит шага 8).

1. **`LinkStatus` enum в коде имеет только `active|archived`,** не `active|archived|deleted` как было предположено в ТЗ Фазы 7. Решение: НЕ менять `LinkStatus`, всё soft-delete делать через новые поля `deletedAt/deletedBy`. UI Org-Admin фильтрует `deletedAt: null` на listLinks. Hard-delete после 30d — Фаза 11. Откат: добавить `deleted` значение в enum и расширить retention-чистку.

2. **`SuperAdminAuditInterceptor` пишет SuperAdminAccessLog для GET тоже,** не только для мутаций. Это требование compliance ТЗ Фазы 7 («любое drill-down действие super_admin'а»). `AdminAuditInterceptor` (legacy) пишет только не-GET — это другой interceptor, поведение не меняем. Откат: в новом interceptor'е добавить `if (request.method === 'GET') return;`.

3. **`requestPreview/responsePreview` помещены прямо в `AiUsageLog`,** не в отдельную таблицу `AiUsageCallPayload`. Открытый вопрос 2 ТЗ — выбрано «компактнее, JOIN не нужен». Truncate 8KB на стороне `AiUsageLogService.record` через `TextEncoder/TextDecoder` (байтовый размер UTF-8). Откат: создать `AiUsageCallPayload` с FK и переместить поля.

4. **Cursor pagination — base64(JSON({createdAt, id})).** Открытый вопрос 1 ТЗ. Decoder defensive: на любую невалидную строку → `null` → начнём с начала. Используется в `getCallsLog`. Для `getUsersUsage` (groupBy не поддерживает cursor нативно) — упрощён: take=limit+1 → `nextCursor` если есть `+1`. Откат: офсет-пагинация при необходимости.

5. **S3 health пропущен,** возвращается `{available: 'unknown'}` (Открытый вопрос 3 ТЗ). Полная интеграция — Фаза 11. Откат: добавить `s3.headObject` пинг с TTL 5m.

6. **Org-Admin `/sources` — заглушка** на frontend (Открытый вопрос 4 ТЗ). На backend не реализуем — это уже под Фазой 10. На Фазе 7 строим только структуру.

7. **`OrgAdminGuard` пропускает `owner` И `admin`,** не только `owner`. ТЗ Фазы 7 7.B описывает Org-Admin как «owner/admin Membership». `RbacService.canManageOrg` возвращает true только для `owner` или `super_admin`. Поэтому в guard'е сделана собственная проверка `loadContext` + `role ∈ {owner, admin}` или `isSuperAdmin`. Откат: вернуть `RbacService.canManageOrg` если решено сузить до owner-only.

8. **`SuperAdminGuard` делает БД-lookup на каждый запрос,** не использует JWT-claim. Аргумент: смена `User.isSuperAdmin` через DB должна применяться без перевыпуска сессии. Кэш в `req.user.isSuperAdmin = true` после первого guard-вызова — защита от повторного lookup в одной цепочке guards/interceptors. Откат: добавить isSuperAdmin в JWT и читать оттуда (требует logout+login после смены флага).

9. **`LlmRoutesController.upsert` делегирует в `AdminFunctionsService.setRouteForTaskType`** для совместимости — вместо двух путей (legacy `LlmRouterService.setRoute` без model + новый с model). Существующий PUT эндпоинт продолжает работать, но теперь сохраняет model + автоматически инвалидирует AdminCache. Откат: вернуть прямой вызов `LlmRouterService.setRoute`.

10. **`TASK_TYPES_TUPLE = ALL_LLM_TASK_TYPES`** — один источник правды. Кортеж экспортируется из `llm-router.service.ts` и переиспользуется в `llm-routes.dto.ts`. При расширении union'а — обновляется одно место в коде.

11. **`AdminFunctionsService.listFunctions` делает N запросов last-call** (по одному на taskType). На текущем масштабе (≤25 taskType) приемлемо. На большем — переход на одиночный SQL с `DISTINCT ON (taskType)` или предрасчёт.

12. **`AdminExperimentsService.modelA` парсится из текущей `providers[0]`,** или fallback `'<provider>:default'` если model не задана. Это означает: при `winner=A` → миграция providers не нужна, просто обнуляем experiment. При `winner=B` → парсим modelB и переставляем первым.

13. **A/B-эксперимент можно стартовать на `taskType` без существующей route** — создаётся «пустая» с `providers=[]`, `experiment={...}`. LLM-вызов в этом случае пойдёт через DEFAULT_FALLBACK_CHAIN, а В-группа всё равно будет учитываться через `experimentGroup`. Аргумент: упрощает UX — admin не должен сначала «настраивать» функцию, прежде чем запустить эксперимент.

14. **`WorkerOrgGate` бросает ошибку** (`WorkerDisabledForOrgError`), не делает `job.moveToDelayed`. На Worker-уровне ошибка → BullMQ retry → failed. ТЗ Фазы 7 предлагает оба варианта. Выбран throw — понятнее для observability (failed-jobs видны в admin/health) и проще: owner возвращает тумблер → manual retry. Откат: переключиться на `moveToDelayed(now+5m)` если зашумит метрики.

15. **`OrgAdminKnowledgeService.reprocessRawEvent`:** удаляет `IdeaBlock` через `IdeaBlockEvidence.rawEventId`, затем сбрасывает `processingStatus='received'` и enqueue с `suffix=Date.now().toString()`. Каскадные `IdeaBlockEntity` / `IdeaBlockEvidence` / `IdeaBlockLink` удаляются onDelete:Cascade. Откат: добавить опциональный флаг preserve-entities если потребуется.

16. **`Theme.mergedFromIds`/`Entity.mergedFromIds` для unmerge — не делаем.** В schema нет такого поля; добавлять его не оправдано — текущее merge через `mergedIntoId` отслеживает только направление вперёд. Unmerge как отдельная операция требует backup'а до merge'а; в Фазе 7 — vNext. Org-Admin UI получает `mergeEntities` (manual), но не `unmergeEntity`. ТЗ Фазы 7 это допускает («если нет — vNext, на Фазе 7 заглушка»). Откат: добавить `Entity.mergedFromIds: String[]` в schema + восстановление через сервис.

17. **`AdminCacheService` — single-process Map.** ТЗ Фазы 7 4.4 фиксирует TTL 60s. Распределённый кэш (Redis) — vNext, упомянуто в JSDoc. Сейчас backend-pod один (см. runtime topology). Откат: переключить на Redis-backed cache при горизонтальном scaling.

18. **`AdminFunctionsService.listFunctions` использует `routes WHERE tenantId=null`.** На Фазе 7 всё управление — глобальное (super_admin меняет дефолт для всех Org). Per-Org override уже технически работает в `LlmRouter.findRoute`, но UI не делается на Фазе 7. ТЗ это допускает.

19. **DTO для `org-admin/knowledge/audit-logs` принимает `entityTypes` как CSV-строку** (`?entityTypes=block,entity,theme`), парсится в контроллере функцией `parseEntityTypesCsv`. Альтернатива (zod `.transform`) ломает типизацию `ZodSchema<T>` (input ≠ output) — проще принять как строку и парсить отдельно.

20. **Воркеры в `WorkersModule` НЕ импортируют `CoreQueueModule`,** а провайдят `CoreQueueService` и `WorkerOrgGate` напрямую в `providers`. Существующий паттерн: Workers — flat module без import'ов модулей, только providers. Согласовано с практикой Фаз 2-5.

---

## 2026-05-10 — Phase 0 frontend: страницы найдены в `(authenticated)`

**Вопрос.** При первом аудите Glob по `frontend/app/settings/organization/**` дал 0 файлов — сделал вывод что страницы отсутствуют. Повторный поиск показал, что они существуют в `frontend/app/(authenticated)/settings/organization/page.tsx` и `(authenticated)/invitations/[token]/page.tsx`.

**Решение.** Исходный аудит был ошибочный (Next.js route group `(authenticated)` не покрылся первым glob-паттерном). Считаем frontend Фазы 0 закрытым.

**Почему.** Страницы существуют, server-component делегирует на client-component. Конвенция соответствует другим settings-страницам.

**Откат.** Если позднее окажется, что client-component не реализует требуемого UX (visibilityMode toggle, members list, invitations) — вынести в feature-task на доработку.

---

## 2026-05-10 — Phase 10 шаг 5: Mango адаптер БЕЗ создания Meeting

**Вопрос.** Execution-план Фазы 10 (шаг 5) требует, чтобы Mango-адаптер при `event.entry === 'call'` (summary) создавал `Meeting(type='phone_call', source='external', externalCallId=<callId>, ownerId=null, ...)`. Реальная Prisma-схема:
- `enum MeetingType` НЕ содержит `phone_call` (только team/standup/plan_fact/project/sales/custdev/partner/interview/customer_success).
- `model Meeting` НЕ имеет полей `source`, `externalCallId`.
- `Meeting.ownerId` — `String` (NOT NULL), не допускает null.

Расширение `MeetingType` enum + добавление полей `source`, `externalCallId`, делать `ownerId` nullable — изменение, затрагивающее десятки контроллеров/UI и противоречащее текущим соглашениям («Meeting — это AI-видеовстреча в LiveKit»). На MVP Фазы 10 это слишком большое расширение.

Альтернативы:
1. Расширить `MeetingType` + поля Meeting — много следствий.
2. Завести отдельную модель `PhoneCall` (id, tenantId, externalCallId, recordUrl, transcript-ref) — отдельная фича, не вписывается в Фазу 10.
3. **Хранить только `RawEvent` + S3-указатель на запись.** Транскрипция — vNext (отдельный воркер `phone-transcribe.worker`, который читает S3 и заполняет `payload.transcript` через `IngestService.ingest` повторно с тем же `sourceExternalId` идемпотентно).

**Решение.** Вариант 3. Mango-адаптер на этой фазе:
- Принимает webhook, валидирует подпись.
- При `entry='call'` (summary): скачивает запись (если recordUrl есть) → S3 `phone-calls/<tenantId>/<callId>.mp3`.
- Кладёт metadata-only payload в `IngestService.ingest`: `{callId, fromNumber, toNumber, durationSec, recordS3Key, raw}`.
- Транскрипция и интеграция с `transcribe.queue` остаются как TODO (комментарии в коде ссылаются на этот decision).

**Почему.** RawEvent — append-only, идемпотентен, единая точка входа в knowledge-core. Когда добавим `phone-transcribe.worker` (vNext), он скачает S3 → транскрибирует → выполнит повторный `ingest` с обновлённым payload (тот же `sourceExternalId = 'mango:<callId>'`), `IngestService` корректно вернёт «уже есть» (план: добавить отдельный путь `update-payload-on-transcribed`, но это уже другая фаза).

**Откат.** Если решим всё-таки расширить Meeting под телефон: добавить `phone_call` в `MeetingType`, поля `source`, `externalCallId`, `ownerId String?` — миграция через `prisma db push --accept-data-loss` (на проде — в окне обслуживания). Тогда переписать `MangoCallWebhookController.process`, чтобы создавал `Meeting`. RawEvent при этом останется.

---

## 2026-05-10 — Расширение `/api/v1/accounts/me` для гейта Z-Admin/Org-Admin (Фаза 7 шаг 9.4)

**Вопрос.** Frontend-агент Фазы 7 шаг 9 должен рендерить условные пункты Sidebar («Z-Admin» / «Админка Org») и SettingsSidebar (раздел «Админка»), для чего фронт нужен `isSuperAdmin` и `currentOrgRole`. Их нет в текущем `accountsApi.me()` shape. ТЗ-09.4 говорит «расширить useAuth() — если уже отдаётся через /api/v1/me, использовать; если нет — расширить».

Альтернативы:
1. Probe-вызовы (например, `GET /admin/health` для проверки super_admin) — но это пишет в `SuperAdminAccessLog` и захламляет таблицу;
2. Дополнительный фронт-вызов `orgsApi.listMembers` — лишний RTT + сложно для multi-org;
3. Расширить `accounts.service.getMe` тремя полями.

**Решение.** Вариант 3 — расширить `getMe` полями `isSuperAdmin`, `currentOrgRole`, `currentOrgId`. Догружаем одним `Promise.all` (один лишний `findUnique` + один `findFirst`). Это маленькое расширение в `backend/src/modules/accounts/`, не пересекается с Phase 8 (`backend/src/modules/dashboard/`), которую делает параллельный агент.

**Почему.** Один источник правды. Probe-вызов — побочный эффект (audit-log). Фронт получает данные синхронно с user, не нужно дополнительное состояние загрузки. Совместимо с auth-context refresh().

**Откат.** Удалить три поля из `PublicUserDto` + `getMe` загрузку membership/isSuperAdmin. Frontend-домен (`AccountUser`) автоматически защищается дефолтами (`isSuperAdmin: false`, `currentOrgRole: null`).

---

## 2026-05-10 — Фаза 12: какие quota call-sites переключать на entitlement-quotas

**Вопрос.** План Фазы 12 шаг 6 фиксирует список `QuotaKey` (7 ключей: `meetings_per_month`, `blocks_per_org`, `chat_requests_per_day_per_user`, `sources_meeting`, `sources_other`, `ingest_bytes_per_month`, `links_per_day`). Но в реальном коде есть и другие `quotaName`: `dump_per_day_per_user` (web-form), `render_jobs_per_hour` (highlights clip-render), `goal_recompute_per_day` (goals strategic-alignment recompute). План в шаге 6 явно перечисляет лишь `chat`, `exports`, `dump`, `regenerate` без сопоставления квот.

**Альтернативы:**
1. Расширить `QuotaKey` тремя ключами (`dump_per_day_per_user`, `render_jobs_per_hour`, `goal_recompute_per_day`) и добавить значения во все три tier'а в `TIER_CONFIG`.
2. Оставить эти три квоты на ENV/hardcode и зафиксировать в decisions-log как явное отклонение от плана.
3. Маппить их на существующие ключи (`dump → links_per_day`, `render → blocks_per_org` и т.п.) — costly, semantic mismatch.

**Решение.** Вариант 2. Перевели только `chat_requests_per_day_per_user` (через helper `ChatService.checkChatQuota`), `meetings_per_month` (`MeetingsService.createForUser`) и `ingest_bytes_per_month` (`IngestService.ingest` через `checkAndIncrementOrg`). `dump`, `render_jobs`, `goal_recompute` — остаются на ENV.

**Почему.**
- План Фазы 12 §Шаг 2 фиксирует ровно 7 ключей — менять контракт без ТЗ нельзя.
- Все три «не tier'ные» квоты — anti-abuse, не business-feature: rate-limit на дорогую операцию (clip-render, strategic-alignment, dump). Они одинаковы для всех тарифов и должны масштабироваться по серверным мощностям, а не по тарифу клиента.
- `chat_requests_per_day` → `chat_requests_per_day_per_user`: разные quotaName в Redis, поэтому существующие counters сбросятся (не инцидент — лимит просто восстановится с следующего вызова).

**Откат.** Если бизнес решит превратить эти три anti-abuse-квоты в часть тарифа: добавить в `QuotaKey`, добавить в `TIER_CONFIG`, переключить call-sites через `entitlements.getQuota`. Существующее ENV становится fallback.

---

## 2026-05-10 — Фаза 12: где выставлять `req.tenantId` для public-api gating'а

**Вопрос.** `EntitlementGuard` читает `req.tenantId`, который ставит `TenantGuard`. Public API использует `BearerAuthGuard` вместо `TenantGuard` (cookie-сессии нет, ApiKey-токен), и `req.tenantId` не выставляется. На gating'е `feature.public_api` через `@RequireEntitlement` guard упадёт с `tenant_required`.

**Альтернативы:**
1. Добавить `TenantGuard` в цепочку рядом с `BearerAuthGuard` — но `TenantGuard` ожидает `req.user.id` (CookieAuthGuard), не подойдёт без рефакторинга.
2. Сделать `EntitlementGuard` опциональным к `req.tenantId` — но тогда теряется сама идея per-Org gating'а.
3. Расширить `BearerAuthGuard`: после успешной аутентификации выставлять `req.tenantId = apiKey.tenantId` (если не null).

**Решение.** Вариант 3. `ApiKey` уже имеет `tenantId String?` (хотя для системных ключей null). После resolve в `BearerAuthGuard.canActivate` — `req.tenantId = apiKey.tenantId`. Системные ключи без tenantId продолжают работать как раньше — просто не покрыты `@RequireEntitlement` (для них guard падёт с `tenant_required`, что приемлемо: системные ключи не должны идти на tier-gated роуты).

**Почему.** Минимальное изменение, контрактно совместимо: `req.tenantId` уже использовался в downstream-сервисах (`tenant: apiKey.tenantId` в фильтрах). Альтернативы либо требуют рефакторинга `TenantGuard`, либо ослабляют security-контракт (`EntitlementGuard` без tenantId — это бесполезно).

**Откат.** Удалить строку `(req as any).tenantId = apiKey.tenantId` в `BearerAuthGuard`. Public API endpoints без `@RequireEntitlement` продолжат работать.

---

## 2026-05-10 — Фаза 12 frontend: audit-log entries на `/admin/orgs/:id/billing` отложены

**Вопрос.** План Фазы 12 шаг 12 предписывал на странице Z-Admin показывать lazy-load audit-log entries `TIER_CHANGED` / `ENTITLEMENT_OVERRIDE_SET` для конкретной Org.

**Решение.** Не реализуем сейчас — оставляем явный TODO в `BillingAdminClient.tsx` и в чек-листе плана.

**Почему.**
- В `frontend/src/api/` нет общего `auditLogApi` (поиск показал только `org-admin-knowledge.api.ts` со словом «audit», но это про другое).
- Создавать ad-hoc endpoint и API-клиент только под одну страницу — outside scope последнего фронт-агента (см. ТЗ: «если нет — пропусти и отметь TODO в decisions-log»).
- Backend пишет `TIER_CHANGED` / `ENTITLEMENT_OVERRIDE_SET` корректно (`audit.types.ts` обновлён в Шаге 7 backend). Когда появится общий `auditLogApi`, добавить секцию в `BillingAdminClient.tsx` — 30 минут работы.

**Откат.** Когда появится `auditLogApi.list({orgId, types: ['TIER_CHANGED', 'ENTITLEMENT_OVERRIDE_SET']})` — добавить секцию в `BillingAdminClient.tsx` под формой PATCH'а.

---

## 2026-05-10 — Фаза 12 frontend: `EntitlementProvider` подключён в `AuthenticatedShell`, не в RootLayout

**Вопрос.** Где монтировать `EntitlementProvider` — в `frontend/app/layout.tsx` (рядом с `AuthProvider`) или в `frontend/app/(authenticated)/AuthenticatedShell.tsx`?

**Решение.** В `AuthenticatedShell` — внутри guard'а, который уже проверил `user !== null` и `!mustChangePassword`.

**Почему.**
- На публичных страницах (`/`, `/login`, `/m/[id]`, `/share/*`) entitlement не нужен. Лишний `GET /api/v1/me/entitlements` от незалогиненного — минус 401 в логе на каждом mount'е.
- На `/onboarding/change-password` тоже не нужен — там нет gating'овых пунктов меню.
- `EntitlementProvider` сам слушает `auth-context`, поэтому подвешен внутри тех же guard'ов.

**Откат.** Перенести `<EntitlementProvider>` в `frontend/app/layout.tsx` — если в будущем гейтинг понадобится на публичных страницах (например, на странице цен показывать «вы уже Pro»). Сейчас не нужен.

---

## 2026-05-10 — Фаза 12 frontend: `<TierGate>` не скрывает Sidebar-пункты, а помечает замком

**Вопрос.** Как лучше для конверсии: скрывать недоступные пункты в Sidebar (Темы / Цели / AI-чат) или показывать с замком?

**Решение.** Показываем с замком. Tooltip «Доступно на Pro», клик ведёт на `/settings/billing` вместо целевого URL.

**Почему.**
- Скрывать = пользователь не знает, что фича вообще существует. Это кладёт upgrade-funnel.
- Показывать = ясный сигнал «у нас это есть, доступно на Pro». Поведение редиректа на `/settings/billing` мягко двигает к апгрейду без агрессивного modal'а.
- Это уже зафиксировано в плане Фазы 12 §«Принципиальные решения 5».

**Откат.** Убрать `gateFeature` из `NAV_ITEMS` или поменять логику в `SidebarNavLink` — заменить tooltip на `return null` для locked.

---
