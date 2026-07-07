---
title: Themes — AI-кластеры + пользовательские темы + карта областей
status: actual
updated: 2026-07-03
---

# Themes (AI-кластеры IdeaBlock'ов + пользовательские темы)

Реализовано 2026-05-10 по [plans/archive/2026-05-10-knowledge-core-tz.md](../../plans/archive/2026-05-10-knowledge-core-tz.md) §Фаза 4. **Расширено 2026-07-03** пользовательскими темами и картой «Второй мозг» (см. §«Живое пространство темы»).

## Главная идея

Изначально Theme — **AI-обнаруженный кластер канонических `IdeaBlock`'ов** (`origin=auto`), склеенных по семантической близости эмбеддингов и названный LLM-классификатором. Цель — обзор «о чём говорят в Org» без ручного тегирования.

**С 2026-07-03 тему заводит и человек** (`origin=user`): пишет фразу → тема **сама наполняется** релевантными блоками ≥ порога, а человек лишь **убирает лишнее**. Историческая ветка «save-as-card» осталась (`POST /knowledge/themes/:id/save-as-card` → `Card(kind='topic', bornFromThemeId)`), но теперь есть прямой путь «завести свою тему» — см. §«Живое пространство темы».

## Живое пространство темы — пользовательские темы + авто-наполнение (2026-07-03)

**Источник:** ТЗ [`2026-07-02-living-topic-space`](../../plans/tz/2026-07-02-living-topic-space.md) (миграция `20260703000000_living_topic_space`). Модель — [[../02_architecture/data-model]] §«Живое пространство темы», модули — [[../02_architecture/module-map]] §«Живое пространство темы», эндпоинты — [[api-layer]] §Knowledge-core.

**Принцип (решение владельца).** Тему заводит **человек руками** — Кора темы НЕ создаёт и НЕ навязывает. Дальше тема **сама наполняется** контентом ≥ высокого порога (0.72) — **без вопросов и подтверждений** (постоянные «подтверди это» = спам). Человек **убирает лишнее**, убранное больше не подкладывается. Против свалки — высокий порог (сомнительное тихо НЕ кладётся) + дедуп + исключения.

**Что нового у `Theme`:** `origin(auto|user)`, `createdByUserId`, `visibility(personal|team)`. **Что нового у `ThemeIdeaBlock`:** `addedVia(clustered|autofill|manual)`, `score`, `reason` (провенанс «почему блок в теме»). **Новая таблица `ThemeExclusion`** («пользователь убрал, не подкладывать»).

**Кто заводит тему:**
- **Личную** (`visibility=personal`, видит только автор) — любой сотрудник.
- **Командную** (`visibility=team`, видит вся Org) — только **manager+** (owner/admin/manager/coo/super) через `RbacService.canCreateTeamTheme`; это ролевой порог доступа (Ship-On «решение владельца про доступ»). Иначе `403 forbidden_team_theme`.

**Как наполняется (без LLM на блок):** `theme.embedding` (из фразы человека) → cron `theme-autofill` (`@Cron('35 * * * *')`, `ThemeFillService.fillTheme`) → pgvector-поиск блоков cosine ≥ `theme.autofill.threshold` (0.72) в окне `scanWindowDays` (14) → дедуп near-дублей → исключение уже-привязанных и `ThemeExclusion` → `ThemeIdeaBlock(addedVia=autofill, score, reason)`. `reason` — детерминированный шаблон, не генерация. Крутилки `theme.autofill.*` — [[admin]] §«Крутилки авто-наполнения тем»; воркер — [[workers-queues]] §`theme-autofill`; механика pgvector-без-LLM — [[ai-jobs]] §«Авто-наполнение тем».

**Opt-out через удаление.** Убрал блок/сущность из темы (`DELETE /:id/pin/:kind/:objectId`) → запись в `ThemeExclusion` → авто-наполнение больше его не подкладывает. Ручное добавление — `POST /:id/pin` (`addedVia=manual`).

**Живой вид темы.** `GET /:id` отдаёт читаемую страницу: суть + лента блоков (с `addedVia`/`score`/`reason` для поповера «почему») + секции decisions/tasks/documents/regulations. Фронт — `themes/[id]/ThemeDetailClient.tsx` (см. [[frontend-pages]]).

**Мост «обязательство → задача».** На карточке решения/обязательства темы — «завести задачу»: `POST /:id/commitments/:blockId/to-task` переиспользует трекер (`IssuesService` + `ProjectsService.ensureInboxProjectId`), идемпотентно.

## Карта «Второй мозг» по 12 областям (2026-07-03)

**Источник:** ТЗ [`2026-07-02-second-brain-by-branches`](../../plans/tz/2026-07-02-second-brain-by-branches.md). **Read-only, без изменения схемы** — ветка регламента/процесса/документа/решения **деривится** из существующих связей (Р1), не хранится колонкой.

`BranchDerivationService`: `deriveBranchForEntityIds`/`deriveBranchForThemeIds` (сущность/тема → ветка через `Theme.branch`/`ThemeEntity`, visibility-aware, max weight), `computeBranchSignal` (пусто/all-growing→green, declining→red, иначе yellow), `aggregateBranchMap` (счётчики тем/регламентов/процессов/документов/решений per branch + `'unassigned'` для неотнесённого). Эндпоинты `GET /api/v1/knowledge/branches` (карта плиток) + `GET /:branch` (деталь области). Надстройка над темами — карта стала **главным видом «Памяти»** (`/memory`), реестры — вкладкой; экран области `/memory/[branch]` ведёт в существующие разделы.

Цель: дать обзор «о чём говорят в Org» без ручного тегирования и без
жёстких справочников.

## Модель `Theme`

```
Theme {
  id           cuid
  tenantId     Org
  name         String      // ≤100 символов, существительное / именная фраза
  description  Text        // ≤1000 символов
  weight       Decimal(4,3)  default 0.5    // важность темы (0..1)
  dynamic      enum growing|stable|declining default stable
  confidence   Decimal(4,3)  default 0.5    // уверенность LLM-классификатора
  status       enum active|archived|merged_into
  mergedIntoId Theme?
  branch       enum?       // одна из 12 веток компании (см. ниже) или null
  embedding    vector(1536)
  lastSignalAt DateTime?
  ...
}
```

### Связи
- `ThemeIdeaBlock` — M:M Theme ↔ IdeaBlock с `weight Decimal(4,3) default 1.000`.
- `ThemeEntity` — denormalized связь Theme ↔ Entity с `mentionsCount Int`.
- `Card.bornFromThemeId Theme?` — если Card создан из Theme через save-as-card.

### 12 веток компании (`ThemeBranch`)
`strategy / clients / sales / marketing / product / operations / team /
finance / technology / production / partnerships / legal`. Опциональна —
LLM возвращает `'none'` (маппится в `null`), если ветка не определилась.

## Pipeline создания тем

### Шаг 1 — `theme-clusterer.cron` (раз в час, литерал `15 * * * *`)
- Файл: `backend/src/modules/knowledge-core/workers/theme-clusterer.cron.ts`.
- Гейт: для Org с `count(canonical IdeaBlock без ThemeIdeaBlock) >= THEME_CLUSTERING_MIN_BLOCKS=100`.
- Загружает до 1000 свежих canonical-блоков без темы с эмбеддингами через
  raw SQL (`embedding::text` → парсинг массива).
- Передаёт в `ClusteringService.clusterByEmbedding(threshold=0.78, minSize=3)`:
  - **KNN-greedy** на union-find. Для каждой пары (i, j), i < j: если
    cosine > threshold — объединить кластеры. O(N²·D), для N≤1000 ≈1.5s
    на M2 — приемлемо.
  - Фильтр кластеров с size < minSize.
  - representative — block с максимальной суммой cosine ко всем остальным.
- Для каждого кластера:
  - Топ-10 entities среди блоков по числу упоминаний.
  - LLM-вызов `ThemeClassificationService.classifyTheme` (taskType
    `theme-classify`, JSON Schema strict): возвращает
    `{name, description, branch, tags, weight, confidence}`.
  - Embedding: `embedQuery(name + ' ' + description)` (1536).
  - Создаём `Theme` + `ThemeIdeaBlock × N` + `ThemeEntity × M` (skipDuplicates).

### Шаг 2 — `reframing.cron` (3:00 — расширение Фазы 4)
- Файл: `backend/src/modules/knowledge-core/workers/reframing.cron.ts`
  (метод `reflectOnThemes`).
- На каждой Org с ≥2 active Theme:
  - Грузим до 50 active тем + 30 свежих блоков без темы.
  - LLM-вызов `taskType: 'reframing'` (JSON Schema strict с `themeSplits/themeMerges/themesToArchive`).
  - **`themeMerges`**: переносим `ThemeIdeaBlock`/`ThemeEntity` с source на
    target (skipDuplicates), source.status='merged_into', mergedIntoId=target.
    Транзакция.
  - **`themesToArchive`**: status='archived'.
  - **`themeSplits`**: только лог-сигнал (рискованно автоматизировать). Owner
    Org разберётся через UI (Фаза 5/6).

## API

| Endpoint | Описание |
|---|---|
| `GET /api/v1/knowledge/themes?branch=&status=&q=&limit=&offset=` | Список тем Org. По умолчанию `status=active`, сорт по `weight DESC, lastSignalAt DESC`. |
| `GET /api/v1/knowledge/themes/:id` | Тема + до 20 блоков (по `weight DESC`) + до 50 entities (по `mentionsCount DESC`). При `merged_into` — отдаём её саму, но кладём `mergedIntoId` в DTO. |
| `POST /api/v1/knowledge/themes/:id/save-as-card` | Создаёт `Card(kind='topic', bornFromThemeId=themeId)`. Body: `{name?: string}` (если не передан — берём `Theme.name`). 409 при `card_name_taken`. |
| `GET /api/v1/cards/:id/themes` | Топ-3 темы карточки (через её блоки). Возвращает `{items:[{id,name,description,branch,blocksInCommon}]}`. |

Все эндпоинты — под `CookieAuthGuard, TenantGuard`. RBAC: `theme` — owner/admin
полный доступ, manager — только read (как `block`/`entity`). См. policy.csv.

## ENV (`KnowledgeCoreSchema`)

```
THEME_CLUSTERER_CRON           = '15 * * * *'    // каждый час в :15
THEME_CLUSTERING_MIN_BLOCKS    = 100             // порог пропуска маленьких Org
THEME_CLUSTER_MIN_SIZE         = 3               // минимальный кластер
THEME_COSINE_THRESHOLD         = 0.78            // порог объединения
CARD_ROLLUP_V2_DEBOUNCE_MS     = 60000           // дебаунс enqueue card-rollup-v2
```

## LLM-маршруты

| taskType | назначение | дефолт |
|---|---|---|
| `theme-classify` | классификация кластера (name/description/branch/tags) | gpt-5.4-nano → deepseek-v4-flash |
| `reframing` | split/merge/archive тем + анализ свежих блоков | deepseek-v4-flash → gpt-5.4-mini |
| `card-rollup-v2` | rollup `Card.summaryCache` поверх блоков | deepseek-v4-flash → gpt-5.4-mini |

Seed: `backend/scripts/seed-llm-task-routes-knowledge-core.ts --update-existing`.

## Что осознанно НЕ сделано (vNext / Фаза 5+)

- ~~**Ручное создание Theme** пользователем~~ — **СДЕЛАНО 2026-07-03** (см. §«Живое пространство темы»: `origin=user`, авто-наполнение, исключения).
- **«Пульс темы для руководителя»** (срез письма COO на уровень темы) — vNext (living-topic-space В3).
- **Переименование/скрытие 12 областей владельцем** — vNext (v1 фиксированы как в `enum ThemeBranch`); хранение ветки колонкой (вместо деривации) — тоже vNext.
- **Sentiment / progress-метрики** темы — vNext.
- **`themeSplits` авторазделение** — только сигнал в логах. Без UI-конфирмации
  риск разрезать неудачно.
- **HDBSCAN** — пока KNN-greedy. На больших Org (>5–10k блоков без темы)
  заменим на pgvector-side query (нативный KNN с HNSW).

## Связи

- [[../02_architecture/knowledge-core]] — общая карта ядра.
- [[cards]] — раздел «Knowledge-core (Фаза 4)»: `entityId/relatedEntityIds/bornFromThemeId/cachedTopThemeIds` + card-rollup-v2.
- [[../02_architecture/data-model]] — модели Theme, ThemeIdeaBlock, ThemeEntity + §«Живое пространство темы» (ThemeExclusion, origin/visibility, addedVia/score/reason).
- [[api-layer]] §Knowledge-core — эндпоинты пользовательских тем + карты областей.
- [[workers-queues]] §`theme-autofill` · [[admin]] §«Крутилки авто-наполнения тем» · [[ai-jobs]] §«Авто-наполнение тем».

## Источники

- ТЗ: [plans/archive/2026-05-10-knowledge-core-tz.md §Фаза 4](../../plans/archive/2026-05-10-knowledge-core-tz.md)
- ТЗ (2026-07-03): [plans/tz/2026-07-02-living-topic-space.md](../../plans/tz/2026-07-02-living-topic-space.md) (пользовательские темы + авто-наполнение) · [plans/tz/2026-07-02-second-brain-by-branches.md](../../plans/tz/2026-07-02-second-brain-by-branches.md) (карта 12 областей).
- Концепция веток компании: [[../02_architecture/knowledge-core]] (enum `ThemeBranch`).
