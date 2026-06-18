---
type: project
status: active
phase: alpha
sba_step: α-7
related:
  - specialist-3-4-project-customer
  - curation
  - chat-v2
related_plans:
  - plans/archive/2026-06-14-cabinet-master-fixes-referral-and-hub.md
---

# SBA α-7 — Specialist 3.1 (Regulations) — первая видимая ценность Слоя 3

> «У компании появились регламенты сами собой» — автогенерация Regulation / Process / Policy из встреч с провенансом до цитаты.

## Что появилось

Specialist 3.1 — третий специалист Слоя 3 (после α-6 Specialist 3.4 и до β-3 Specialist 3.3 Decisions). Закрывает три из 5 уровней «каркаса компании» Фазы 0b:
- **Регламенты** (`Regulation.category='regulation'`) — формальные правила.
- **Стандарты** (`Regulation.category='standard'`) — внешние нормы (ISO и т.п.).
- **Процессы** (`Process` + `ProcessStep`) — последовательности шагов.
- **Политики** (`Policy`) — правила с уровнем строгости.

## Откуда берутся регламенты

Источник — `IdeaBlock`'и с `signalType='regulation'` или `'process_step'`. Их размечает Layer-1 (α-2) в момент BlockExtraction. Router (α-3) диспатчит такие блоки в очередь `core.specialist-routing` jobName=`3-1-regulations`, где consumer — `Specialist31RegulationsWorker`.

Воркер передаёт блок в `Specialist31Service`, который:
1. Делает LLM-вызов `regulation-extract` (DeepSeek-flash → OpenAI gpt-5.4-mini → Ollama qwen3:30b) → черновик `{kind, name, statement, scope?, ownerHint?, severity?, category?, processStepHint?}`.
2. KNN top-5 похожих карточек того же `kind` в Org через cosine на embedding (fallback — ILIKE по name).
3. LLM-арбитр `regulation-dedupe` → verdict `{decision: 'new'|'merge'|'extension'|'contradicts', targetId?}`.
4. Upsert в нужную таблицу (Process/Regulation/Policy) с обогащением полями α-7 (`statement`, `scope`, `ownerPersonId`, `sourceBlockIds`, `personSubjectIds`, `embedding`).
5. Если verdict='contradicts' — `ConflictService.report` с relationType='contradicts'.
6. `CurationService.triage` — поскольку `regulation`/`process`/`policy` в `CURATION_CRITICAL_TYPES_DEFAULT` → **всегда deep review** (CurationItem с candidateCuratorIds).
7. `Specialist31ProbeService` — 4 probe-event'а (см. ниже).

## Probe-events

| Reason | Trigger | Получатели |
|---|---|---|
| `regulation.missing_owner` | Active регламент/процесс/политика без `ownerPersonId` | admin'ы Org |
| `regulation.process_no_steps` | Process без `ProcessStep`-записей | owner процесса + admin'ы |
| `regulation.stale` | `lastConfirmedAt > 6 мес` AND есть свежие блоки-источники | owner + admin'ы |
| `regulation.scope_unclear` | Regulation без `scope` ИЛИ Policy(mandatory/blocking) без `scope` | admin'ы Org |

Отправка — `ConversationalService.sendNotification({eventType:'specialist.probe', ...})`. После β-5 (`ProbeService`) превратится в тонкую обёртку.

## Решения по моделям (см. план α-7 §14)

- **§14.1**: НЕ создавали новую таблицу `Regulation` с `kind`. Вместо этого расширили существующие модели Phase 0b (`Process`, `Regulation`, `Policy`) новыми полями in-place: `entityId`, `scope`, `ownerPersonId`, `currentVersionId`, `sourceBlockIds`, `personSubjectIds`, `dataClass`, `embedding`, `lastConfirmedAt`, для Regulation — `statement`/`supersedesId`, для Process — `inputs`/`outputs`/`metricsJson`. UI агрегирует три таблицы в одно `RegulationListItemDto` через дискриминатор `kind`.
- **§14.2**: Standard = `Regulation.category='standard'`.
- **§14.3**: Phase 0b extraction-путь (block-ingest.worker через `GraphService.upsertEntity`) **НЕ переписывали** — он остался жить параллельно. Specialist 3.1 обогащает legacy-записи через `merge`-арбитра (upsert по `(tenantId, name)`).
- **§14.4**: `process-steps-extract` — отдельный LLM-проход поверх группы блоков одного процесса. На α-7 — заглушка через single-step upsert по `processStepHint` из extract-LLM; multi-step pass — будущая итерация.

## REST API + UI

- `GET /api/v1/regulations?kind=&status=&scope=&q=&page=&limit=` — единый список со всех трёх таблиц.
- `GET /api/v1/regulations/:id?kind=` — детальная карточка (для process — со steps).
- `GET /api/v1/regulations/:id/history?kind=` — timeline CardVersion'ов (через единый `resourceType='regulation'|'process'|'policy'`).
- `POST /api/v1/regulations/:id/supersede` — заменить версией (owner/admin).
- `POST /api/v1/regulations/:id/confirm` — пометить `lastConfirmedAt=now()` (owner/admin/curator).
- `GET /api/v1/regulations/:id/sources?kind=` — провенанс-цитаты карточки (источники до цитаты) (ТЗ cabinet-master-fixes C3).
- `GET /api/v1/regulations/summary` — агрегированные счётчики по 4 типам норм для хаба и summary-виджета (ТЗ cabinet-master-fixes C4). С 2026-06-17 в ответ добавлено аддитивное булево поле `redesignEnabled` (kill-switch раскладки, см. ниже).

UI (с 2026-06-17 — новая раскладка «База знаний», см. ниже): дерево-папки по типам слева, читаемая колонка с тумблером ширины в центре, TOC справа. Старая master-detail раскладка (фильтры kind / status / scope / search; в детали — список ProcessStep для process, markdown render statement/contentMd, действия supersede / confirm, аккордеон «Источники» через `/:id/sources`) осталась аварийным fallback при `redesignEnabled=false`.

## Хаб «Оцифровано» (2026-06-14, ТЗ cabinet-master-fixes, часть C)

> **Историческая справка.** На 2026-06-14 раздел назывался «Оцифровано»; с 2026-06-17 переименован в **«База знаний»** (см. раздел «База знаний компании: форматтер + редизайн» ниже). Описание ниже зафиксировано на момент 2026-06-14.

`/regulations` поднят в видимый пункт меню «Оцифровано» (C1; убран дубль `/processes`, `/policies` теперь redirect на `/regulations?kind=policy`). Сама страница стала хабом (C2):
- **Чипы-счётчики** по типам норм (источник — `GET /regulations/summary`); тип берётся из URL (`?kind=`).
- **Вкладка «Шаблоны процессов»** — рядом с основным списком.
- **Блок «Недавно оцифровано»** в хабе + **summary-виджет «Оцифровано» на экране «Сегодня»** (оба питаются `GET /regulations/summary`, C4).
- **Провенанс-цитаты** — аккордеон «Источники» в карточке (`GET /:id/sources`, C3).

## База знаний компании: форматтер на создании + редизайн раздела (2026-06-17, ТЗ knowledge-base-redesign-and-formatter)

Источник — `plans/tz/2026-06-16-knowledge-base-redesign-and-formatter-tz.md`, ветка `feature/knowledge-base-redesign-formatter`, 6 фаз (8 коммитов `6e98d3a8..28b6217e`). Две связанные цели: (1) каждая карточка структурна с **первой** версии, а не только после слияний; (2) раздел читается как настоящая база знаний.

### Форматтер на создании карточки (Ф1)

Раньше структурный компилятор `compile-org-document` (`StructuredDocumentCompilerService.tryCompileContent`) вызывался **только на merge/extension** — карточка, созданная первой (ветка `new`), несла сырой `draft.statement` без `## ` заголовков и таблиц. Теперь компилятор зовётся и в ветке `new` для **всех четырёх** типов карточек:
- для regulation / process / policy он вызывался на merge, добавлен и на create;
- для **instruction** компилятор раньше не вызывался **вообще** — теперь заведён и на create, и на merge.

При успехе LLM пишем `compiled.contentMd` (у process — в поле `description`) **плюс** снимок `CardVersion` v1 одной транзакцией (`trustTier='auto'`, `changeReason='create'`, `previousVersionId=null`) — зеркало merge-ветки. Fallback (kill-switch `docCompilerEnabled` OFF / ошибка LLM / пустой результат) → legacy сырой `draft.statement`, `CardVersion` при этом **не** создаётся. Создание карточки best-effort — провал компиляции её не ломает.

> ⚠️ Устаревшая формулировка «компилятор только на merge / `contentMd` = сырой statement на create» больше **не** актуальна — карточка структурна с v1.

### Бэкфилл старых плоских карточек (Ф2)

`backend/scripts/backfill-compile-flat-cards.ts` — разовый идемпотентный бэкфилл: находит **плоские** карточки (тело без `## ` и без markdown-таблицы), пересобирает их компилятором и пишет `CardVersion` (`changeReason='backfill'`). Идемпотентность двойная: предикат пропускает уже структурные + write-гейт (пишем только если ok + непустое + изменилось + структурно) → повторный прогон = 0 записей. Зарегистрирован в `apply-prod-deploy.ts` STEPS (`phase:'backfill'`, `skipBootstrap` — нужен только при апгрейде).

### Граница промпта regulation ↔ policy (Ф3)

В SYSTEM-промпт `regulation-extract.prompt.ts` добавлена строка-граница: **регламент = ПОРЯДОК по шагам**, **политика = ПРИНЦИП без процедуры** — чтобы экстрактор реже путал `kind='regulation'` с `kind='policy'`.

### Ручная загрузка: docType → signalTypeHint (Ф6)

`document.adapter.ts` (`backend/src/modules/ingest/adapters/document/`) теперь детерминированно доводит загруженный файл до Specialist 3.1: чистая функция `docTypeToSignalTypeHint`:
- `regulation` → `regulation`,
- `policy` → `regulation` (в enum `SignalType` **нет** отдельного значения `policy` — политика идёт через `regulation`, а финальный `kind=policy` ставит экстрактор → `upsertPolicy`),
- `process` / `instruction` → `process_step`,
- прочее → `undefined` (как раньше, тип решает LLM).

Так документ нужного типа гарантированно доезжает до экстрактора Specialist 3.1, а не зависит от классификатора. (Финальный тип карточки всё равно решает экстрактор по `draft.kind` — hint лишь гарантирует доставку.)

### Нейминг «База знаний компании» + таксономия + счётчики (Ф4)

`RegulationsListClient.tsx` + `nav-config.ts`:
- пункт меню «Оцифровано» → **«База знаний»**; заголовок страницы — **«База знаний компании»**;
- фильтры по типам — «Регламенты / Процессы / Инструкции / Политики» («Стандарт» теперь **метка внутри регламента**, не отдельный фильтр);
- счётчики подписаны «В базе: Тип: N», заголовок списка — «Найдено: N» (снят прежний рассинхрон вида «9 политик / Всего 1»).

### Редизайн раскладки за kill-switch `knowledge_base.redesign.enabled` (Ф5)

**Ф5a (backend).** Новый kill-switch `knowledge_base.redesign.enabled` (тип «аварийный рубильник», состояние **ON**). Бэк читает его через `getDynamic` в `getSummary` и кладёт булево поле `redesignEnabled` в ответ `GET /api/v1/regulations/summary` (контракт аддитивный — страница и так грузит summary, отдельного эндпоинта нет; прецедент — `main_rework`/`dashboard_rework`). Сопровождение: seed `seed-admin-setting-knowledge-base-redesign.ts` + STEPS + строка в реестре схемы + `docs/operations/feature-flags.md` + фронтовый api-тип и domain-маппер.

**Ф5b (frontend).** Новая раскладка `RegulationsListClient.tsx` за флагом (дефолт ON), на modern-токенах (`MODERN_PAGE_BG` / `glass()`):
- **левое дерево-папки** по типам (Вся база + 4 типа со счётчиками; «Шаблоны процессов» сведены в дерево **без** отдельной верхней вкладки; «Загрузить вручную» → `/documents`);
- **центральная читаемая колонка** с тумблером «Чтение / Широкий» (max-width 720 / 980);
- **правый TOC** из `## ` заголовков карточки.

Только theme-aware токены (`var(--*)`) → светлая тема флипается автоматически. Старая master-detail раскладка осталась как **аварийный fallback** при `redesignEnabled=false`.

## CardSpecialistRegistry — chat-v2 retrieval

`Specialist31CardHandler.getCardsForQuery` ищет Regulation/Process/Policy с пересечением `sourceBlockIds ∩ candidateBlockIds` retrieval'а chat-v2. Возвращает merged top-N с type='regulation'/'process'/'policy'. ChatV2Service использует эти карточки для подкрепления ответов цитатами регламентов.

## Метрики (label `type` = `'regulation'` / `'process'` / `'policy'`)

- `core_specialist_pipeline_duration_seconds{type}` — длительность цикла.
- `core_specialist_llm_tokens_total{type,model,tier}` — расход токенов.
- `core_specialist_probe_events_total{type,reason}` — probe-events.
- `core_specialist_conflict_events_total{type}` — конфликты.
- `core_specialist_extraction_failures_total{type,reason}` (**новый α-7**) — провалы LLM/JSON/DB.

## Что отложено

- Process multi-step extraction (полный `process-steps-extract` pass поверх группы блоков). На α-7 — single-step upsert.
- UI выбора Person для назначения ownerPersonId — пока только heuristic name-match.
- Workflow approval-цепочки — γ+.
- Импорт из Confluence/Notion — отдельный sub-TZ в ε.

## Файлы

- `backend/src/modules/knowledge-core/workers/specialist-3-1-regulations.worker.ts`
- `backend/src/modules/knowledge-core/services/specialist-3-1-regulations.service.ts`
- `backend/src/modules/knowledge-core/services/specialist-3-1-probe.service.ts`
- `backend/src/modules/knowledge-core/services/specialist-3-1-card-handler.service.ts`
- `backend/src/modules/knowledge-core/specialist-3-1.module.ts`
- `backend/src/modules/knowledge-core/prompts/{regulation-extract,regulation-dedupe,process-steps-extract}.prompt.ts`
- `backend/src/modules/regulations/{regulations.controller.ts,regulations.module.ts,services/regulations.service.ts,dto/regulations.dto.ts}`
- `backend/scripts/seed-llm-task-routes-regulations.ts`
- `frontend/src/api/regulations.api.ts`, `frontend/src/domain/regulation.ts`
- `frontend/app/(authenticated)/regulations/{page.tsx,RegulationsListClient.tsx}`
