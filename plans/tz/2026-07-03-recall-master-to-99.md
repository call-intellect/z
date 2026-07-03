---
type: tz
status: ready-to-implement
feature: recall-master-to-99
date: 2026-07-03
owner: владелец
relates_to:
  - plans/architecture/2026-07-03-recall-master-to-99.md
  - plans/analysis/2026-07-02-recall-master-after-redesign.md
  - plans/tz/2026-07-02-recall-master-retrieval-redesign.md
  - second-brain/04_не-сделано/README.md
---
> Архитектура (одобрена владельцем 2026-07-03): `plans/architecture/2026-07-03-recall-master-to-99.md` (status: approved) · Приёмка предыдущего захода: `plans/analysis/2026-07-02-recall-master-after-redesign.md` · Ретрив-слой: ТЗ `2026-07-02-recall-master-retrieval-redesign.md` (Ф1-Ф7, коммиты b487ebe8..33ddade8).

# ТЗ — «Мастер» с 79% до 99–100% (ассертивный синтез + резолв + детерминизм + AGE)

**Принцип.** Поиск уже чинён (граф всегда, boost, EntityLink, каскад, адаптив — Ф1-Ф7). Теперь чиним **последнюю милю**: как найденное превращается в ответ. Владелец снял запрет на осторожность ради охвата: **отвечаем всегда, когда в контексте есть основание — уверенно, полно и структурно; молчим ТОЛЬКО когда данных реально нет; не выдумываем фактов, которых в контексте нет.** Плюс дотягиваем резолв сущностей (эмбеддинг) и детерминизм понималщика (период/список), и — отдельным блоком — стабилизируем и подключаем к recall уже существующий граф-движок AGE. Всё аддитивно, за kill-switch (Ship-On, ON), пороги через `getDynamic`. Замер — перепрогоном 111 + панель судей + прогон на новых вопросах.

**Вне scope / решения-судьбы хвостов:**
- Переписывание ретрив-слоя (Ф1-Ф7 сделаны) — не трогаем, опираемся.
- Выдумывание фактов на пустом контексте — **🚫 остаётся запретом** (galлюцinaции на реально пустом = провал приёмки).
- Настоящая переработка извлечения памяти (block-ingest) — отдельные ТЗ (не здесь).
- Визуальный редизайн чата — не здесь.

## Цель + Зачем

Приёмка предыдущего захода (перепрогон 111, панель судей): **верно 79.3% (88/111), частично 13, ложно-пусто 9, неверно 1, галлюцинаций 0.** Владелец: «79 мало, охват важнее, честность можно немного снизить — что нужно к 99%». **Цель: верно ≥95% на банке 111 И на новых вопросах (99–100% — ориентир-максимум), при выдумках ≤ ~2–3% (сейчас 0), сохранив «не выдумываем на пустом».** Остаток провалов — в синтезе (пере-осторожный groundedness-гейт + неполнота), глубине резолва (45%) и недетерминизме понималщика (период/список) — доказано разбором каждого из 22 незакрытых вопросов в after-report.

## REALITY-CHECK (факт по коду, проверено research-фан-аутом 2026-07-03)

- **Отказ «не хочу выдумывать» — это НЕ промпт, а отдельный ПОСТ-синтез groundedness-гейт (главный виновник over-abstain).** `ChatV2OrchestrationService.applyGroundednessGate` (`backend/src/modules/chat-v2/chat-v2.service.ts:456-529`, якорь-символ `private async applyGroundednessGate`; строки дрейфуют — перечитать). Режим — AdminSetting `rag.groundedness_mode` (`off|shadow|on`, default **on**, реестр `admin-setting-schema-registry.ts` якорь `['rag.groundedness_mode'`). В режиме `on`: после синтеза отдельный LLM-судья (`taskType:'rag-groundedness'`, промпт `RAG_GROUNDEDNESS_SYSTEM_PROMPT` в `knowledge-core/prompts/rag-pipeline.prompts.ts`) возвращает `{grounded,reason}`; при `grounded=false` **перезаписывает готовый ответ модели** на хардкод-константу `GROUNDEDNESS_HONEST_ABSTAIN` (`chat-v2.service.ts:563`, якорь `не хочу выдумывать`) + `citations:[]`. Fail-open (сбой судьи/JSON → ответ не трогается). Это гасит q054/q057/q060/q025/q066/q067 — синтез РОДИЛ ответ, гейт затёр.
- **Три РАЗНЫХ отказных механизма, не путать:** (А) промпт-правило 4 `BASE_SYSTEM_PROMPT` (`knowledge-core/services/chat-v2.service.ts:663-664`, якорь «Честно про пустоту», мягкое, без хвоста «не хочу выдумывать»); (Б) детерминированный empty-context guard ДО LLM (`chat-v2.service.ts:1004-1043`, якорь `contextBlocks.length === 0 &&`, при полностью пустом пуле — заглушка `modelUsed:'none'`, «…в памяти ничего не нашлось», синтез не зовётся; **это КОРРЕКТНО для реально пустого — сохраняем**); (В) groundedness-гейт выше (пере-осторожный — ретюним).
- **Синтез уже структурирует, но не железно.** `BASE_SYSTEM_PROMPT` правило 7 «Структура по содержанию» (`chat-v2.service.ts:673-675`), самопроверка (`:746`). Реальные ответы (q043/q050/q034) уже с подзаголовками/списками — но неполнота (13 partial) показывает, что «полно и структурно» не гарантировано.
- **Эмбеддинг-резолв УЖЕ есть и использует `Entity.embedding` (vector(1536)).** `resolvePersonByEmbedding` (`entity-resolution.service.ts:1083`, RAW `1-(e.embedding <=> $1::vector(1536))` JOIN persons↔Entity, порог `knowledge.entity_name_resolve_threshold` 0.9); эталон KNN — `knnResolve` (`:442`, `embedding <=> $1::vector(1536) ORDER BY distance LIMIT 3`). А grounding понималщика `resolveGroundingHints` (`query-plan-extractor.service.ts:650`) — СЕЙЧАС чисто лексический (ILIKE `contains` + `aliases hasSome`). `KnowledgeEmbeddingService` в `QueryPlanExtractorService` НЕ инжектится (только `@Optional EntityResolutionService`).
- **Детерминированный override уже есть для КЛАССА, но не для ПЕРИОДА.** `classifyQueryClass` (`query-classifier.service.ts:94`, регэкспы LIST/TEMPORAL/OVERVIEW/FACT/TOPIC) → `resolveQueryClass` (`query-plan-extractor.service.ts:299`) берёт детерминированный класс при confidence ≥ 0.7 (LLM игнорируется). Период же идёт от LLM: `buildPlanFromRaw` (`:319`) `coercePeriodExpr(raw.periodExpr)` (`:327`) → `resolvePeriod(periodExpr, todayIso, orgTimezone, periodDays)` (`:340`, чистая функция `period-resolver.ts:85`). q054/q060 срываются, когда LLM не выставил periodExpr. Место для детерминированного override — между `:327` и `:340`.
- **AGE УЖЕ введён, но частично не работает (не строим с нуля — стабилизируем+подключаем).** `postgres-init.sql` (`CREATE EXTENSION age` + `create_graph('z_graph')` + `ALTER ROLE ... SET search_path = ag_catalog`); полноценный `src/common/graph/graph.service.ts` (`addNode/removeNode/addEdge/traverse/neighbors/findPath`), `cypher-builder.ts` (whitelist меток/30 типов связей + escaper), флаг `graph.ageEnabled` (typed-config, ENV `GRAPH_AGE_ENABLED`, default true). Вызов Cypher из Node: `SELECT * FROM cypher('z_graph',$cypher$ ... $cypher$) AS (v agtype)` через `$queryRawUnsafe` (Prisma7/pg — работает). pgvector + AGE уживаются. **НО:** (1) на части окружений `cypher()` не резолвится (`42883`/search_path — smoke `age_node` FAIL, «known bug #3/#11/#12»); (2) синхронизация граф↔реляционка best-effort БЕЗ реконсиляции → граф дрейфует; (3) параметризация через самодельный `escapeString` (только `\` и `'`) → риск инъекций/падений на «грязных» данных; (4) retrieval recall граф AGE НЕ запрашивает (использует реляционные `IdeaBlockLink`/`EntityLink`). **Честно: подключение AGE к recall на банке 111 почти не двинет число (multistep 7/111 уже отвечаются) — это инвестиция в прочность; владелец решил делать сейчас.**
- **Инструмент замера ГОТОВ:** `backend/scripts/batch-recall-trace.ts` + `analyze-recall-results.ts` + банк `docs/testing/strela-recall-questions.json` (111). Тенант «Стрела» `cmr1qbvpx0001pwbwxbgmh1jl` в локальной dev-БД (292 блока). **Answer-кэш Redis `dlg:ans:<tenant>:*` чистить перед каждым перепрогоном** (иначе кэш-хиты возвращают старые ответы без трассы). Панель судей — Workflow (см. Ф6).
- **Context7 в окружении research был недоступен** — данные по AGE взяты из age.apache.org/age-manual, github.com/apache/age, исходников репозитория; при реализации AGE-фаз перепроверить актуальный API.

## Принятые решения владельца (2026-07-03, не пересматривать)
| # | Решение | Обоснование |
|---|---|---|
| В1 | Делаем ВСЁ сразу: рычаги синтеза/резолва/детерминизма (к 99%) + AGE | «Всё, что ведёт к 99–100%, должно быть»; AGE — как инвестиция в прочность |
| В2 | Граница честности — «ассертивно, но только из контекста»: отвечаем всегда при основании, не выдумываем на пустом, выдумки ≤ ~2–3% | Скачок охвата почти без риска стать «вруном»; «меньше честности» = смелость называть найденное, не фантазии |
| В3 | Структурированный связный ответ — обязателен (не сырые цитаты) | Требование владельца: ответ = осмысленный разбор |
| В4 | Зачёт — верно ≥95% на банке И на новых вопросах при выдумках ≤ порога; 99–100% — ориентир | Не оптимизировать под 111 (оверфит), а улучшить продукт |

## Доказательство выбора (кратко; полный разбор — after-report)
- **Ассертивность через ретюн groundedness-гейта, не через снос честности (Ф1).** A: убрать гейт совсем (`mode=off`) → теряем страховку от реальных выдумок (риск >3%). B: ретюн — гейт остаётся, но абстинит ТОЛЬКО на реально не-заземлённом (мягкий судья) + мягчим промпт-правило 4; выдумки под контролем ≤ порога. Выбран B (В2). Пруф-петля: чиним КЛАСС (гейт затирает любой «неуверенный» ответ), не кейс; переиспользуем существующий гейт (не новый код).
- **Резолв — эмбеддинг поверх лексики, не вместо (Ф2).** A: заменить ILIKE на эмбеддинг → часть старых Entity без embedding выпадут. B: объединять эмбеддинг-KNN + лексический fallback. Выбран B. Переиспользуем `knnResolve`/`resolvePersonByEmbedding` (не новый SQL).
- **Период — детерминированный override поверх LLM (Ф3), по готовому образцу `resolveQueryClass`** (класс уже так решается) — не новый паттерн.
- **AGE — стабилизировать существующее, не строить/не откатывать (Ф4-Ф5).** Слой написан и дорог; корень течи (42883 + дрейф + escaper) — в ядре; чинить = защищать ров. Подключение к recall — за kill-switch, честно bank-neutral.

## Scope
**Входит:** Ф1 (ассертивный синтез + структура), Ф2 (эмбеддинг-grounding резолва), Ф3 (детерминизм период/список), Ф4 (стабилизация AGE-графа), Ф5 (подключение AGE к recall), Ф6 (перепрогон + новые вопросы + приёмка).
**Не входит (судьба каждого хвоста):** выдумки на пустом (🚫 навсегда); переписывание извлечения (отдельные ТЗ); замена самодельного Cypher-escaper на полноценную параметризацию глубже необходимого для безопасности Ф4 (полный редизайн параметризации AGE — vNext-заглушка в реестре не-сделанного, если Ф4 закроет лишь острый риск); UI чата.

## Границы фичи
- ✅ **Always:** новые пороги/веса/флаги — через `getDynamic` + реестр `admin-setting-schema-registry.ts` + сид + строка в `docs/operations/feature-flags.md`; каждое поведение за kill-switch ON (Ship-On); все запросы с `tenantId`; синтез cache-friendly (стабильный SYSTEM, переменное — в USER).
- ⚠️ **Ask first:** менять дефолт существующих `rag.groundedness_mode`/`knowledge.entity_name_resolve_threshold`/`GRAPH_AGE_ENABLED` глобально (влияет на другие потоки); включать AGE-запросы в recall на проде до зелёного smoke Ф4.
- 🚫 **Never:** выдумывать факты, которых нет в контексте (galлюцinaции на пустом = провал В2/приёмки); хардкод порога мимо `getDynamic`; `process.env.*` напрямую; Cypher из непроэкранированного пользовательского ввода (инъекция); читать чужой тенант.

## Крутилки (новые — реестр + сид + feature-flags + getDynamic)
| Ключ | Тип | Дефолт | Фаза |
|---|---|---|---|
| `knowledge.chatV2AssertiveSynthesis` | bool | true | Ф1 |
| `knowledge.chatV2GroundednessMode` | enum off\|shadow\|lenient\|on | lenient | Ф1 |
| `knowledge.chatV2GroundingEmbedding` | bool | true | Ф2 |
| `knowledge.chatV2GroundingEmbeddingTopK` | int | 10 | Ф2 |
| `knowledge.chatV2GroundingEmbeddingMinSim` | float | 0.35 | Ф2 |
| `knowledge.chatV2DeterministicPeriod` | bool | true | Ф3 |
| `knowledge.chatV2GraphCypherRecall` | bool | true | Ф5 |
| `knowledge.chatV2GraphCypherMaxDepth` | int | 3 | Ф5 |
| `knowledge.graphReconcileEnabled` | bool | true | Ф4 |
| `knowledge.graphReconcileBatchSize` | int | 500 | Ф4 |

Существующие (не менять дефолт без ⚠️): `rag.groundedness_mode` (0.6…), `knowledge.entity_name_resolve_threshold` (0.9), `GRAPH_AGE_ENABLED`/`graph.ageEnabled` (true), `rag.k_retrieve` (30), `rag.k_context` (18).

## Фазы (dependency-ordered)

Граф зависимостей: **Ф1 ∥ Ф2 ∥ Ф3 (независимы — разные файлы) → Ф6. Ф4 → Ф5 → Ф6. Ф4/Ф5 независимы от Ф1-Ф3.** Ф1 трогает `modules/chat-v2/chat-v2.service.ts` + `knowledge-core/…/chat-v2.service.ts` (промпт); Ф2 — `query-plan-extractor.service.ts` (+ возможно `entity-resolution.service.ts`); Ф3 — `query-plan-extractor.service.ts` + `period-resolver.ts`. Ф2 и Ф3 трогают ОДИН файл `query-plan-extractor.service.ts` → **Ф2 и Ф3 последовательно** (сначала Ф2, потом Ф3). Ф4-Ф5 — граф-слой, независимы.

---
### Ф1 — Ассертивный, но заземлённый синтез + обязательная структура
**Ценность:** как сотрудник, спрашивающий «кто отвечает за безопасность?», получаю «Наталья» (она в контексте), а не «не хочу выдумывать» — потому что сборщик называет найденное уверенно, а гейт не затирает заземлённый ответ.
**Что входит:**
- (а) **Ретюн groundedness-гейта.** Ввести режим `lenient` в `applyGroundednessGate` (`modules/chat-v2/chat-v2.service.ts:456-529`): читать через `getDynamic<string>('knowledge.chatV2GroundednessMode', undefined, 'lenient')` (новый ключ; НЕ менять глобальный `rag.groundedness_mode`). В `lenient` — судья вызывается, но абстин применяется ТОЛЬКО когда `grounded=false` И judge-`reason` указывает на реальную выдумку/противоречие контексту (не «неполно/неуверенно»). Ужесточить `RAG_GROUNDEDNESS_SYSTEM_PROMPT` (`knowledge-core/prompts/rag-pipeline.prompts.ts`) под `lenient`: «grounded=false ТОЛЬКО если ответ утверждает конкретный факт, которого НЕТ в блоках; неполнота, осторожные формулировки, вывод-по-контексту — это grounded=true». `on` = прежнее строгое поведение (kill-switch отката). `off`/`shadow` — как есть.
- (б) **Мягчение промпт-правила 4** `BASE_SYSTEM_PROMPT` (`knowledge-core/services/chat-v2.service.ts:663-664`): «Если в контексте ЕСТЬ основание (даже неполное/косвенное) — отвечай уверенно и назови найденное. Молчи („В памяти компании я этого не нашёл“) ТОЛЬКО когда по вопросу в контексте реально ничего нет. Не выдумывай фактов, которых в контексте нет.» За `getDynamic<bool>('knowledge.chatV2AssertiveSynthesis', undefined, true)` — при OFF старый текст правила 4 (kill-switch). Реализация: правило 4 собирается из константы по флагу (две версии текста), НЕ ломая prompt-caching (SYSTEM стабилен в рамках значения флага).
- (в) **Обязательная структура** (В3): усилить правило 7 + самопроверку `BASE_SYSTEM_PROMPT` (`:673-675`, `:746`): «Ответ — связный разбор: короткое резюме → суть по пунктам/подзаголовкам → кто/что/когда → при необходимости „что дальше“. НЕ набор цитат и НЕ сырой пересказ блоков. Полно: включи ВСЕ существенные факты из контекста по вопросу, не выбирай подмножество.» Добавить в самопроверку строку «Ответ структурен и включает все существенные факты из контекста?».
**Что НЕ входит:** менять empty-context guard (Б — корректен для пустого); менять `taskType`/модель судьи; трогать `rag.groundedness_mode` глобально.
**Файлы:** `backend/src/modules/chat-v2/chat-v2.service.ts` (`applyGroundednessGate`, `GROUNDEDNESS_HONEST_ABSTAIN`-путь, чтение нового ключа); `backend/src/modules/knowledge-core/services/chat-v2.service.ts` (`BASE_SYSTEM_PROMPT` правила 4/7/самопроверка, флаг сборки); `backend/src/modules/knowledge-core/prompts/rag-pipeline.prompts.ts` (`RAG_GROUNDEDNESS_SYSTEM_PROMPT` под lenient); реестр+сид+feature-flags.
**Acceptance:** (1) unit: `applyGroundednessGate` в `lenient` при `grounded=false`+reason=«неполно» НЕ перезаписывает ответ (возвращает синтез как есть); при reason=«выдумал факт X» — перезаписывает на abstain. (2) unit: `mode='on'` воспроизводит прежнее поведение (перезапись при любом grounded=false). (3) unit: `chatV2AssertiveSynthesis=false` → правило 4 = старый текст (греп-маркер старой фразы). (4) snapshot BASE_SYSTEM_PROMPT обновлён осознанно (`chat-v2-base-prompt.snapshot.spec.ts`). (5) на перепрогоне Ф6: q025/q066/q067 (ЛПР/безопасность есть в контексте) → verdict CORRECT; 13 partial → доля partial падает; выдумки ≤ порога. (6) `bun run typecheck && lint && build` зелёные по затронутым.
**Закрывает:** R1, R2, R3.

### Ф2 — Эмбеддинг-grounding резолва сущности (45% → выше)
**Ценность:** как сотрудник, называющий вещь по-своему («CRM», «медиа-движок»), получаю ответ про «Битрикс»/«LiveKit» — потому что справочник понимает вопрос по смыслу, а не по буквам.
**Что входит:** расширить `resolveGroundingHints` (`query-plan-extractor.service.ts:650`) эмбеддинг-путём: `embeddings.embedQuery(question)` → KNN по `Entity.embedding` (образец SQL — `knnResolve` `entity-resolution.service.ts:442`/`:470`, `embedding <=> $1::vector(1536) ORDER BY distance LIMIT k`, фильтр `tenantId + mergedIntoId IS NULL + embedding IS NOT NULL`, БЕЗ type-фильтра и БЕЗ жёсткого порога reuse). Порог/лимит — `getDynamic('knowledge.chatV2GroundingEmbeddingMinSim', undefined, 0.35)` / `('knowledge.chatV2GroundingEmbeddingTopK', undefined, 10)`. Объединять с текущим лексическим списком (эмбеддинг + ILIKE fallback), дедуп по lower, финальный cap `chatV2GroundingTopK`. За kill-switch `getDynamic<bool>('knowledge.chatV2GroundingEmbedding', undefined, true)` — OFF = только лексика (прежнее). Fail-open (эмбеддинг упал → лексика).
**Решение по DI (техническое):** `KnowledgeEmbeddingService` в `QueryPlanExtractorService` НЕ инжектится. Вынести grounding-KNN отдельным методом в `EntityResolutionService` (там уже есть `embeddings` и образец `resolvePersonByEmbedding`), напр. `resolveEntityHintsByEmbedding(tenantId, question, topK, minSim): Promise<string[]>` (канон-имена), и звать из `resolveGroundingHints` через уже инжектнутый `@Optional entityResolution` (fail-open если undefined). Это симметрично существующему и не тащит новый DI в понималщик.
**Что НЕ входит:** менять порог `entity_name_resolve_threshold`; backfill embedding у старых Entity (лексика их ловит — fallback); менять `resolvePersonByHint`/каскад людей (там эмбеддинг уже есть).
**Файлы:** `backend/src/modules/knowledge-core/services/entity-resolution.service.ts` (новый метод `resolveEntityHintsByEmbedding`); `backend/src/modules/dialog-layer/services/query-plan-extractor.service.ts` (`resolveGroundingHints` — вызов + слияние); реестр+сид+feature-flags.
**Acceptance:** (1) unit: `resolveEntityHintsByEmbedding` строит RAW SQL с `embedding <=> $1::vector(1536)`, `tenantId`, `mergedIntoId IS NULL`, `LIMIT topK`; мок prisma → возвращает canonicalName-ы. (2) unit: `resolveGroundingHints` при `chatV2GroundingEmbedding=true` объединяет эмбеддинг+лексику без дублей; при OFF — только лексика (эмбеддинг-метод не зван). (3) unit: fail-open — эмбеддинг упал → результат = лексический список. (4) на перепрогоне Ф6: резолв сущности (`resolvedEntityIds/PersonIds` непусты на вопросах с `expectedEntities`) > 60% (было 45%); контрольные пары CRM→Битрикс, медиа-движок→LiveKit резолвятся. (5) typecheck/lint/build зелёные.
**Закрывает:** R4.

### Ф3 — Детерминизм понималщика: период и список без случайности
**Ценность:** как руководитель, спрашивающий «покажи все встречи за неделю», всегда получаю полный список встреч — потому что период и «это список» считаются формулой, а не угадываются ИИ.
**Что входит:** детерминированный override периода в `buildPlanFromRaw` (`query-plan-extractor.service.ts:319`) между `coercePeriodExpr` (`:327`) и `resolvePeriod` (`:340`), по образцу `resolveQueryClass` (`:299`). Новая чистая функция `detectPeriodExpr(question): { expr: PeriodExpr; periodDays: number|null; confidence: number }` в `period-resolver.ts` (рядом с `resolvePeriod`, регэкспы «на этой/прошлой неделе», «вчера/сегодня», «этот/прошлый месяц», «за последние N дней/за месяц» — как `LIST_PATTERNS`). Если детерминированный `confidence` высок И LLM дал `none`/иное — override перед `resolvePeriod`. **Учесть confidence-гейт** (`:351`, `applied` требует `confidence ≥ 0.6` И `hasAnyFilter`): при детерминированном периоде поднять итоговый `confidence` до ≥0.6, чтобы фильтр применился (иначе override бесполезен — `applied=false`). За kill-switch `getDynamic<bool>('knowledge.chatV2DeterministicPeriod', undefined, true)` — OFF = прежнее (период только от LLM). Класс уже детерминирован (`resolveQueryClass` при conf ≥0.7) — не трогаем.
**Что НЕ входит:** менять `classifyQueryClass`/`resolvePeriod` (используем как есть); трогать `understand`-промпт ось периода; убирать двойной вызов понималщика в харнессе (это тест-артефакт, не прод-путь).
**Файлы:** `backend/src/modules/dialog-layer/services/period-resolver.ts` (новый `detectPeriodExpr`); `backend/src/modules/dialog-layer/services/query-plan-extractor.service.ts` (`buildPlanFromRaw` override + confidence); реестр+сид+feature-flags.
**Acceptance:** (1) unit `detectPeriodExpr`: «за последнюю неделю»→last_week; «вчера»→yesterday; «за последние 10 дней»→last_n_days+10; «что по продажам»→none. (2) unit `buildPlanFromRaw`: LLM дал `periodExpr='none'`, но вопрос «встречи за неделю» + `chatV2DeterministicPeriod=true` → итоговые `dateFrom/dateTo` непусты И `applied=true`. (3) OFF-флаг → период только от LLM (override не срабатывает). (4) на перепрогоне Ф6: q054/q060 («встречи/созвоны за неделю») → verdict CORRECT (перечень встреч периода). (5) typecheck/lint/build зелёные.
**Закрывает:** R5.

### Ф4 — Стабилизация существующего AGE-графа (prerequisite для Ф5)
**Ценность:** как компонент recall, полагающийся на граф, получаю рабочий и не дрейфующий граф — потому что `cypher()` резолвится на всех коннектах и фоновая реконсиляция держит граф в соответствии с реляционкой.
**Что входит:**
- (а) **Корень 42883/search_path.** Убедиться и зафиксировать: `shared_preload_libraries='age'` на проде (Yandex Managed PG16 — настройка кластера); `ALTER ROLE` применён к рантайм-роли; **скриптовый `createPrismaClient` (`scripts/_lib/prisma.ts`) получает `options: '-c search_path=ag_catalog,"$user",public'`** ЛИБО все Cypher-вызовы квалифицированы `ag_catalog.cypher(...)`. Устранить FAIL `age_node` в smoke-pipeline-e2e. Наблюдаемость — метрика `age_unavailable` (уже есть) в реестр.
- (б) **Фоновая реконсиляция** (закрывает дрейф): `@Cron`/BullMQ-джоб `graph-reconcile` — читает `Entity`/`EntityLink`/`IdeaBlockLink` где `deletedAt IS NULL` батчами (`getDynamic('knowledge.graphReconcileBatchSize', undefined, 500)`, инкремент `WHERE updatedAt > lastSync`), идемпотентный `MERGE` вершин/рёбер в `z_graph` через существующий `GraphService`/`CypherBuilder`, а `status=archived`/`deletedAt` → `DETACH DELETE`. За kill-switch `getDynamic<bool>('knowledge.graphReconcileEnabled', undefined, true)`. Идемпотентность MERGE = повторный прогон no-op (acceptance).
- (в) **Безопасность параметризации (острый риск):** покрыть тестами на «злые» входы существующий `CypherBuilder.escapeString`; расширить экранирование до переводов строк/юникода, ЕСЛИ тесты вскроют дыру. (Полный редизайн параметризации через prepared-statements — vNext-заглушка в реестре, если острый риск закрыт escaper-ом.)
**Что НЕ входит:** переписывать `GraphService` с нуля; менять модель графа `z_graph`; апгрейд PG-мажора.
**Файлы:** `backend/scripts/_lib/prisma.ts` (search_path options); `backend/src/common/graph/graph.service.ts` / `cypher-builder.ts` (escaper-тесты/усиление); новый воркер/cron `graph-reconcile` (`backend/src/modules/knowledge-core/workers/` или рядом с граф-слоем); `docs/operations/feature-flags.md` (`GRAPH_AGE_ENABLED` тип + новые флаги); реестр+сид.
**Acceptance:** (1) smoke: `cypher('z_graph', 'RETURN 1')` резолвится из скриптового `createPrismaClient` (нет 42883). (2) unit: `graph-reconcile` идемпотентен — второй прогон = no-op (MERGE не создаёт дублей; мок GraphService). (3) unit: reconcile удаляет (`DETACH DELETE`) ребро с `status=archived`. (4) unit: `CypherBuilder.escapeString` не ломается на входе с `'`, `\`, переводом строки, юникодом (грязная строка из встречи не даёт инъекции/падения). (5) метрика `age_unavailable` и лог reconcile наблюдаемы. (6) typecheck/lint/build зелёные.
**Закрывает:** R6, R7.
**⚠️ Прим.:** Ф4 — самостоятельная стабилизационная работа; если по ходу окажется крупнее оценки (M+), оформить остаток отдельным ТЗ `plans/tz/YYYY-MM-DD-age-graph-stabilization.md` (не блокируя Ф1-Ф3, которые дают 99% без AGE) и выполнить его тем же циклом.

### Ф5 — Подключение AGE-графа к recall (deep-hop Cypher)
**Ценность:** как руководитель со сложным вопросом «кто отвечает за то, что блокирует продажи у клиента, которого ведёт Пётр», получаю ответ через цепочку любой глубины — потому что recall спрашивает граф-движок напрямую, а не упирается в 2 реляционных шага.
**Что входит:** в retrieval-путь (`chat-v2-retrieval.service.ts`, рядом с `expandViaEntityLinks`/`expandViaGraph`) добавить граф-обход через `GraphService` (Cypher по `z_graph`): от резолвнутых `entityIds` (и/или seed-блоков) — `MATCH` пути глубины до `getDynamic('knowledge.chatV2GraphCypherMaxDepth', undefined, 3)` с фильтром `tenant_id`, собрать связанные сущности → их блоки (через `IdeaBlockEntity`) в пул (сниженный score, как граф-соседи). За kill-switch `getDynamic<bool>('knowledge.chatV2GraphCypherRecall', undefined, true)`; активируется на многошаговых (переиспользовать `detectMultiHop` из Ф7 предыдущего ТЗ). Fail-open (граф недоступен/42883 → пропуск ветки, реляционный обход отвечает). Трейс `RetrievalTraceSink` — пометка `viaSource:'age-cypher'`.
**Что НЕ входит:** заменять реляционный обход (остаётся как fallback); строить community-summaries; включать на проде до зелёного smoke Ф4 (⚠️).
**Файлы:** `backend/src/modules/knowledge-core/services/chat-v2-retrieval.service.ts` (новый метод `expandViaGraphCypher` + вызов); `chat-v2-retrieval-trace.ts` (`viaSource:'age-cypher'`); `chat-v2.service.ts` (проброс флага через ctx); реестр+сид+feature-flags.
**Acceptance:** (1) unit: при `chatV2GraphCypherRecall=true` + multiHop + непустых entityIds — `GraphService`-Cypher вызывается (спай), tenant_id в запросе; результат блоков влит в пул. (2) unit: OFF-флаг ИЛИ граф недоступен (мок бросает) → fail-open, реляционный пул возвращается, ответ не падает. (3) на перепрогоне Ф6: multistep-вопросы (q062-подобные) отвечаются не хуже (verdict не деградирует); граф-cypher-обход наблюдаем в трейсе. (4) **Честно зафиксировать в отчёте Ф6: вклад AGE в число банка ≈ 0** (multistep уже отвечались реляционно) — это ожидаемо (bank-neutral, прочность на прод). (5) typecheck/lint/build зелёные.
**Закрывает:** R8.

### Ф6 — Перепрогон 111 + новые вопросы + приёмка «до 99»
**Ценность:** как владелец, вижу числом, что дошли до цели — «было 79% → стало X%», и что на НОВЫХ вопросах тоже (не подгонка под банк).
**Что входит:** очистить answer-кэш (`dlg:ans:<tenant>:*`) → прогнать `batch-recall-trace.ts` на «Стреле» (все kill-switch ON) → `analyze-recall-results.ts` + панель судей (Workflow, как в приёмке 2026-07-03) на 111 → **плюс банк из ~20 НОВЫХ вопросов** (не из 111, тот же тенант) для проверки генерализации → отчёт «до/после» в `plans/analysis/2026-07-03-recall-master-to-99-after.md`. При недоборе — вернуть на доработку соответствующей фазы.
**Что НЕ входит:** правки кода (только замер); менять эталоны 111.
**Файлы:** `backend/scripts/batch-recall-trace.ts`, `analyze-recall-results.ts` (готовы); новый банк новых вопросов `docs/testing/strela-recall-questions-fresh.json`; новый отчёт в `plans/analysis/`.
**Acceptance (итоговая приёмка всего ТЗ):** (1) **верно (CORRECT по эталону) ≥ 95%** на 111 (было 79.3%); (2) **верно ≥ 90%** на ~20 новых вопросах (генерализация, не оверфит); (3) **выдумки ≤ ~2–3%, на реально пустом (бюджет/зарплаты) — по-прежнему честное «нет данных»** (8/8 empty-угол не выдумывает); (4) ответы **структурны и полны** (глазами по выборке + доля partial < 5%); (5) резолв сущности > 60%; (6) q025/q054/q060/q066/q067 (ключевые провалы) → CORRECT; (7) AGE-вклад в банк честно отражён (≈0, ожидаемо).
**Закрывает:** приёмка R-целей всего ТЗ (R9).

## Требования (сквозная трассировка)
- **R1** groundedness-гейт в `lenient` не перезаписывает заземлённый (но неполный/осторожный) ответ на abstain (Ф1).
- **R2** Промпт-правило 4 ассертивно: отвечать при основании, молчать только на пустом, не выдумывать (Ф1).
- **R3** Ответ структурен и включает все существенные факты контекста (Ф1).
- **R4** Резолв сущности использует эмбеддинг-KNN по `Entity.embedding` поверх лексики (Ф2).
- **R5** Период вопроса детерминирован (override LLM), «список за период» отдаёт полный перечень (Ф3).
- **R6** `cypher('z_graph', …)` резолвится на всех коннектах (нет 42883) (Ф4).
- **R7** Фоновая реконсиляция держит граф в соответствии с реляционкой (идемпотентно) (Ф4).
- **R8** recall может обходить граф AGE на глубину >2 (fail-open к реляционному) (Ф5).
- **R9** Приёмка: верно ≥95% (банк) и ≥90% (новые) при выдумках ≤ порога; на пустом не выдумывает (Ф6, все фазы).

## Сквозные аспекты
- **RBAC/tenant:** все новые запросы (эмбеддинг-KNN, reconcile, Cypher-recall) — с `tenantId`/`tenant_id`; граф мультитенантен фильтром узла. `[N/A новых эндпоинтов нет]`.
- **Observability:** метрики `age_unavailable` (есть), `chat_v2_grounding_embedding_hits`, `graph_reconcile_{merged,deleted}`, `chat_v2_graph_cypher_recall` (prom-client); трейс `RetrievalTraceSink` (`viaSource:'age-cypher'`); лог reconcile (pino).
- **Errors/идемпотентность:** синтез/резолв/Cypher — fail-open (сбой → прежний путь, не падение ответа); reconcile-джоб идемпотентен (повторный прогон no-op — acceptance).
- **Миграции данных:** `[N/A — схему не меняем; z_graph/Entity.embedding уже есть]`. Reconcile — не миграция, фоновая добивка.
- **Rollout/флаг:** каждое поведение за kill-switch ON (Ship-On); 10 новых строк в `feature-flags.md` + реестр + сид; `GRAPH_AGE_ENABLED` — зафиксировать тип флага. Дефолт существующих knobs не менять без ⚠️.
- **Тесты:** unit на каждую фазу (§Acceptance); golden-фикстуры для новой версии `RAG_GROUNDEDNESS_SYSTEM_PROMPT` (grounded/ungrounded примеры); финальный e2e = перепрогон 111 + новые (Ф6).

## Совместимость с prompt caching
- `BASE_SYSTEM_PROMPT` меняется на новую стабильную версию (одноразовая инвалидация префикс-кэша, потом стабилен). Флаг `chatV2AssertiveSynthesis` даёт ровно две константные версии правила 4 — SYSTEM стабилен в рамках значения флага. Grounding-справочник и переменные — в USER (уже так). `RAG_GROUNDEDNESS_SYSTEM_PROMPT` — отдельный judge-вызов, свой стабильный SYSTEM.

## LLM-инварианты
Синтез/судья/резолв — существующие `taskType` (`chat-v2`/`rag-groundedness`/`dialog-understand`), primary DeepSeek/OpenAI-proxy (не Anthropic); эмбеддинг — `text-embedding-3-small` через `KnowledgeEmbeddingService.embedQuery` (как `resolvePersonByEmbedding`). Не вводить новый провайдер/эмбеддинг-модель.

## Риски / Pre-mortem
- **Честность (главный).** Ассертивность может родить ПЕРВЫЕ выдумки. Митигация: гейт остаётся (в `lenient` — абстинит на реальной выдумке); промпт «не выдумывай на пустом»; empty-guard нетронут; приёмка R9 — выдумки ≤ порога И 8/8 empty честны; при превышении — ужесточить `lenient`-судью/поднять к `on`.
- **AGE bank-neutral.** Ф5 не двинет число банка — это ожидаемо и честно зафиксировано (В1: инвестиция в прочность). Не считать провалом.
- **AGE стабильность (rc-зрелость, инъекции через escaper, дрейф).** Митигация — Ф4 целиком; при крупнее оценки — отдельное ТЗ-заглушка (не блокирует 99% от Ф1-Ф3).
- **Латентность.** Эмбеддинг-KNN (+1 embed-запрос) на понимании, Cypher-обход на multiHop. Митигация: KNN cap topK; Cypher только multiHop+fail-open; замерять `seconds`.
- **Ревью-аспекты для `strict-production-review-gate`:** tenant/tenant_id во всех новых запросах; fail-open ветки; отсутствие хардкода порогов; **выдумки на пустом = 0 (honest-abstain на реально пустом сохранён)**; Cypher из непроэкранированного ввода = инъекция.

## DoD
typecheck (вкл. `.spec`)/lint/build зелёные по затронутым; unit каждой фазы; snapshot BASE_SYSTEM_PROMPT обновлён осознанно; перепрогон 111 + новые достигают чисел Ф6; second-brain обновлён (`knowledge-core.md` — ассертивный синтез + AGE-в-recall; `01_projects` при необходимости); `docs/operations/feature-flags.md` — 10 новых флагов + тип `GRAPH_AGE_ENABLED`; реестр не-сделанного — закрыть follow-up'ы предыдущего захода при достижении целей, AGE-остаток (если крупнее) — новой строкой; рефлексия; `prod-deploy-log` — сид крутилок в `STEPS`, новый reconcile-cron (Шаг 12 smoke), search_path-фикс (Шаг 5 если postgres-init затронут). Крутилки/сид/reconcile идемпотентны.

## Итог (заполнено tz-orchestrator, 2026-07-03)

**Все 5 фаз реализации закрыты и верифицированы; цель приёмки (≥95%) НЕ достигнута — честно.**

- **Ф1** ✅ реализована (коммит `562c292e`) — гейт заземления `lenient` (структурное `fabricated`), ассертивное правило 4 за флагом, структура/самопроверка, все 10 крутилок ТЗ зарегистрированы (реестр+сид+feature-flags+STEPS). **+ Ф1-guardrail** (`24bc5826`, петля приёмки) — запрет выдумок-статуса/провенанса.
- **Ф2** ✅ (`0ac3265a`) — `resolveEntityHintsByEmbedding` + слияние в `resolveGroundingHints`. Замер: `synonym` 14/15 верно.
- **Ф3** ✅ (`ad02161b`) — `detectPeriodExpr` + override в `buildPlanFromRaw`. Замер: `meetings` 0 ложно-пусто.
- **Ф4** ✅ (`bcfdd7c3` граф-примитивы + `7ed8fc34` reconcile-cron) — search_path-фикс (smoke зелёный), collision-safe dollar-quote (анти-инъекция), graph-only методы, `GraphReconcileCronService`. Вживую: граф 0→81 ребро, идемпотентно.
- **Ф5** ✅ (`75c49c2d`) — `expandViaGraphCypher` (fail-open). Вживую: обход от «Дарьи» глубины 3 → 39 сущностей. **Вклад в банк ≈0 — как предсказано ТЗ (bank-neutral, прочность).**
- **Ф6** ✅ проведена — перепрогон 111 (2 захода) + панель majority-of-3 + 25 новых.

**Числа (панель судей, after-report `plans/analysis/2026-07-03-recall-master-to-99-after.md`):**
- Банк 111: **верно ~77–79%** (76.6% заход-1, 79.3% заход-2 — один уровень в пределах шума LLM), **не ≥95%**. Ложно-пусто 9→1 (охват вырос), 13/13 пустых честны (0 галлюцинаций на пустом).
- Новые 25: **16/20 верно на отвечаемых (80%), 0 неверных, 5/5 empty честны** — генерализуется, но не ≥90%.

**Что не достигнуто и почему:** цель 95% — не тюн последней мили, а набор ОТДЕЛЬНЫХ систем вне scope (полнота синтеза broad, анафора многоходовых цепочек, точечные дыры резолва, качество извлечения block-ingest). Рычаги ТЗ сделаны и дали конкретные починки, но потолок банка на них ~77–80%. Ассертивность на первом заходе перелила честность (6 выдумок-статуса) — guardrail починил худшие кейсы (q033/q035 WRONG→CORRECT), инвариант «не выдумываем на пустом» держится.

**AGE-остаток:** entity-граф синхронизируется (reconcile); `IdeaBlockLink`→AGE (block-граф) — отдельной строкой в реестре не-сделанного (whitelist `CypherBuilder` под `IdeaBlockLinkType` + узлы `idea-block`). Ф4 не оказалась крупнее оценки — отдельное ТЗ-заглушка не понадобилась.

**Ждёт прод-выката:** 10 крутилок (сид `seed-admin-setting-recall-to-99.ts`) + reconcile-cron; миграций/ENV нет; полная инструкция — `docs/operations/prod-deploy-log.md`.
