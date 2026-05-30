---
name: reframing-cycle
title: Ночная переоценка слабых связей графа
trigger_type: cron
status_overall: implemented
last_audited: 2026-05-29
owners_human:
  - инженер knowledge-core
  - продакт «памяти компании»
related_plans:
  - plans/tz/2026-05-10-knowledge-core-tz.md
related_projects:
  - 02_architecture/knowledge-core.md
  - 01_projects/workers-queues.md
  - 01_projects/ai-jobs.md
---

# Ночная переоценка слабых связей графа

> **Как читать этот файл:** разделы 1–4 — для не-программиста. Раздел 5 — для разработчика. Номера шагов между разделами 3 и 5 синхронизированы.

## 1. О чём это (бытовой рассказ)

Граф знаний — живая структура. За день в нём появляются десятки связей: «этот блок развивает мысль того блока», «эта связь — следствие из той». AI ставит связи с уверенностью от 0 до 1, и часть из них — слабые («может быть связано, не уверен на 100%»). Эти слабые связи нужны в моменте — они дают подсветку «возможно похожее», но через неделю накапливаются и зашумляют картину.

Каждую ночь в 3:00 платформа делает **гигиену графа**:
- **архивирует слабые связи** (уверенность ниже 50% и возраст больше 7 дней) — они уходят в `status='archived'`, не удаляются полностью;
- **«остужает» застойные блоки** — если блок не обновлялся 90 дней, его динамический вес `dynamicScore` снижается на 0.1 (до пола 0.1);
- **AI читает 50 свежих блоков за последние 7 дней** и предлагает: какие можно разбить (`splitCandidates`), какие можно слить (`mergeCandidates`), какие темы стоит переименовать (`themeShifts`);
- **AI читает все активные темы** (до 50) и решает: какие темы можно слить (target побеждает, source становится merged_into), какие архивировать; кандидаты на split — только лог-сигнал, ручное разбирательство.

В результате через месяц-два граф остаётся ёмким, не зарастает старым шумом, и важные связи всплывают наверх — потому что у них высокий `dynamicScore`. Без этого процесса карточки клиентов через полгода становятся «тёмными» — много слабых старых связей, мало свежих сильных.

Splits тем (разделение одной темы на две) **сейчас не автоматизированы** — только лог. Решение об этом всегда принимает человек через UI.

## 2. Что запускает (триггер)

- **Тип:** крон (расписание).
- **Кто или что инициирует:** планировщик NestJS каждую ночь в 3:00.
- **Технический источник:** `@Cron('0 3 * * *')` в `ReframingCron.sweep` (см. `backend/src/modules/knowledge-core/workers/reframing.cron.ts:72`).

## 3. Шаги процесса (общий список)

1. **В 3:00 ночи планировщик будит «переоценщик»** и перебирает все активные организации.
2. **Архивируются слабые связи между блоками** — `IdeaBlockLink` со статусом `active`, уверенностью ниже 50% и возрастом больше 7 дней.
3. **Архивируются слабые связи между сущностями** — `EntityLink` по тем же критериям.
4. **«Остывают» застойные канонические блоки** — если блок не обновлялся 90 дней, `dynamicScore` снижается на 0.1 (до пола 0.1).
5. **AI анализирует свежие блоки** — если за последние 7 дней появилось хотя бы 10 канонических блоков, AI получает до 50 из них и возвращает: какие можно разбить, какие можно слить, какие темы могли сместиться. Результат — только в лог (применение — отдельная Фаза 7).
6. **AI рефлексирует над темами** — если в Org ≥2 активных тем, AI получает карту тем (до 50) и 30 свежих блоков без темы, возвращает `themeMerges`, `themesToArchive`, `themeSplits`.
7. **Применяются темные merges** — `Theme` source становится `status='merged_into'`, `mergedIntoId=target`; `ThemeIdeaBlock`/`ThemeEntity` переносятся на target (с union по существующим записям через `skipDuplicates`).
8. **Применяются темные archives** — `Theme.status='archived'`.
9. **Splits только логируются** — никакой автоматики, owner Org должен разобраться через UI (Фазы 5/6).

## 4. Что получается на выходе

- **Графу знаний:** часть `IdeaBlockLink` и `EntityLink` перешли в `status='archived'`; часть `IdeaBlock` имеют сниженный `dynamicScore`; часть `Theme` слиты или заархивированы; AI-анализ свежих блоков — в лог.
- **Где это видно (опосредованно):**
  - в `GET /api/v1/knowledge/blocks/:id/links` пропадают archived-связи;
  - `GET /api/v1/knowledge/themes` возвращает только status='active' по умолчанию;
  - блоки с низким `dynamicScore` хуже всплывают в гибридном поиске;
  - логи воркера — единственный источник для split-кандидатов и themeShifts.

## 5. Технический разрез (по шагам)

> Номера шагов синхронизированы с разделом 3.

| # | Шаг (бытовой) | Что делает технически | Где живёт код | Очередь / cron / эндпоинт | Записывает в БД | Статус |
|---|---|---|---|---|---|---|
| 1 | Крон будит reframing | `@Cron('0 3 * * *')` в `ReframingCron.sweep` загружает все Org'и с хотя бы одним membership `owner/admin` и `deletedAt=null`; обработка через try/catch на Org; `WorkerOrgGate.checkOrThrow(orgId, 'reframing')` — если выключено в админке, skip Org | `backend/src/modules/knowledge-core/workers/reframing.cron.ts:72,95,119` | cron `0 3 * * *` | — | ✅ |
| 2 | Архивация слабых IdeaBlockLink | `prisma.ideaBlockLink.updateMany({tenantId, status:'active', confidence < SLOW_LINK_MIN_CONFIDENCE=0.5, createdAt < now - SLOW_LINK_AGE_DAYS=7 days}, {status:'archived'})` | `backend/src/modules/knowledge-core/workers/reframing.cron.ts:133` | — | `IdeaBlockLink.status` | ✅ |
| 3 | Архивация слабых EntityLink | Аналогично — `prisma.entityLink.updateMany` с теми же условиями | `backend/src/modules/knowledge-core/workers/reframing.cron.ts:145` | — | `EntityLink.status` | ✅ |
| 4 | dynamicScore decay | `$executeRawUnsafe UPDATE "IdeaBlock" SET "dynamicScore" = GREATEST(0.1, "dynamicScore"::numeric - 0.1) WHERE tenantId=$1 AND status='canonical' AND updatedAt < now - BLOCK_DYNAMIC_SCORE_DECAY_DAYS=90 days AND dynamicScore > 0.1` | `backend/src/modules/knowledge-core/workers/reframing.cron.ts:157` | — | `IdeaBlock.dynamicScore` | ✅ |
| 5 | LLM-анализ свежих блоков | `freshBlocks = ideaBlock.findMany(status=canonical, createdAt >= now - REFRAMING_RECENT_BLOCKS_DAYS=7 days, orderBy createdAt DESC, take REFRAMING_MAX_BLOCKS_TO_ANALYZE=50)`; если `length ≥ REFRAMING_MIN_FRESH_BLOCKS=10` — `analyzeFreshBlocks` шлёт payload в LLM `reframing` с `REFRAMING_BLOCKS_SYSTEM_PROMPT` + JSON Schema strict; результат `{analysis, splitCandidates, mergeCandidates, themeShifts}` **только в лог** (таблица `ReframingLog` — Фаза 7) | `backend/src/modules/knowledge-core/workers/reframing.cron.ts:173,217,261`, `prompts/reframing.prompt.ts` | LLM `reframing` | — (только log) | ⚠️ результат только в лог |
| 6 | LLM-рефлексия тем | `reflectOnThemes(orgId)` — если активных тем ≥2, загружает до `REFRAMING_THEMES_MAX=50` тем + 30 свежих блоков без темы; LLM `reframing` с `REFRAMING_THEMES_SYSTEM_PROMPT` + `REFRAMING_THEMES_JSON_SCHEMA` strict; парсит `{themeMerges, themesToArchive, themeSplits}` | `backend/src/modules/knowledge-core/workers/reframing.cron.ts:307,310,356` | LLM `reframing` | — (промежуточное) | ✅ |
| 7 | Apply theme merges | Для каждого `{sourceId, targetId}` (с валидацией validIds, sourceId≠targetId): транзакция — `themeIdeaBlock.createMany({themeId=target, blockId, weight}, skipDuplicates)` + `deleteMany(source)`; то же для `themeEntity`; `theme.update(source, {status='merged_into', mergedIntoId=target})`; tenant-check на target | `backend/src/modules/knowledge-core/workers/reframing.cron.ts:392,460` | — | `Theme.status` (merged_into), `Theme.mergedIntoId`, `ThemeIdeaBlock` (перенос), `ThemeEntity` (перенос) | ✅ |
| 8 | Apply theme archives | `prisma.theme.updateMany({id, tenantId, status:'active'}, {status:'archived'})` для каждого `themeId` из `themesToArchive` (с валидацией validIds) | `backend/src/modules/knowledge-core/workers/reframing.cron.ts:411` | — | `Theme.status` (archived) | ✅ |
| 9 | Theme splits — только лог | Для каждого `{themeId, reason}` из `themeSplits` (валидация validIds) — `logger.log('split candidate — owner Org должен разобраться')`; **никакой автоматики** | `backend/src/modules/knowledge-core/workers/reframing.cron.ts:433` | — | — (только log) | ⚠️ не автоматизировано (by design) |

### 5.1 Структуры данных, через которые проходит процесс

```
Per Org (с owner/admin membership, deletedAt=null, WorkerOrgGate active):
  1. updateMany IdeaBlockLink → archived (active, confidence<0.5, age>7d)
  2. updateMany EntityLink → archived (active, confidence<0.5, age>7d)
  3. UPDATE IdeaBlock SET dynamicScore = GREATEST(0.1, dynamicScore - 0.1)
     (canonical, updatedAt<now-90d, dynamicScore>0.1)
  4. freshBlocks = top-50 canonical createdAt≥now-7d
     if ≥10 → LLM 'reframing' (block-level) → лог
        { analysis, splitCandidates[], mergeCandidates[], themeShifts[] }
  5. themes = top-50 active by weight DESC
     if ≥2 → LLM 'reframing' (theme-level) → парсит ThemesReframingResponse
        { themeMerges[], themesToArchive[], themeSplits[] }
        → apply merges (Theme.merged_into + ThemeIdeaBlock/ThemeEntity перенос tx)
        → apply archives (Theme.status='archived')
        → splits только log
  6. возвращает counters: scannedOrgs, archivedBlockLinks, archivedEntityLinks,
     decayedBlocks, analyzedOrgs, themeMergesApplied, themesArchivedByLlm,
     themeSplitsLogged
```

### 5.2 LLM-вызовы внутри процесса

| Шаг | taskType | Primary | Secondary | Tertiary | Где промпт |
|---|---|---|---|---|---|
| 5 | `reframing` (системный промпт `REFRAMING_BLOCKS_SYSTEM_PROMPT`, JSON-схема `REFRAMING_BLOCKS_JSON_SCHEMA`) | DeepSeek V4-flash | OpenAI gpt-5.4-mini (через proxy) | Ollama qwen3.5:9b | `backend/src/modules/knowledge-core/prompts/reframing.prompt.ts` |
| 6 | `reframing` (системный промпт `REFRAMING_THEMES_SYSTEM_PROMPT`, JSON-схема `REFRAMING_THEMES_JSON_SCHEMA`) | DeepSeek V4-flash | OpenAI gpt-5.4-mini | Ollama qwen3.5:9b | тот же файл |

Маршрут задаётся `backend/scripts/seed-llm-task-routes-default.ts:225`. **NB:** оба шага используют один `taskType='reframing'`, но **разные системные промпты и JSON-схемы** — `sourceRef.type` различается (`'reframing'` vs `'reframing-themes'`) для метрик. При `AI_FEATURES_PROMPT_INJECTION_GUARD_ENABLED=true` (default) — оба вызова обёрнуты `withInjectionGuard` + `wrapUserData`.

## 6. Точки отказа и наблюдаемость

**Prometheus метрики:** прямых counter'ов в коде нет, но `runForAllOrgs` возвращает summary:
```
{ scannedOrgs, archivedBlockLinks, archivedEntityLinks, decayedBlocks,
  analyzedOrgs, themeMergesApplied, themesArchivedByLlm, themeSplitsLogged }
```
Эти числа попадают в лог `reframing: ночной проход завершён` — оттуда можно собирать дашборды по логам (Grafana / Loki).

**BullMQ очереди:** не используется — это inline-cron. Ошибка на одной Org не валит остальные (try/catch на Org).

**Логи** (pino, контекст `trace`): `ReframingCron`:
- `'reframing: gate disabled — skip Org'` (если WorkerOrgGate.disabled);
- `'reframing: LLM-анализ свежих блоков'` (Шаг 5, лог-сигнал для split/merge/themeShifts кандидатов);
- `'reframing-themes: split candidate — owner Org должен разобраться'` (Шаг 9);
- `'reframing-themes: применены изменения'` (если был хотя бы один merge/archive/splitLog);
- `'reframing-themes: LLM-вызов упал — пропускаю'` (на любую ошибку LLM/JSON-парсинга).

**Известные грабли:**
- **Cron-expression `'0 3 * * *'` зафиксирован в декораторе** (`reframing.cron.ts:72`), ENV `REFRAMING_CRON` читается `TypedConfigService.knowledgeCore.reframingCron`, но в `@Cron(...)` не подставляется (как и в `theme-clusterer`). Изменение времени требует пересборки.
- **Прокидывание ENV-параметров для thresholds (0.5, 7d, 90d, 10, 50) — захардкожено** константами `SLOW_LINK_AGE_DAYS`, `SLOW_LINK_MIN_CONFIDENCE`, `REFRAMING_RECENT_BLOCKS_DAYS`, `REFRAMING_MIN_FRESH_BLOCKS`, `REFRAMING_MAX_BLOCKS_TO_ANALYZE` (только `BLOCK_DYNAMIC_SCORE_DECAY_DAYS=90` через ENV). При желании изменить — править код.
- **Splits не автоматизированы** (`reframing.cron.ts:431`) — сознательно: разделение темы рискованно, требует ручного контроля.
- **Theme merge tenant-check внутри транзакции** (`reframing.cron.ts:506`) — если target внезапно перестал быть active/принадлежит другому tenant'у — throw, транзакция откатывается. Безопасно, но один промах не валит весь Org (try/catch на каждый merge).

**Кнопки админки:** `runForAllOrgs()` помечен public — может быть вынесено в админ-эндпоинт (на 2026-05-29 такого эндпоинта нет, проверь `/admin/...`).

## 7. Связанные процессы

- [[raw-event-to-graph]] — создаёт `IdeaBlockLink`/`EntityLink` через block-linker и entity-graph-builder, которые этот процесс архивирует.
- [[theme-clustering]] — создаёт `Theme`, которые этот процесс может сливать (themeMerges) или архивировать.
- [[card-rollup-v2]] — на следующий rollup карточки `cachedTopThemeIds` пересчитается уже с учётом merged/archived тем; archived `IdeaBlockLink` перестанут попадать в API `/blocks/:id/links`.
- [[meeting-post-processing]] — не дёргает напрямую; влияние косвенное через гигиену графа.

## 8. Расхождения «задумано vs реализовано»

**Заложено в ТЗ, реализовано:**
- ✅ Архивация слабых блок- и entity-связей (Фаза 3 ТЗ).
- ✅ dynamicScore decay для застойных canonical-блоков.
- ✅ LLM-анализ свежих блоков (split/merge/themeShifts) и LLM-рефлексия тем (themeMerges/themeSplits/themesToArchive) — Фаза 4 ТЗ.
- ✅ Применение theme merges с переносом ThemeIdeaBlock/ThemeEntity на target в транзакции.

**Заложено в ТЗ, но реализовано частично / отступления:**
- **LLM-анализ свежих блоков (Шаг 5) — результат только в лог** (`reframing.cron.ts:261`). Таблица `ReframingLog` запланирована на Фазу 7 (Z-Admin). Сейчас split/merge/themeShifts кандидаты теряются после ротации логов.
- **Theme splits не автоматизированы** (Шаг 9, `reframing.cron.ts:431`) — by design, нужен UI Org-owner'а (Фазы 5/6).
- **ENV `REFRAMING_CRON` не применяется** — cron-выражение `'0 3 * * *'` зафиксировано в декораторе (`reframing.cron.ts:48`).

**Реализовано, но в ТЗ не описано:**
- **`WorkerOrgGate`** позволяет owner'у Org выключить reframing целиком для своей Org (`reframing.cron.ts:122`).
- **`withInjectionGuard` + `wrapUserData`** для защиты от prompt-injection в обоих LLM-вызовах (управляется `AI_FEATURES_PROMPT_INJECTION_GUARD_ENABLED`, default true).
- **`sourceRef.type='reframing-themes'`** для второго LLM-вызова — позволяет различать в метриках/логах LLM-роутера.
- **Tenant-check внутри транзакции theme-merge** (`reframing.cron.ts:506`) — защита от cross-tenant merge через подмену LLM-выдачи.

**Гейты, которые меняют поведение по умолчанию:**
- `SLOW_LINK_AGE_DAYS=7` — связи моложе 7 дней не архивируются никогда.
- `SLOW_LINK_MIN_CONFIDENCE=0.5` — связи с confidence ≥ 0.5 живут вечно (пока их явно не пересчитают).
- `BLOCK_DYNAMIC_SCORE_DECAY_DAYS=90` (ENV) — блоки моложе 90 дней не охлаждаются.
- `REFRAMING_MIN_FRESH_BLOCKS=10` — для маленьких Org (меньше 10 блоков за неделю) LLM-анализ не запускается.
- `REFRAMING_THEMES_MAX=50` — больше 50 тем в Org за раз LLM не увидит, обработаются топовые по weight.

## 9. История изменений процесса

| Дата | Что изменилось | Коммит/рефлексия |
|---|---|---|
| 2026-05-29 | Карточка создана | этот документ |
| 2026-05-24 | `withInjectionGuard` + `wrapUserData` для обоих LLM-вызовов | ТЗ 2026-05-24 §4 F1.2 |
| 2026-05-10 | ReframingCron запущен (Фаза 3-4) | plans/tz/2026-05-10-knowledge-core-tz.md |
