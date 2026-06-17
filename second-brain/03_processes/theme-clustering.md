---
name: theme-clustering
title: Кластеризация тем в графе знаний
trigger_type: cron
status_overall: implemented
last_audited: 2026-05-29
owners_human:
  - инженер knowledge-core
  - продакт «памяти компании»
related_plans:
  - plans/archive/2026-05-10-knowledge-core-tz.md
related_projects:
  - 02_architecture/knowledge-core.md
  - 01_projects/workers-queues.md
  - 01_projects/ai-jobs.md
---

# Кластеризация тем в графе знаний

> **Как читать этот файл:** разделы 1–4 — для не-программиста. Раздел 5 — для разработчика. Номера шагов между разделами 3 и 5 синхронизированы.

## 1. О чём это (бытовой рассказ)

Когда в компании за неделю накопилось много мелких фактов («Иванов уходит из проекта Альфа», «Иванов передал клиента Ромашка Петрову», «Иванов забрал ноутбук»), по отдельности они тонут в общем потоке. Но если посмотреть на них вместе, видна общая нить — **увольнение Иванова**. Это и есть «тема».

Каждый час платформа сама делает такую группировку. Она берёт свежие факты (идейные блоки), у которых ещё нет привязанной темы, и по семантической близости (эмбеддинг — числовой «отпечаток смысла») находит **устойчивые кластеры** из трёх и более похожих блоков. Каждому такому кластеру AI даёт имя и краткое описание (например: «Увольнение Иванова», ветка `team`), а также проставляет «вес» (насколько важно).

В результате компания получает живую карту больших нарративов — где видно «миграция на PostgreSQL» как тему рядом с «уход Иванова» и «жалобы клиента Ромашка». Эти темы потом подсвечиваются в карточках клиентов/проектов (топ-3 связанных тем), в дашборде директора, в чате с AI.

В проде это работает каждый час; маленькие организации (меньше 100 свежих блоков без темы) скан пропускает — рано группировать. Темы — самообновляющиеся: ночной процесс «переоценки» сольёт похожие или заархивирует затухшие (см. [[reframing-cycle]]).

## 2. Что запускает (триггер)

- **Тип:** крон (расписание).
- **Кто или что инициирует:** планировщик NestJS каждый час в 15-ю минуту.
- **Технический источник:** `@Cron('15 * * * *')` в `ThemeClustererCron.sweep` (см. `backend/src/modules/knowledge-core/workers/theme-clusterer.cron.ts:54`).

## 3. Шаги процесса (общий список)

1. **Раз в час планировщик будит «кластеризатор тем»** и перебирает все активные организации.
2. **Для каждой организации проверяется минимальный порог** — есть ли хотя бы 100 «свободных» канонических блоков (не привязанных ни к какой теме, с эмбеддингом). Если меньше — пропуск.
3. **Платформа загружает до 1000 свежих блоков организации** и попарно сравнивает их «отпечатки смысла».
4. **Похожие блоки склеиваются в кластеры** (близость cosine ≥ 0.78); кластеры размером меньше 3 отбрасываются как случайный шум.
5. **Для каждого устойчивого кластера** дополнительно подгружается топ-10 сущностей (упоминания «Иванов», «PostgreSQL», «Ромашка» и т.д.), которые чаще всего встречаются внутри этого кластера.
6. **AI получает кластер + список сущностей** и одним LLM-вызовом возвращает имя темы, описание, «ветку» (страт/клиенты/продакт/команда/...), теги, вес и уверенность.
7. **Тема сохраняется в `Theme`** со своим эмбеддингом (для последующего поиска похожих тем), и привязывается ко всем блокам кластера через `ThemeIdeaBlock`, а сущности — через `ThemeEntity`.

## 4. Что получается на выходе

- **Графу знаний:** новые записи `Theme` (status='active') со связями `ThemeIdeaBlock` и `ThemeEntity`.
- **Карточкам клиентов/проектов:** видны топ-3 темы карточки (через `Card.cachedTopThemeIds`, обновляется в [[card-rollup-v2]]).
- **Где это видно:**
  - `GET /api/v1/knowledge/themes?branch=&status=&q=` — список тем организации;
  - `GET /api/v1/knowledge/themes/:id` — карточка темы с блоками и сущностями;
  - `POST /api/v1/knowledge/themes/:id/save-as-card` — сохранить тему как `Card(kind='topic', bornFromThemeId=...)`;
  - `GET /api/v1/cards/:id/themes` — топ-3 темы карточки.

## 5. Технический разрез (по шагам)

> Номера шагов синхронизированы с разделом 3.

| # | Шаг (бытовой) | Что делает технически | Где живёт код | Очередь / cron / эндпоинт | Записывает в БД | Статус |
|---|---|---|---|---|---|---|
| 1 | Крон будит кластеризатор | `@Cron('15 * * * *')` в `ThemeClustererCron.sweep` загружает все Org'и с хотя бы одним membership `owner/admin` и `deletedAt=null`; пер-Org обработка через try/catch | `backend/src/modules/knowledge-core/workers/theme-clusterer.cron.ts:54,68,90` | cron `15 * * * *` | — | ✅ |
| 2 | Гейт по объёму данных | Сначала `WorkerOrgGate.checkOrThrow(tenantId, 'theme-clusterer')` — если выключено в админке Org, skip. Затем raw SQL count canonical-блоков с embedding и без `ThemeIdeaBlock`; если меньше `THEME_CLUSTERING_MIN_BLOCKS=100` — возврат 0 без работы | `backend/src/modules/knowledge-core/workers/theme-clusterer.cron.ts:116,135` | — | — | ✅ |
| 3 | Загрузка блоков с эмбеддингами | `$queryRawUnsafe` тащит `id` + `embedding::text` (MAX 1000 на Org) для canonical-блоков с embedding и без ThemeIdeaBlock, `ORDER BY createdAt ASC`; `parseVector` парсит pgvector-строку `[0.1,-0.2,...]` в `number[]` | `backend/src/modules/knowledge-core/workers/theme-clusterer.cron.ts:156,360` | — | — | ✅ |
| 4 | Кластеризация (KNN-greedy union-find) | `ClusteringService.clusterByEmbedding(blocks, threshold, minSize)` строит граф связей где cosine ≥ `THEME_COSINE_THRESHOLD=0.78`, объединяет union-find, выкидывает кластеры размером < `THEME_CLUSTER_MIN_SIZE=3`. Сложность O(B²) на 1000 блоков ≈ 1.5s worst-case | `backend/src/modules/knowledge-core/workers/theme-clusterer.cron.ts:182`, `services/clustering.service.ts` | — | — | ✅ |
| 5 | Топ-сущности кластера | `IdeaBlockEntity.findMany({blockId IN cluster})` + counter Map по `entityId`; top-`TOP_ENTITIES_PER_CLUSTER=10` по числу упоминаний внутри кластера | `backend/src/modules/knowledge-core/workers/theme-clusterer.cron.ts:251,277` | — | — | ✅ |
| 6 | LLM-классификация темы | `ThemeClassificationService.classifyTheme({tenantId, blocks, entities})` — LLM `theme-classify` (JSON Schema strict) возвращает `{name, description, branch ∈ {strategy/clients/sales/marketing/product/operations/team/finance/technology/production/partnerships/legal}, tags, weight, confidence}` | `backend/src/modules/knowledge-core/workers/theme-clusterer.cron.ts:283`, `services/theme-classification.service.ts`, `prompts/theme-classify.prompt.ts` | LLM `theme-classify` | — | ✅ |
| 7 | Persist Theme + связи | `embedQuery('name + " " + description')` через `KnowledgeEmbeddingService`; `prisma.theme.create({status:'active', lastSignalAt:now})`; `$executeRawUnsafe UPDATE "Theme" SET embedding = $1::vector(1536)`; `themeIdeaBlock.createMany(skipDuplicates)` для каждого блока с weight=1.000; `themeEntity.createMany(skipDuplicates)` для top-10 сущностей с mentionsCount из counter Map | `backend/src/modules/knowledge-core/workers/theme-clusterer.cron.ts:296,299,313,331,341` | — | `Theme` (active, embedding), `ThemeIdeaBlock`, `ThemeEntity` | ✅ |

### 5.1 Структуры данных, через которые проходит процесс

```
IdeaBlock (status='canonical', embedding NOT NULL, NOT IN ThemeIdeaBlock)
  ↓ batch ≤ MAX_BLOCKS_PER_ORG=1000
ClusterableBlock { id, embedding: number[] }[]
  ↓ ClusteringService (KNN-greedy union-find)
Cluster { blockIds: string[] }[]  где size ≥ THEME_CLUSTER_MIN_SIZE
  ↓ для каждого кластера:
  + top-10 entities (IdeaBlockEntity counter)
  ↓ LLM 'theme-classify'
{ name, description, branch, tags, weight, confidence }
  ↓ persist
Theme { tenantId, name, description, branch, weight Decimal(4,3),
        confidence Decimal(4,3), status='active', lastSignalAt,
        embedding vector(1536), mergedIntoId? }
  + ThemeIdeaBlock { themeId, blockId, weight=1.000 } × N
  + ThemeEntity    { themeId, entityId, mentionsCount } × M (≤10)
```

### 5.2 LLM-вызовы внутри процесса

| Шаг | taskType | Primary | Secondary | Tertiary | Где промпт |
|---|---|---|---|---|---|
| 6 | `theme-classify` | OpenAI gpt-5.4-nano (через proxy) | DeepSeek V4-flash | Ollama qwen3.5:9b | `backend/src/modules/knowledge-core/prompts/theme-classify.prompt.ts` |

Маршрут задаётся `backend/scripts/seed-llm-task-routes-default.ts:215` и `seed-llm-task-routes-knowledge-core.ts:116`. **NB:** для `theme-classify` Primary — OpenAI `gpt-5.4-nano`, а не DeepSeek (в отличие от большинства knowledge-core задач). Эмбеддинги тем — `text-embedding-3-small` через `KnowledgeEmbeddingService.embedQuery`.

## 6. Точки отказа и наблюдаемость

**Prometheus метрики:**
- `core_specialist_pipeline_duration_seconds{type='theme'}` — длительность вычислений (если измеряется в classifier).
- В `runForAllOrgs` возвращается summary `{scannedOrgs, clusteredOrgs, createdThemes}` — попадает в лог `theme-clusterer: проход завершён`.

**BullMQ очереди:** очередь `core.theme-clusterer` существует в `CORE_QUEUE_NAMES`, но **в текущей реализации не используется** — кластеризация запускается прямо в кроне без enqueue (один процесс, без BullMQ).

**Логи** (pino): `ThemeClustererCron` — на старт/end прохода, на каждый Org с числом блоков/кластеров, на ошибку кластера (warn, не валит остальные).

**Известные грабли:**
- `parseVector` парсит pgvector `::text` вручную — любая кривизна → null, блок выпадает (см. `theme-clusterer.cron.ts:360`).
- Кластеризация O(B²) на 1000 блоков ≈ 1.5s — для очень больших Org заменить на pgvector side-query (TODO в комментарии).
- Если `ThemeClassificationService` вернул null (LLM-фейл) — кластер пропускается с warn-логом, тема не создаётся (`theme-clusterer.cron.ts:288`).

**Кнопки админки:** `runForAllOrgs()` помечен `public` — можно вынести в админ-эндпоинт для ручного запуска кластеризации.

## 7. Связанные процессы

- [[raw-event-to-graph]] — создаёт canonical блоки с embedding'ом, которые потребляет этот процесс.
- [[card-rollup-v2]] — берёт топ-3 темы для карточки клиента/проекта через `ThemeIdeaBlock`.
- [[reframing-cycle]] — ночной merge / archive / split тем поверх результатов этого процесса.
- [[specialist-3-6-ideas]] / [[specialist-gamma-1-skill-clone]] — потребляют темы как контекст в своих LLM-вызовах.

## 8. Расхождения «задумано vs реализовано»

**Заложено в ТЗ, реализовано:**
- ✅ Кластеризация Theme'ов через KNN-greedy union-find поверх эмбеддингов canonical-блоков (Фаза 4 knowledge-core).
- ✅ LLM `theme-classify` с JSON Schema strict, 12-значным enum `branch`.
- ✅ Embedding темы для последующего поиска похожих тем.

**Реализовано иначе, чем намекает ТЗ:**
- **Cron-expression `'15 * * * *'` зафиксирован в декораторе** (`theme-clusterer.cron.ts:54`), ENV `THEME_CLUSTERER_CRON` читается `TypedConfigService.knowledgeCore.themeClustererCron`, но фактически **не используется** в `@Cron(...)` — комментарий в коде `theme-clusterer.cron.ts:33` это явно говорит. Изменение интервала требует пересборки.
- **Очередь `core.theme-clusterer` существует в `CORE_QUEUE_NAMES`**, но фактически кластеризация работает inline в кроне — не через BullMQ. Это сознательный выбор: один проход целиком, без отказоустойчивости BullMQ (на сбой полагаемся на следующий запуск через час).

**Реализовано, но в ТЗ не описано:**
- **Лимит `MAX_BLOCKS_PER_ORG=1000` в коде** (`theme-clusterer.cron.ts:40`) — защита от O(B²) на сверхбольших Org.
- **`WorkerOrgGate`** позволяет owner'у Org выключить кластеризацию для своей Org (`theme-clusterer.cron.ts:124`).
- **`lastSignalAt=now()` при создании Theme** — для `ORDER BY weight DESC, lastSignalAt DESC` в публичном API.

**Гейты, которые задерживают доходимость до конечного результата:**
- `THEME_CLUSTERING_MIN_BLOCKS=100` — пока в Org меньше 100 свободных canonical блоков, темы не создаются (`theme-clusterer.cron.ts:151`).
- `THEME_CLUSTER_MIN_SIZE=3` — кластеры из 1-2 блоков не материализуются.
- `THEME_COSINE_THRESHOLD=0.78` — блоки с cosine < 0.78 не сцепляются в один кластер.

## 9. История изменений процесса

| Дата | Что изменилось | Коммит/рефлексия |
|---|---|---|
| 2026-05-29 | Карточка создана | этот документ |
| 2026-05-10 | Theme-clusterer + ThemeClassificationService запущены (Фаза 4) | plans/archive/2026-05-10-knowledge-core-tz.md |
