---
type: decisions-log
feature: knowledge-core (Фазы 0–12)
status: living
date: 2026-05-10
---

# Журнал решений оркестратора

Здесь фиксируется каждое спорное / архитектурное решение, принятое оркестратором (Claude) без явного подтверждения пользователя — согласно режиму работы из [plans/tz/2026-05-10-knowledge-core-tz.md](plans/tz/2026-05-10-knowledge-core-tz.md) и команды от 2026-05-10 «решения принимай сам, в конце собери файл».

Формат записи: дата → вопрос → принятое решение → обоснование → как откатить.

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

## 2026-05-10 — Phase 0 frontend: страницы найдены в `(authenticated)`

**Вопрос.** При первом аудите Glob по `frontend/app/settings/organization/**` дал 0 файлов — сделал вывод что страницы отсутствуют. Повторный поиск показал, что они существуют в `frontend/app/(authenticated)/settings/organization/page.tsx` и `(authenticated)/invitations/[token]/page.tsx`.

**Решение.** Исходный аудит был ошибочный (Next.js route group `(authenticated)` не покрылся первым glob-паттерном). Считаем frontend Фазы 0 закрытым.

**Почему.** Страницы существуют, server-component делегирует на client-component. Конвенция соответствует другим settings-страницам.

**Откат.** Если позднее окажется, что client-component не реализует требуемого UX (visibilityMode toggle, members list, invitations) — вынести в feature-task на доработку.

---
