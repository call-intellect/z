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

## 2026-05-10 — Phase 0 frontend: страницы найдены в `(authenticated)`

**Вопрос.** При первом аудите Glob по `frontend/app/settings/organization/**` дал 0 файлов — сделал вывод что страницы отсутствуют. Повторный поиск показал, что они существуют в `frontend/app/(authenticated)/settings/organization/page.tsx` и `(authenticated)/invitations/[token]/page.tsx`.

**Решение.** Исходный аудит был ошибочный (Next.js route group `(authenticated)` не покрылся первым glob-паттерном). Считаем frontend Фазы 0 закрытым.

**Почему.** Страницы существуют, server-component делегирует на client-component. Конвенция соответствует другим settings-страницам.

**Откат.** Если позднее окажется, что client-component не реализует требуемого UX (visibilityMode toggle, members list, invitations) — вынести в feature-task на доработку.

---
