---
date: 2026-06-27
feature: sloy-istochnika-i-marshrutizator-poiska
branch: feature/sloy-istochnika-marshrutizator
commits: df33ea2a..e588df15 + b68e9bb0 (docs)
---

# Реализация ТЗ «Слой источника + маршрутизатор поиска по классу запроса» (Ф1–Ф10)

## Что было поставлено
Реализовать целиком ТЗ `plans/tz/2026-06-27-sloy-istochnika-i-marshrutizator-poiska-tz.md` — многомаршрутный retrieval ядра памяти: партиционирование под 100–200k тенантов, слой источника, детерминированный роутер 5 классов запроса с confidence-gated both-ways, маршруты К1/К3/К4, contextual-header v2, документы-первокласс, синтез ответа по классу. Запуск — автономный: оркестратор-сессия ждала финальный reflection-push соседней ветки `feature/probe-clarify-dialog`, по триггеру ответвилась от завершённого состояния и повела реализацию через суб-агентов. Владелец задал режим: вопросы решаю сам (найти лучшее → доказать → применить → дальше), без остановок; push — двумя отдельными (код, затем рефлексия).

## Как решал
Строго по dependency-графу Ф1 → Ф2 → Ф3 → {Ф4,Ф5,Ф6,Ф7} → Ф8 → Ф10 → Ф9, фаза за фазой: картография (Explore-агент или Bash, т.к. vexp исчерпал дневной лимит) → точный промпт кодеру → независимая приёмка мной (typecheck/build/lint/тесты + re-Read рискованных артефактов) → коммит. Каждая фаза — отдельный `feat`-коммит.

- **Ф1 (df33ea2a)** — HASH-партиционирование IdeaBlock/Entity по tenantId (64, составной PK), FK-рефактор 25 связей (Cascade→reuse tenantId, SetNull/self→nullable-компаньон), ~140 call-sites, HNSW-параметры + HNSW Theme.embedding. Рукописная миграция (локальной БД нет).
- **Ф2 (5151d9df)** — модели SourceEpisode (партиц.) / SourceParticipant / SourceEntity, заполнение при ingest (`persistSourceLayer`), backfill.
- **Ф3 (8200040e)** — QueryClass (детерминир. + тай-брейк merged-understand), personIds, both-ways в runRetrieval (структурные маршруты — заглушки `[]` до Ф4-6, семантика-страховка всегда подмешана), kill-switch `router_v2_enabled`.
- **Ф4 (3e5c423d)** — К1: нечёткий резолвинг (триграммы+embedding, без равенства строки), точный обход SourceParticipant/SourceEntity→IdeaBlockEvidence→blockId, уточнение через `needsClarification`.
- **Ф5 (3bdeca0d)** — К3 temporal-ветка + фикс tz-бага (реальный IANA-tz через Intl).
- **Ф6 (5183f467)** — К4 lazy-map: top-N тем по Theme.embedding + карта тем в синтез.
- **Ф7 (5b1214f3)** — contextual-header v2 (единая чистая buildMetaLine, консистентность ingest↔backfill) + backfill ре-эмбеддинга.
- **Ф8 (61b0a2b6)** — документы: AI-title+summary (taskType document-summarize), sourceTitle→ingest, обобщение гейта summary-узла.
- **Ф10 (4abce29f)** — answerKind-контракт + ветвление синтеза по классу + системный промпт chat-v2.
- **Ф9 (e588df15)** — rerank на both-ways-merged (уже было в Ф3) + вынос хардкода пула в крутилку.

## Что вышло (верификация)
- Сквозная: **build 0 · typecheck 0 · lint 0 errors · test:unit 6647 passed** (+126 новых тестов к стартовым 6588), 65 skipped. Кросс-фазных регрессий нет.
- Стабильно падают ровно **2 средовых теста** (`ssrf-guard` `::1` — нет DNS в песочнице; `admin-webhooks-mgmt` — нет Redis) — в файлах, которые я не трогал; на проде с Redis/DNS проходят.
- **БД-приёмка** (применение 3 миграций, swap-партиционирование, HNSW/триграммы, REINDEX, интеграционные/e2e) — на проде/staging: локальной БД в среде не было (штатный режим репо — `migrate deploy` на проде).

## Чему научился
1. **Сырой SQL не покрывается typecheck — главная слепая зона партиционирования.** Ф1-рефактор call-sites через компилятор поймал 174 Prisma-вызова, но `$executeRawUnsafe('UPDATE "IdeaBlock" ... WHERE id=$2')` остался незамеченным. Партиционный прунинг реализуется только если `tenantId` явно в WHERE; масштаб-критичный retrieval-путь (`chat-v2-retrieval` HNSW) прунит корректно (был tenant-скоупным и до Ф1), а точечные by-id записи делают 64 PK-index-lookup (корректно из-за уникальности cuid, но без прунинга) — занесено в `04_не-сделано` как минорная оптимизация.
2. **GENERATED-колонка ломает swap-миграцию.** `INSERT INTO partitioned SELECT * FROM old` падает на `search_tsv GENERATED ALWAYS` даже при 0 строк; `LIKE INCLUDING DEFAULTS` теряет генерацию. Фикс: `INCLUDING GENERATED` + явный список колонок без generated. Поймано ревью миграции (без БД агент не мог).
3. **Stale-тесты после смены ключа Prisma — двойная: ассерты И моки.** `toHaveBeenCalledWith({where:{id}})` компилируется (objectContaining не строг по внутренней форме), но падает в рантайме на `id_tenantId`; плюс mock-реализации, читающие `arg.where.id`, тихо возвращали null. Полный `test:unit` — единственный надёжный детектор; нашёл 30 падений, которые targeted-прогон 5 спеков не показал.
4. **both-ways со заглушками-маршрутами — правильная декомпозиция.** Ф3 ввёл развилку + инвариант «семантика подмешана всегда» при `runStructuralRoute → []`; Ф4/Ф6 потом наполнили заглушку без изменения контракта retrieval. Поведение оставалось рабочим на каждой фазе.
5. **Дисциплина чужой незакоммиченной работы при ответвлении.** Ветка унаследовала чужую правку `second-brain/index.md` (строка probe-observers-catalog другой сессии). Везде стейджил явными путями; в финале doc-агент дописал свою строку в index.md — пришлось откатить ТОЛЬКО свой хунк (не `git checkout` всего файла — это стёрло бы чужую работу) и не коммитить index.md.
6. **Автономный watch→handoff работает.** CronCreate-цикл (15 мин) на детект reflection-push соседней ветки → ответвление от завершённого состояния → реализация. Триггер — именно tip = `docs(second-brain): рефлексия` новее baseline (в ветке уже были старые рефлексии — нужен baseline, не «есть ли рефлексия»).
