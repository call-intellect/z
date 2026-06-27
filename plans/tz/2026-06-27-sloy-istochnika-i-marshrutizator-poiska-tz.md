---
type: tz
status: ready-to-implement
feature: sloy-istochnika-i-marshrutizator-poiska
date: 2026-06-27
owner: sergrv80@gmail.com
relates_to:
  - plans/analysis/2026-06-27-sloy-istochnika-i-marshrutizator-poiska.md
  - plans/tz/2026-06-23-knowledge-graph-ingestion-rebuild.md
  - plans/analysis/2026-06-25-iterative-rag-method-parked.md
  - plans/tz/2026-06-23-edinyy-pomoshnik-arhitektura.md
---
> Анализ: `plans/analysis/2026-06-27-sloy-istochnika-i-marshrutizator-poiska.md` (status: research-complete) · Статус согласования развилок: 2026-06-27 (все закрыты владельцем, §8 анализа)

# ТЗ — Слой источника + маршрутизатор поиска по классу запроса

## Принцип
Поиск памяти компании отвечает на ЛЮБОЙ вопрос одинаково — плоским векторным top-k по дистиллированным фактам (`IdeaBlock`). Это архитектурно не обслуживает 4 из 5 классов вопросов (список/агрегат, временной итог, обзор-карта). Делаем **многомаршрутный retrieval**: детерминированный роутер класса → приоритетный маршрут + confidence-gated подстраховка (никогда не пусто) + слияние RRF, поверх **слоя источника как первоклассного объекта** (нормализованные участники/сущности/эпизод-резюме) и **партиционированных по тенанту** векторных индексов. Проектируем СРАЗУ под 100–200k тенантов — без переписывания при росте.

## Вне scope / отложено владельцем
- **Полная предрасчитанная community-иерархия (полный GraphRAG)** — НЕ строим. К4 = lazy-map поверх `Theme.summary` (решение владельца §8.3 анализа). Причина: устаревает при ежедневном ingest, растёт super-linear; LazyGraphRAG даёт качество выше при ~0.1% стоимости.
- **Само-растущие верхние «ветки»** — НЕ вводим. 12 `ThemeBranch` фиксированы, рост на уровне `Theme` (листья, per-tenant) (§8.4). К4 вязать на `Theme.embedding`-близость, не на enum.
- **Материализация Битрикс-чата** — код-способность (модели/ingest/контракт роутера) строим, но наполнение данными вне scope (внешний блокер — живой поток из Битрикса). vNext: отдельное ТЗ интеграции Битрикса.
- **Воскрешение staged route→plan→sufficiency в чате** — НЕ делаем (заморожено в `iterative-rag-method-parked.md` для будущего «Большого отчёта»). chat-v2 остаётся single-pass.
- **Cross-encoder reranker-сервис как новая инфра** — НЕ вводим. Используем существующий `conditionalRerank` (LLM-as-reranker, `chat-v2.service.ts:1005`).

## Цель + Зачем
**Болезненное состояние (слова владельца):** «умная система, но тупая» — не находятся «какие встречи были с Ивановым», «все встречи где обсуждали X», «документы про Y», «что решали в группе/чате Z», «итоги за месяц и почему хорошо/плохо».

**Чем решение лучше:** запрос-список → детерминированный SQL (100% полнота, не «похожее»); запрос-итог → готовая свёртка; запрос-обзор → карта тем; запрос-тема → гибрид с обогащённым контекстом. Доказательная база — анализ §3–§7 (рынок РФ+зарубеж, Anthropic Contextual Retrieval −49/67%, GraphRAG local/global, multi-tenant pgvector Curator 32.9×, LazyGraphRAG).

## REALITY-CHECK (фактическое состояние кода, verified чтением 2026-06-27)
Половина инфраструктуры **уже построена правильно** — это работа по достройке связок, не переписывание:
- ✅ **Гибрид dense+BM25+RRF** — в проде: `utils/rank-fusion.util.ts:5,21` (`reciprocalRankFusion` k=60), `chat-v2.service.ts:988` (`fuseRankedLists`), `IdeaBlock.search_tsv` tsvector(russian) + GIN (`postgres-init.sql:184,192`).
- ✅ **Recall-safe структурный путь** — `chat-v2-retrieval.service.ts:289` ветвит: структурный фильтр → полный pre-filtered скан (`rankByStructuralFilter:770`), чистая семантика → HNSW-срез (`collectPool:401-409`). Главный recall-killer уже обойдён.
- ✅ **Параллельный retrieval** — `chat-v2.service.ts:ask:688` уже `Promise.allSettled([retrieval, tableBranch])`.
- ✅ **Роутер-извлечение наполовину** — `query-plan-extractor.service.ts` извлекает `entityHints`/`personScope`/`periodExpr`/`themeBranches`/`confidence` (порог `QUERY_PLAN_MIN_CONFIDENCE=0.6:76`), fail-open. `query-classifier.service.ts:62-99` — regex-эвристика классов (зачаток детерминированного роутера).
- ✅ **Слой карты/времени построен, НЕ подключён к чату** — `Theme.summary:4289`+`Theme.embedding:4284`; `operations` `weekly-digest.service.ts:87`/`value-recap.service.ts:46` (verified: grep по chat-v2/dialog-layer/knowledge-core на `*Digest`/`ValueRecapSnapshot` = пусто).
- ✅ **Эпизод-узел встречи** — `block-ingest.worker.ts:977` `maybePersistMeetingSummary` (гейт `:983` `sourceType==='meeting_report'`).
- ✅ **Контекст-заголовок** — `chunk-context.service.ts:31` `buildContextHeader` (крутилка `knowledge.contextual_header_enabled`), эмбедится `embedding.service.ts:14`.
- ❌ **Чего нет:** роутер 5 классов и both-ways-разводка; нормализованные `SourceParticipant`/`SourceEntity` (участники в `RawEvent.payload` Json, `Participant` БЕЗ tenantId); SQL-маршрут К1; эпизод-вектор для документов/чатов; мосты К3/К4 к чату; HNSW на `Theme.embedding`; партиционирование по tenantId (все HNSW глобальные).
- ⚠️ **Баг под мультитенант:** `period-resolver.ts:18-25` — жёсткий МСК +180 мин для ЛЮБОЙ tz (фикс в Ф5).
- ⚠️ **Контракт схемы:** `Participant:1468` и `AiResult:1581` БЕЗ `tenantId` (изоляция транзитивна через Meeting); `Meeting↔RawEvent` — не FK, а `RawEvent.sourceExternalId = meetingId` + `sourceType='meeting'`; документы → `Source type='external'`, `sourceTitle` НЕ передаётся (`document.adapter.ts:201-221`).

## Принятые решения владельца (2026-06-27, не пересматривать)

| # | Решение | Обоснование |
|---|---|---|
| Р1 | Объём = максимум, всё ядро (Ф1–Ф9) в одном ТЗ | Проектируем под 100–200k тенантов, не минимум-фазами |
| Р2 | К4-карта = lazy-map поверх `Theme.summary`, НЕ полная иерархия | LazyGraphRAG: качество выше при ~0.1% стоимости, без устаревания при ежедневном ingest (анализ §7, §8.3) |
| Р3 | 12 `ThemeBranch` фиксированы; рост на уровне `Theme`; К4 вязать на `Theme.embedding`-близость, не на enum | enum зашит в фильтрах/UI/индексе; снятие ломает; стабильная верхушка + растущие листья = правильная иерархия (§8.4) |
| Р4 | Документы — AI-title+summary+эпизод-узел + передать `sourceTitle` | Сейчас документ = имя файла, искать нечем (§8.2) |
| Р5 | Роутер детерминированный (правила+tiny-classifier), НЕ LLM-на-запрос; both-ways = confidence-gated, не симметричный | LLM-на-запрос: латентность ×100k + недетерминизм; симметричный both-ways = шум/падение precision (red-team §7) |
| Р6 | Участие = ребро на уровне ИСТОЧНИКА (`SourceParticipant`), НЕ линк на каждый `IdeaBlock` | Линк-на-блок: взрыв `IdeaBlockEntity` ×N, шум графа +12 п.п. (red-team, arXiv 2510.26512) |
| Р7 | Битрикс-чат: код-способность сразу, материализация при живом потоке | Внешний блокер потока, не отсрочка по цене |
| Р8 | Ф1 — полное физическое партиционирование IdeaBlock/Entity по tenantId СЕЙЧАС (составной PK + FK-рефактор), не «partition-ready на потом» | Прод почти пуст → дёшево; на масштабе конверсия = простой/миграция = ровно «переписывание», которое исключаем (решение 2026-06-27) |

## Доказательство выбора
Полная состязательная матрица (3 варианта глубины × критерии масштаба) и два независимых прохода + scale-red-team — в анализе §6–§7. Вывод: многомаршрутный retrieval + слой источника + партиционирование по тенанту — единственный долговечный скелет (аддитивен при росте, контракт retrieval не меняется). Отклонённое (LLM-роутер-на-запрос, полная Leiden-иерархия, симметричный both-ways, линк-присутствия-на-блок) отклонено по корректности/масштабу, не по цене.

## Граничные контракты с другими ТЗ (НЕ реализовывать чужое)
- **`knowledge-graph-ingestion-rebuild.md` (Ф1–9 = done, нижний слой):** дал retrievable «суть встречи» (`maybePersistMeetingSummary`), `EntityAlias`, structural-рёбра (`createStructuralEntityEdges:1742`), `Theme.summary`. **Не переопределять** bi-temporal-поля (`validFrom/validUntil/recordedAt`), provenance (`primarySource`), отчёт→граф. Наш ТЗ строит ПОВЕРХ.
- **`iterative-rag-method-parked.md`:** staged-loop заморожен — не воскрешать.
- **`edinyy-pomoshnik-arhitektura.md`:** UI-слияние «Мастера» + петля уточнения — наш роутер вызывается из того же single-pass chat-v2, ядро retrieval — наша зона.

---

## Контракт-first: целевые модели (дословные Prisma-сниппеты)

Стиль — как у соседних моделей (`IdeaBlock:3309`, `Theme:4270`): `///`-контракт-комментарии разрешены и канонны в schema.prisma; vector — `Unsupported("vector(1536)")?`, HNSW/GIN — ТОЛЬКО в `postgres-init.sql` (Prisma 7 их не умеет). Все новые модели несут `tenantId` явно (`Participant` его НЕ имеет — на него опираться нельзя).

```prisma
/// Эпизод-источник как первоклассный объект поиска (встреча / документ / чат-тред).
/// Один на RawEvent. Несёт human-резюме + собственный вектор для семантического
/// поиска ПО ИСТОЧНИКУ (класс К2/К4), отдельно от поблочного IdeaBlock.embedding.
model SourceEpisode {
  id                   String                       @id @default(cuid())
  tenantId             String
  rawEventId           String                       @unique
  /// 'meeting' | 'document' | 'chat'.
  kind                 String                       @db.VarChar(16)
  title                String
  occurredAt           DateTime
  summary              String?                      @db.Text
  embedding            Unsupported("vector(1536)")?
  /// Версия embedding-модели для безопасной смены без слепого бэкфилла.
  embeddingModelVersion String?                     @db.VarChar(40)
  branch               ThemeBranch?
  createdAt            DateTime                     @default(now())
  updatedAt            DateTime                     @updatedAt

  org      Org      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  rawEvent RawEvent @relation(fields: [rawEventId], references: [id], onDelete: Cascade)

  @@index([tenantId, occurredAt])
  @@index([tenantId, kind, occurredAt])
}

/// Ребро «человек присутствовал в источнике» на УРОВНЕ ИСТОЧНИКА (не блока).
/// Детерминированный фундамент К1 «все встречи/чаты с человеком X».
model SourceParticipant {
  rawEventId    String
  personId      String
  tenantId      String
  /// 'host' | 'guest' | 'author' | 'member' — роль в источнике.
  role          String   @db.VarChar(16)
  /// Доля реплик (0..1), null для не-встреч. Для ранжирования, не фильтра.
  speakingShare Decimal? @db.Decimal(4, 3)
  createdAt     DateTime @default(now())

  org      Org      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  rawEvent RawEvent @relation(fields: [rawEventId], references: [id], onDelete: Cascade)
  person   Person   @relation(fields: [personId], references: [id], onDelete: Cascade)

  @@id([rawEventId, personId])
  @@index([tenantId, personId, createdAt])
}

/// Ребро «компания/сущность упомянута в источнике» — агрегат на уровне источника
/// (НЕ дубль IdeaBlockEntity, который mention на уровне блока). Для К1/К4.
model SourceEntity {
  rawEventId    String
  entityId      String
  tenantId      String
  mentionsCount Int      @default(0)
  createdAt     DateTime @default(now())

  org      Org      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  rawEvent RawEvent @relation(fields: [rawEventId], references: [id], onDelete: Cascade)
  entity   Entity   @relation(fields: [entityId], references: [id], onDelete: Cascade)

  @@id([rawEventId, entityId])
  @@index([tenantId, entityId, createdAt])
}
```
Обратные связи добавить в `RawEvent` (`sourceEpisode SourceEpisode?`, `participants SourceParticipant[]`, `entities SourceEntity[]`), `Org`, `Person`, `Entity`.

**`TemporalSummary` (Ф5) — опционально, только если нужна иерархия выше weekly.** Дефолт — переиспользуем `WeeklyOperationsDigest`/`ValueRecapSnapshot`. Вводить модель ТОЛЬКО при доказанной нужде в квартальных/произвольных окнах; иначе `[ASSUMPTION: не создаём, мост К3 читает существующие digest/recap]`.

---

## Фазы (dependency-ordered, `[ ]`)

**Граф зависимостей:** Ф1 (партиционирование) — независима, делать первой пока прод пуст. Ф2 (модели источника) → Ф4 (SQL-К1) и Ф7 (эпизод-вектор) и Ф8 (документы). Ф3 (роутер) → Ф4/Ф5/Ф6. Ф7 зависит от Ф2. **Ф10 (сторона помощника: синтез по классу) зависит от Ф3+Ф4+Ф5+Ф6** — без новых форм результата нечего синтезировать. Ф9 — доводка.
Строгий порядок: **Ф1 → Ф2 → Ф3 → {Ф4, Ф5, Ф6, Ф7} → Ф8 → Ф10 → Ф9**. Внутри `{}` — параллелятся после Ф2+Ф3.

> ⚠️ Номера строк — на момент написания (2026-06-27); перед правкой каждой фазы перечитать файл и найти якорь по уникальному символу/тексту.

---

### Ф1. Партиционирование векторных индексов по `tenantId` + HNSW на `Theme.embedding`
**Цель:** убрать главный scale-killer (глобальный HNSW + `WHERE tenantId`) до наполнения прода.
**Точки:** `postgres-init.sql:63-92` (IdeaBlock/Entity HNSW), `schema.prisma:3309` (IdeaBlock), `:3496` (Entity), `:4270` (Theme).
**Что входит:**
1. Декларативное HASH-партиционирование `IdeaBlock` и `Entity` по `tenantId` (рекомендация — 64 партиции). Postgres требует партиционный ключ во ВСЕХ unique-ограничениях → PK становится составным `@@id([id, tenantId])`, входящие FK (`IdeaBlockEntity.blockId`, `IdeaBlockEvidence.blockId`, `ThemeIdeaBlock.blockId`, `IdeaBlockLink.from/toBlockId`, `IdeaBlockAccess`, `Decision.sourceIdeaBlockId` и др.) переводятся на `(blockId, tenantId)`. Реализация: создать партиционированные таблицы + перенос + swap в файл-миграции + `postgres-init.sql`.
2. Per-partition HNSW (создаётся на родителе, распространяется на партиции).
3. **HNSW на `Theme.embedding`** (сейчас нет — только b-tree) — нужен для К4 (Ф6).
4. HNSW-параметры в `postgres-init.sql`: `m=16, ef_construction=128` (дефолт 64 мал — AWS pgvector prod); `ef_search` — крутилка `AdminSetting` `knowledge.hnsw_ef_search` (дефолт 100), не хардкод (CLAUDE.md правило 9).
**Что НЕ входит:** изменение бизнес-логики retrieval (только физика индексов/схемы); партиционирование не-knowledge таблиц.
**Acceptance:**
- `bun run prisma:migrate -- --name partition-vectors-by-tenant` создаёт файл-миграцию; `bun run typecheck && bun run build` зелёные.
- `psql … -c "\d+ \"IdeaBlock\""` показывает `Partition key: HASH (\"tenantId\")` и ≥1 партицию.
- grep `postgres-init.sql` на `Theme.*hnsw` → индекс существует; `m = 16` и `ef_construction = 128` присутствуют в DDL IdeaBlock.
- Существующие тесты retrieval (`chat-v2-retrieval-structural.spec.ts`) зелёные после миграции (FK-рефактор не сломал связи).
- Идемпотентность: повторный прогон миграции/`postgres-init.sql` — no-op (`CREATE INDEX IF NOT EXISTS`, партиции — `IF NOT EXISTS`).
**Закрывает:** R10, R11.

### Ф2. Слой источника — модели `SourceEpisode`/`SourceParticipant`/`SourceEntity` + backfill
**Цель:** материализовать источник как первоклассный объект с нормализованными участниками/сущностями.
**Точки:** `schema.prisma:3256` (RawEvent — обратные связи), `block-ingest.worker.ts:295` (цикл persist), `:977` (summary-узел), `:1117` (mention-линковка), `:334` (`createStructuralEntityEdges`); backfill — новый `backend/scripts/backfill-source-layer.ts`.
**Что входит:**
1. Три модели (сниппеты выше) + миграция + DDL HNSW для `SourceEpisode.embedding` в `postgres-init.sql` (partial, партиционированный по tenantId как Ф1).
2. Заполнение при ingest: после persist-цикла блоков в `block-ingest.worker` — upsert `SourceParticipant` (из `tryGetParticipantNames`/`Participant.personId` для встреч, из payload-автора для чатов) и `SourceEntity` (агрегат `IdeaBlockEntity` источника, `mentionsCount`). Идемпотентно (upsert по составному PK).
3. `SourceEpisode` upsert: `title` = `RawEvent.sourceTitle` (или AI-title из Ф8 для документов), `summary` = из `maybePersistMeetingSummary`-текста, `embedding` через `embedBlocks`-аналог по summary, `embeddingModelVersion` = текущая модель.
4. `backfill-source-layer.ts` (idempotent, `createPrismaClient()` из `scripts/_lib/prisma.ts`, импорт из `../src`) — для существующих RawEvent создаёт эпизоды/рёбра. Регистрация в `apply-prod-deploy.ts` `STEPS` (phase backfill, `skipBootstrap`).
**Что НЕ входит:** маршрутизация (Ф3/Ф4); генерация AI-summary документов (Ф8); материализация Битрикс-данных (только контракт `kind='chat'`).
**Acceptance:**
- Модели в schema; `bunx prisma validate` ок; `bun run prisma:generate` ок.
- Unit: после обработки тестовой встречи с 3 участниками — ровно 3 строки `SourceParticipant` с `tenantId`, `role`; 0 дублей при повторном прогоне воркера.
- `SourceEntity.mentionsCount` ≥ 1 для упомянутой компании.
- `backfill-source-layer.ts` второй прогон = no-op (0 INSERT, лог `already-present`).
- grep `apply-prod-deploy.ts` → `backfill-source-layer` в `STEPS`.
**Закрывает:** R1 (фундамент), R6.

### Ф3. Роутер 5 классов запроса + confidence-gated both-ways
**Цель:** определять класс вопроса и выбирать приоритетный маршрут, никогда не отдавая пусто.
**Точки:** `query-plan-extractor.service.ts:35` (`StructuralRetrievalFilters`), `:256` (`buildPlanFromRaw`), `:360` (`resolveStructuralFilters`); `query-classifier.service.ts:62-99,120` (regex+classify); `dialog.service.ts:65,143`; `chat-v2.service.ts:640` (`ask`), `:942` (`runRetrieval`), `:988` (RRF).
**Что входит:**
1. Ввести `QueryClass = 'list' | 'topic' | 'temporal' | 'overview' | 'fact'` (К1–К5) как выход `understand` (расширить JSON-схему плана), НЕ заменяя `DialogIntent`. Определение — детерминированное: regex-правила (есть имя/группа + глагол-перечисление → list; period+итог → temporal; широкий обзорный → overview) поверх существующих `EXPLORATORY/ANALYTICAL/FACTUAL`-эвристик `:62-99`; LLM-классификатор — только тай-брейк ниже порога.
2. Добавить ось `personIds: string[]` в `StructuralRetrievalFilters:35` (отдельно от `entityIds`) + резолв в `resolveStructuralFilters:360` через `EntityAlias`/`Person` (fuzzy, не точное равенство).
3. **both-ways в `runRetrieval`**: при `confidence < QUERY_PLAN_MIN_CONFIDENCE` (0.6) ИЛИ К1/К3/К4 — запускать структурный и семантический маршруты **параллельно** (`Promise.allSettled`) и сливать `fuseRankedLists` (механизм есть `:988`). Уверенный К2/К5 → один путь. Инвариант: пустой структурный → семантический fallback подмешан всегда.
4. **Промпт формирования вопроса** — общий `query-understand.prompt` (используется и `dialog-understand`, и `dialog-multi-query`-taskType, admin-editable registry + code-fallback по `z-ai-agent-rules`): научить выделять `QueryClass` (5 классов) + ось `personIds` (человек/группа) **в том же вызове**, что уже отдаёт до 3 переформулировок. Один «understand» → три выхода: класс + структурные фильтры + переформулировки. Промпт-кэш: стабильный SYSTEM, переменные в конце user.
5. **Переформулировщик (`MultiQueryExpansionService`) — передняя дверь для ВСЕХ классов, не только семантики.** Он делает ДВА дела: (а) разрешает контекст из истории диалога — «найди по нему встречи» + история → самодостаточный «встречи с Александром из Молочные реки»; (б) даёт до 3 вариантов формулировки. Дело (а) нужно ВСЕМ классам (анафора/контекст), поэтому шаг понимания+переформулировки выполняется ПЕРВЫМ, до выбора финального действия, и читает `history`/`summary` (как сейчас, `runRetrieval:961` + `MultiQueryInput.history`). Различается лишь, ЧТО делается с вариантами после роутера: **К2/К5** — варианты идут параллельными семантическими `fetchCandidates`+RRF (как сегодня, `:961-982`); **К1** — самодостаточный вопрос + варианты + упомянутые сущности подаются в нечёткий резолвинг сущности (Ф4), НЕ как 3 параллельных векторных поиска по блокам; **К3/К4** — самодостаточный вопрос → период/тема. `multiQueryExpansionEnabled` остаётся крутилкой (выключение = только оригинальный вопрос, fail-safe).
**Что НЕ входит:** сами SQL-маршруты К1/К3/К4 (Ф4/Ф5/Ф6 — Ф3 даёт развилку и точки вызова, заглушки маршрутов возвращают пусто до своих фаз); синтез ответа по классу (Ф10); воскрешение staged-loop.
**Acceptance:**
- Unit (table-driven): «какие встречи с Ивановым» → `class='list'`; «итоги за месяц» → `temporal`; «что у нас по продажам» → `overview`; «что решили по бюджету» → `fact`; «обсуждали реструктуризацию» → `topic`.
- Негативный: запрос с несуществующим именем + `confidence<0.6` → НЕ пустой результат (семантический fallback сработал) — проверяется на тесте, что возвращён ≥1 кандидат при наличии релевантных блоков.
- `StructuralRetrievalFilters` содержит `personIds`; grep по типу.
- Unit: `MultiQueryExpansionService.expand` вызывается для ВСЕХ классов (история разрешается всегда) — спай >0 и для `class='list'`. Различие: для `class='list'/'temporal'/'overview'` НЕ запускается параллельный семантический фан-аут по блокам (per-query `fetchCandidates` поверх IdeaBlock — 0 раз); для `class='topic'/'fact'` — запускается.
- Unit (анафора): вопрос «найди по нему встречи» + история с «Александр из Молочные реки» → переформулировка даёт самодостаточный вопрос с «Александр» и «Молочные реки» (грепаемо в resolved-query).
- Регрессия: `chat-v2-retrieval-structural.spec.ts` зелёный; multi-query+RRF на К2/К5 работает как раньше.
**Закрывает:** R2, R5, R9, R13.

### Ф4. Маршрут К1 — «список/агрегат по человеку/группе»: резолвинг (нечёткий) → обход (точный) → страховка
**Цель:** список источников по человеку/компании с ПОЛНОТОЙ, устойчивый к опечаткам/транскрибации. Детерминированность — в ОБХОДЕ (по разрешённым id), а НЕ в сравнении имени. Точное равенство имени запрещено.
**Точки:** `chat-v2-retrieval.service.ts:240` (новая ветка), `chat-v2.service.ts:942` (вызов при `class='list'`); резолвинг — переиспользовать `EntityResolutionService` (`resolveSubjectPersonId` и пр.), `EntityAlias:4241`, `Entity.embedding:3507`; триграммный GIN-индекс — `postgres-init.sql`.
**Что входит:**
1. **Стадия резолвинга (нечёткая, НЕ равенство имени).** Имя/компанию из самодостаточного вопроса + вариантов резолвить в Person/Entity каскадом: нормализация → `EntityAlias` (кэш «Настя→personId») → триграммное сходство (`pg_trgm` на `Entity.canonicalName`/`Person.name`, новый GIN-индекс в `postgres-init.sql`) → близость `Entity.embedding`. Возвращает кандидатов с уверенностью. Контекст-сущность («Молочные реки») сужает выбор человека. Учитывать merged-сущности (`Entity.mergedIntoId`) — резолв в канон.
2. **Обход (точный, по разрешённым id).** `runStructuralAggregate({personIds, entityIds})` — SQL по `SourceParticipant`/`SourceEntity` → `SourceEpisode` (`WHERE tenantId=? AND personId IN (...) ORDER BY occurredAt DESC`), список эпизодов (id/title/occurredAt/kind) + опц. счётчик. «Что решали в группе Z» — фильтр по `SourceEntity`/`kind='chat'`.
3. **Семантическая страховка (ВСЕГДА для К1).** Параллельно — семантическая нога; слияние RRF. Резолвинг промахнулся/пуст → ответ не пустой (не хуже сегодняшнего).
4. **Уточнение при настоящей неоднозначности.** ≥2 разных кандидата высокой уверенности и контекст не сузил → помощник переспрашивает свободным текстом (петля `edinyy-pomoshnik`, без inline-кнопок). Один уверенный / контекст сузил → не спрашивает.
**Что НЕ входит:** точное равенство имени (🚫); семантика внутри эпизодов (К2-подмешивание).
**Acceptance:**
- Резолвинг устойчив: «Алексан» (опечатка) и «Саша» (алиас) → тот же Person P (unit, фикстуры alias/trigram/embedding). grep: в К1-резолвере нет `"name" =` / точного равенства.
- Полнота обхода: тенант с 3 встречами Person P → ровно 3 эпизода по дате; merged-сущность P2→P → встречи обоих.
- Контекст сужает: «Александр из Молочные реки» при 2 Александрах → выбран связанный с компанией, без переспроса.
- Неоднозначность: ≥2 равноуверенных кандидата → возвращается уточняющий вопрос (текст), не список.
- Страховка: резолвинг пуст → семантическая нога дала ≥1 кандидата (не пусто).
- tenant-изоляция: эпизод чужого тенанта не попадает (`tenantId` в WHERE).
**Закрывает:** R1, R14.

### Ф5. Мост К3 — temporal rollups в чат + фикс tz-бага
**Цель:** «итоги недели/месяца, почему хорошо/плохо» отвечать готовой свёрткой.
**Точки:** `chat-v2.service.ts:1082` (рядом с `runTableBranch` — новая ветка контекста), `value-recap.service.ts:46` (`build`/`getSnapshot`), `weekly-digest.service.ts:74` (`getOrGenerate`), `period-resolver.ts:18-25` (tz-баг).
**Что входит:**
1. При `class='temporal'` + резолвнутом периоде — ветка в `ask`, читающая `WeeklyOperationsDigest`/`ValueRecapSnapshot` по периоду тенанта и подающая markdown-свёртку в синтез (через `allSettled`, как ещё один источник контекста).
2. **Фикс `period-resolver.ts:18-25`**: брать реальный IANA-tz организации (`prisma.org.timezone`, уже читается в `dialog.service.ts:139`) вместо жёсткого +180, конвертировать окна через него.
**Что НЕ входит:** генерация свёрток (они уже считаются operations-cron'ом); новая модель `TemporalSummary` (если не доказана нужда — `[ASSUMPTION: переиспользуем digest/recap]`).
**Acceptance:**
- e2e: «итоги за прошлый месяц» при наличии `ValueRecapSnapshot` за период → ответ содержит данные свёртки (грепаемый маркер из `payloadJson`), а не top-k блоков.
- Unit `period-resolver`: для tz `Asia/Yekaterinburg` (UTC+5) границы `last_month` сдвинуты на +300 мин, не +180.
- Нет свёртки за период → both-ways fallback на семантику (не пусто).
**Закрывает:** R3, R8.

### Ф6. Мост К4 — lazy-map поверх `Theme.summary`
**Цель:** обзорный вопрос отвечать картой разделов, строя её на лету.
**Точки:** `chat-v2.service.ts:ask` (ветка `class='overview'`), `chat-v2-retrieval.service.ts:632` (`poolByTheme`), `Theme.embedding` HNSW (создан в Ф1).
**Что входит:** при `class='overview'` — top-N тем по `Theme.embedding <=> qvec` (lazy, query-time; фильтр опц. по `branch`), подать в синтез `Theme.summary` выбранных тем (map-reduce на лету), затем — погружение в блоки выбранных тем через `poolByTheme`. БЕЗ предрасчитанной иерархии. Вязать на embedding-близость, не на `ThemeBranch`-enum (Р3).
**Что НЕ входит:** полная community-иерархия (Р2 — вне scope); изменение `theme-summarize`-cron (он уже строит `Theme.summary`).
**Acceptance:**
- e2e: «что у нас по продажам» → ответ опирается на `Theme.summary` ≥1 релевантной темы (грепаемый маркер), не на 30 разрозненных блоков.
- top-N тем выбирается по cosine к `Theme.embedding` (unit с фикстурой эмбеддингов).
- Нет HNSW на Theme → тест падает (зависимость от Ф1 явная).
**Закрывает:** R4.

### Ф7. Contextual-header v2 — обогащение + backfill ре-эмбеддинга
**Цель:** в эмбеддинг блока встроить компании/полный состав/заголовок источника → выше recall класса К2.
**Точки:** `chunk-context.service.ts:31` (`buildContextHeader`), `:63` (`buildMetaLine`), `embedding.service.ts:14`, `block-ingest.worker.ts:1084` (запись вектора); backfill — `backend/scripts/backfill-context-header-reembed.ts`.
**Что входит:**
1. Обогатить `buildMetaLine`: добавить упомянутые компании (`SourceEntity`), полный состав участников (`SourceParticipant`), `RawEvent.sourceTitle`. Формат — стабильный (prompt-cache: статичная часть, переменные в конце).
2. `backfill-context-header-reembed.ts` — пере-эмбеддинг существующих `IdeaBlock` с новым header (idempotent: по флагу версии header; `createPrismaClient()`, запись `UPDATE … SET embedding=$1::vector(1536)` как `block-ingest.worker.ts:1084-1088`), затем `REINDEX` HNSW-партиций. Регистрация в `apply-prod-deploy.ts`.
**Что НЕ входит:** смена embedding-модели; BM25-часть (уже есть).
**Acceptance:**
- Unit `buildMetaLine`: вывод содержит компанию и ≥2 участников для фикстуры.
- `backfill-context-header-reembed.ts` второй прогон = no-op (версия header совпала).
- После backfill — REINDEX выполнен (лог), существующие retrieval-тесты зелёные.
- **Совместимость с prompt caching:** header — стабильный префикс, динамика (имена/даты) в конце. Раздел обязателен — соблюдён.
**Закрывает:** R7.

### Ф8. Документы как первоклассный объект
**Цель:** документ получает AI-заголовок, краткое описание и эпизод-узел.
**Точки:** `documents.service.ts:162` (`createOne`), `document.adapter.ts:144` (`process`), `:201-221` (`ingest.ingest` — добавить `sourceTitle`), `block-ingest.worker.ts:983` (снять гейт summary-узла).
**Что входит:**
1. Генерация AI-title + summary документа из `parsedText` (новый промпт через `llm-router` `taskType` с code-fallback и admin-registry — см. `z-ai-agent-rules`; prompt-cache: стабильный SYSTEM).
2. Передать `sourceTitle` в `ingest.ingest` для документов (сейчас не передаётся).
3. Снять гейт `block-ingest.worker.ts:983` — `maybePersistMeetingSummary`/эпизод-узел работает и для `kind='document'`/`'chat'`, источник summary-текста обобщён.
**Что НЕ входит:** изменение парсера документов; материализация Битрикс-чатов (только `kind` готов).
**Acceptance:**
- Загрузка PDF без осмысленного имени → `SourceEpisode.title` = AI-заголовок (не имя файла), `summary` непустой.
- Документ ищется по теме (e2e: «документы про логистику» находит загруженный логистический PDF).
- Промпт зарегистрирован в registry с code-fallback (grep по ключу).
**Закрывает:** R1 (документы), R4.

### Ф9. Rerank-доводка
**Цель:** убедиться, что финальный top после RRF переранжируется на качество.
**Точки:** `chat-v2.service.ts:1005` (`conditionalRerank`, LLM-as-reranker, порог `rag.rerank_min_pool`).
**Что входит:** проверить/настроить порог и применение `conditionalRerank` к финальным top-20..50 после both-ways-слияния; вынести порог в `AdminSetting` (если ещё хардкод). Без новой инфры.
**Что НЕ входит:** cross-encoder-сервис (вне scope).
**Acceptance:** `conditionalRerank` применяется к объединённому результату both-ways; порог — крутилка `AdminSetting` (grep registry); регрессия retrieval-тестов зелёная.
**Закрывает:** R7.

### Ф10. Сторона помощника — синтез ответа по классу + системные промпты (consumer-side)
**Цель:** помощник, который ищет и отвечает, должен ЗНАТЬ о новой структуре и подавать результат в форме, соответствующей классу. Без этого новые маршруты вернут данные, а ответ останется «абзацем из блоков».
**Зависит от:** Ф3 (класс известен) + Ф4/Ф5/Ф6 (маршруты дают новые формы результата).
**Точки:** `chat-v2.service.ts:723` (`loadContextBlocks` → ветвление сборки контекста по классу), `:880` (LLM-call taskType `chat-v2` — системный промпт), `resolveAnswer`; промпт-registry `chat-v2` (admin-editable + code-fallback, `z-ai-agent-rules`).
**Что входит:**
1. **Ветвление синтеза по `QueryClass`** в сборке контекста перед LLM:
   - К1 (list) — контекст = список эпизодов (`SourceEpisode`: title+occurredAt+kind), ответ-перечисление со ссылками на встречи, НЕ синтез абзаца из блоков.
   - К3 (temporal) — контекст = markdown свёртки (`ValueRecapSnapshot`/digest), ответ подводит итог периода.
   - К4 (overview) — контекст = `Theme.summary` выбранных тем (карта), ответ-обзор с разбивкой по разделам.
   - К2/К5 — текущий блочный синтез (без изменений).
2. **Обновить системный промпт `chat-v2`** (registry + code-fallback): описать новую структуру памяти (источники-объекты, участники, карта тем, итоги периодов) и режимы ответа по классу — чтобы LLM формировал ответ под форму результата. Промпт-кэш: стабильный SYSTEM, переменные данные в конце.
3. **Контракт ответа наружу (для «Мастера»/UI):** результат `ask` несёт `answerKind` (list|recap|overview|prose) + структурированную часть (для К1 — массив эпизодов с id для кликабельных ссылок), чтобы UI помощника отрисовал список/карту, а не только текст. Ответы — только русский, только текст (голос лишь на ввод — `edinyy-pomoshnik`).
**Что НЕ входит:** изменение UI-компонентов «Мастера» сверх контракта `answerKind` (если требуется новый рендер — vNext-ТЗ фронта, ссылка в `relates_to`); inline-кнопки в ответах (запрещены).
**Acceptance:**
- e2e «список встреч с Ивановым» → `answerKind='list'`, ответ-перечисление с ≥1 кликабельной ссылкой на встречу (id эпизода в payload), НЕ абзац.
- e2e «итоги за месяц» → `answerKind='recap'`, текст из свёртки.
- e2e «что у нас по продажам» → `answerKind='overview'`, разбивка по темам из `Theme.summary`.
- Системный промпт `chat-v2` в registry содержит описание классов/структуры (grep по ключу); code-fallback присутствует.
- Регрессия: К2/К5 → `answerKind='prose'`, текущая выдача не изменилась.
**Закрывает:** R12.

---

## Требования (трассировка)
- **R1** — Когда вопрос класса «список по сущности», система shall вернуть детерминированный полный список источников (SQL по `SourceParticipant`/`SourceEntity`), не векторный top-k.
- **R2** — Система shall классифицировать запрос в один из 5 классов детерминированно (правила+tiny-classifier), без LLM-вызова на горячем пути для уверенных случаев.
- **R3** — Когда вопрос класса «временной итог» и есть свёртка за период, система shall ответить из `WeeklyOperationsDigest`/`ValueRecapSnapshot`.
- **R4** — Когда вопрос обзорный, система shall построить карту из `Theme.summary` (lazy, по `Theme.embedding`-близости), не из плоского top-k.
- **R5** — Если уверенность роутера < 0.6 или класс ∈ {list,temporal,overview}, then система shall выполнить структурный И семантический маршруты параллельно и слить RRF (никогда не пусто).
- **R6** — Система shall хранить участие человека в источнике как ребро `SourceParticipant` уровня источника, НЕ как линк на каждый `IdeaBlock`.
- **R7** — Эмбеддинг блока shall включать обогащённый contextual-header (компании, состав, заголовок источника).
- **R8** — `period-resolver` shall использовать реальный IANA-tz организации, не жёсткий МСК+180.
- **R9** — Изменения роутера shall НЕ регрессировать существующие К2/К5-запросы (recall-safe ветка сохранена).
- **R10** — Векторные индексы `IdeaBlock`/`Entity`/`SourceEpisode` shall быть партиционированы по `tenantId`.
- **R11** — `Theme.embedding` shall иметь HNSW-индекс.
- **R12** — Сторона помощника (формирование вопроса + синтез ответа) shall знать новую структуру: промпт `query-understand` выделяет `QueryClass`+`personIds`; синтез ветвится по классу (К1 список эпизодов, К3 свёртка, К4 карта тем, К2/К5 блочный); ответ несёт `answerKind` для UI; системный промпт `chat-v2` описывает новую структуру памяти.
- **R13** — Шаг понимания+переформулировки (history-aware, `MultiQueryExpansionService`) shall выполняться для ВСЕХ классов (разрешение анафоры/контекста из истории — «найди по нему встречи» → самодостаточный вопрос). Параллельный семантический фан-аут по блокам (3 варианта → per-query поиск → RRF) shall запускаться ТОЛЬКО для К2/К5 и both-ways-семантической-ноги; для К1 варианты питают резолвинг сущности, для К3/К4 — период/тему.
- **R14** — К1-резолвинг имени/компании shall быть нечётким (нормализация + `EntityAlias` + триграммы + `Entity.embedding`), НИКОГДА не равенством строки; контекст-сущность сужает выбор; ≥2 равноуверенных кандидата → уточняющий вопрос; резолвинг пуст → семантическая страховка (не пусто). Детерминизм — только в обходе по разрешённым id.

## Границы фичи
- ✅ **Always:** `tenantId` в каждом knowledge-запросе и новой модели; идемпотентность seed/patch/backfill; крутилки в `AdminSetting`; UI/ответы — только русский.
- ⚠️ **Ask first:** любое изменение bi-temporal/provenance-контракта `IdeaBlock` (чужой scope graph-ingest); смена embedding-модели; новый `signalType`.
- 🚫 **Never:** `db push` в коммит; `process.env.*` мимо `env.schema.ts`; `new PrismaClient()` в скриптах; нарративные комментарии в коде (кроме `///` Prisma-контрактов и функциональных директив); LLM-роутер на каждый запрос; симметричный both-ways; линк-присутствия на `IdeaBlock`.

## Pre-mortem / Риски (ревью-аспекты для strict-production-review-gate)
- **Ф1 — высший риск.** FK-рефактор на составной ключ `(blockId, tenantId)` затрагивает много таблиц; ошибка → битые связи графа. Ревью: проверить КАЖДЫЙ входящий FK на IdeaBlock/Entity; миграция на пустом проде; полный прогон retrieval-тестов после swap.
- **Ф3 — регресс precision.** Both-ways не должен подмешивать шум в уверенные К2/К5. Ревью: confidence-gate строгий; recall-safe ветка не тронута.
- **Ф7 — рассинхрон эмбеддингов.** Блоки до/после смены header несовместимы по распределению. Ревью: backfill полный + REINDEX; версия header как гейт идемпотентности.
- **Ф2/Ф8 — ложные сущности.** AI-summary документа может галлюцинировать участников/компании → ложные `SourceEntity`. Ревью: `SourceEntity` только из `IdeaBlockEntity` (извлечённых), НЕ из текста summary.
- **tenant-изоляция.** Каждый новый SQL-маршрут — `tenantId` в WHERE; негативный тест на утечку между тенантами.

## Idempotency / feature-flag / prod-deploy
- **Флаги (Ship-On):** роутер 5 классов и both-ways выкатываются ВКЛЮЧЁННЫМИ. Допустим один kill-switch `AdminSetting` `knowledge.router_v2_enabled` (дефолт ON, аварийное выключение → откат на текущий single-route) — строка в `docs/operations/feature-flags.md`. Никаких «дефолт OFF».
- **Крутилки в `AdminSetting`:** `knowledge.hnsw_ef_search` (100), `knowledge.router_confidence_threshold` (0.6, сейчас ENV-подобный код — перенести), `rag.rerank_min_pool` (если хардкод). Каждая — строка в `admin-setting-schema-registry.ts` + сид + UI.
- **prod-deploy-log (Шаги):** Ф1 → Шаг 4 (схема/опасная миграция) + Шаг 5 (HNSW/партиции в postgres-init); Ф4 → Шаг 5 (триграммный GIN `pg_trgm` на `Entity.canonicalName`/`Person.name`); Ф2 → Шаг 5 (HNSW `SourceEpisode.embedding`); Ф2/Ф7 backfill → Шаг 8 + регистрация в `apply-prod-deploy.ts STEPS`; Ф8 промпт → Шаг 7 (seed-промпта); новые крутилки → Шаг 1/7.
- **Миграции:** версионируемые (`prisma:migrate -- --name …`), НЕ `db push`. HNSW/партиции — `postgres-init.sql`.

## DoD
- `bun run typecheck` (вкл. `.spec`) · `bun run lint` · `bun run build` — зелёные (backend и frontend, если затронут).
- `bunx vitest run` затронутых spec зелёные; новые unit/интеграционные по Acceptance каждой фазы.
- second-brain обновлён по таблице производных заметок: `02_architecture/knowledge-core.md` (роутер+слой источника), `01_projects/api-layer.md` (если новый эндпоинт), `01_projects/workers-queues.md` (backfill), `data-model.md` (новые модели).
- Переписанные/новые LLM-промпты (`query-understand` — общий для understand+multi-query, `chat-v2`, промпт AI-summary документа из Ф8) сверены с чек-листом `docs/methodology/prompts/`; удачные — эталоном в `examples/`.
- `docs/operations/prod-deploy-log.md` обновлён (Шаги выше); `feature-flags.md` — строка kill-switch.
- Рефлексия в `second-brain/05_история/`.

## Итог
*(заполнит tz-orchestrator по завершении: реализовано целиком/частично, что осталось.)*
