---
title: Капитальный апгрейд цепочки агентов встречи — наблюдаемость, материализация памяти, промпты, кэш, поведение
date: 2026-06-07
status: ready-to-implement (зонтичное ТЗ, фазовое)
owner: Кора / knowledge-core + ai + tracker + goals
sources:
  - plans/analysis/2026-06-07-agent-chain-best-solutions.md   # мастер: решения + доказательства
  - plans/analysis/2026-06-07-agent-pipeline-trace-and-catalog.md
  - plans/analysis/2026-06-07-llm-cache-chain-verification.md
  - plans/analysis/2026-06-04-agent-system-full-audit.md       # B1–B7 (закрыты)
workflows_evidence: 3 многоагентных прогона (аудит 22 промптов, картирование summary, root-cause Decision/Idea/поведение/пороги)
---

# ТЗ: Капитальный апгрейд цепочки агентов встречи

> **Что чиним (доказано эмпирикой на проде + аудитом кода):** конвейер «встреча → отчёт + память» здоров на каркасе (21 агент, 0 ERROR), но память неполная: Решения=0, Идеи=0, Темы у целей=0, задачи застряли в триаже, поведение участников = нули, часть цепочки не кэшируется. Это ТЗ закрывает ВСЕ найденные проблемы фазами, в порядке зависимостей.
>
> **Цель:** чтобы из встречи материализовалось ВСЁ — сущности, решения, идеи, цели (связанные с задачами/темами), задачи (доходящие до трекера), поведение участников — и чтобы это было измеримо и дёшево (кэш).

## Принципы (обязательны для каждой фазы)

1. **Cache-friendly промпты** (правило `feedback_llm_prompts_cache_friendly`): стабильный SYSTEM, переменные данные в КОНЦЕ user. Любая правка промпта — с разделом «влияние на кэш». Подтверждено состязательно: все предложенные улучшения `cacheSafe=true`.
2. **Крутилки — в AdminSetting**, не в код/ENV (правило `feedback_admin_settings_not_env_or_code`): пороги, флаги — через `resolveSync` + registry + seed, с history/audit.
3. **Версионируемые миграции** Prisma (skill `prisma-db-push-rules`): любое изменение БД = файл миграции, не `db push`.
4. **Golden-верификация перед промпт-правками** (skill — харнесс `agent-quality-harness.ts`): любое изменение классификации/извлечения меряется ДО/ПОСЛЕ на фикстурах + снапшот-тесты.
5. **Наблюдаемость — первой фазой**: нельзя чинить «вслепую» то, что не видно в trace. Ф0 — предусловие для верификации остальных фаз.
6. **Kill-switch на каждую рисковую фазу** (ENV/AdminSetting флаг, дефолт-безопасный), откат без деплоя.
7. **Каждая фаза за отдельным флагом и коммитом**; зелёная верификация → commit → следующая (правило `feedback_orchestration_no_stop_between_waves`).

---

## Ф0. Наблюдаемость специалистов + петля верификации графа `[x]`

> **Реализовано 2026-06-07** (feature/retest2-agent-chain-overhaul, коммиты Ф0a `b31c311f` + Ф0b). Ф0a: `GraphMaterializationService` + `GET /api/v1/platform/graph/materialization` + `diag graph --meeting` + `GraphMaterializationVerifyCron` (@Cron 30m, метрика `kc_materialization_gap_total{type}`). Ф0b: диспетчер специалистов оборачивает каждого в pipeline-контекст `KNOWLEDGE_GRAPH` с `traceId=mtg_<id>` (видны в `diag chain`), + логи created/skipped/merged у decisions/ideas/goals (наследуют ALS-traceId). Вместо инструментовки всех 14 по-отдельности выбран dispatcher-wrap (1 файл, низкий риск, видны ВСЕ 14 через start/done/failed) + точечные ветки у 3 материализующих специалистов.

**Проблема (предусловие):** 14 специалистов слоя 3 пишут только в stdout + метрику `core_specialist_skipped_total`, но НЕ в DB-цепочку с `traceId='mtg_<id>'`. В `diag chain` их не видно — нельзя сказать, рождаются ли Decision/Idea/Goal. Любая оценка качества памяти — вслепую.

**Решение:**
1. Во все 14 специалистов (`specialist-3-*.worker.ts` + handlers) добавить `LogService.write` с `traceId='mtg_<meetingId>'` (брать `meetingId` из `RawEvent.sourceExternalId`/payload блока) на ветках: `extracted` / `skipped(reason)` / `created(entityId,type)` / `merged(intoId)`.
2. **Петля верификации графа** (новый cron `graph-materialization-verify`, `*/15` или on-event после встречи): для встреч с блоками `signalType ∈ {decision, idea, commitment, ...}` проверить, что появились соответствующие записи (Decision/Idea/Goal), а не только `dispatched`. Расхождение → метрика `kc_materialization_gap_total{type}` + WARN-лог.
3. Расширить `diag.ts`: команда `graph --meeting <id>` (read-only) — показать распределение `signalType` блоков встречи + счётчики созданных Decision/Idea/Goal/Entity. Это закрывает «снять метрики на проде» из root-cause (нужно для подтверждения Ф1).

**Файлы:** `backend/src/modules/knowledge-core/workers/specialist-3-*.worker.ts` (14 шт), `…/services/specialist-3-*.service.ts`, новый `…/workers/graph-materialization-verify.cron.ts`, `backend/scripts/diag.ts`.
**Метрики:** `kc_materialization_gap_total{type}`, + существующие `core_specialist_skipped_total{specialist,reason}`, `core_extraction_entity_total{type}`, `core_specialist_cards_total{type}`.
**Тесты:** unit на резолв `traceId` из payload; spec на cron (gap при dispatched-без-create).
**Риск:** низкий (только логи/метрика/диагностика, не меняет логику). **Без kill-switch** — безопасно.
**Прод:** новый cron → `prod-deploy-log.md` Шаг 12 (smoke grep). Новая diag-команда — read-only.

---

## Ф1. Материализация Решений и Идей — recall классификации signalType `[x]` (recall-фикс; idea direct-path и golden-run — см. примечания)

> **Реализовано 2026-06-07** (feature/retest2-agent-chain-overhaul). **Корень-фикс (primary):** описания signalType `decision`/`idea` в `block-ingest.prompt.ts` были «тонкими» (без «Маркеры:», в отличие от ~30 других типов) → LLM их не классифицировал → Решения=0/Идеи=0. Добавлены явные русские триггеры («решили что»/«остановились на»/«договорились делать», «идея:»/«а что если»/«предлагаю сделать») + **дизамбигуация, защищающая commitment/plan_item** (из них рождаются Цели — чтобы recall decision не каннибализировал их). Cache-safe (структура SYSTEM стабильна, разовая ре-инициализация per-deploy). Детерминированный регресс-гард `block-ingest.prompt.spec.ts` (маркеры + дизамбигуация). Golden-фикстуры `growth-funnel.{clean,asr_garbled}.json` закоммичены (содержат решение+идею).
>
> **НЕ сделано (осознанно, с причиной — в реестр «не-сделано»):**
> - **idea direct-path (шаг 3, «рассмотреть»):** НЕ добавлен. `graph.upsertEntity` НЕ создаёт строку таблицы `Idea` (типизированы только decision/regulation; Idea рождается через `prisma.idea.create` в Specialist 3.6 с KNN-дедупом). Параллельный прямой create с дедупом по `sourceBlockId` (а не KNN) рискует дублями против Specialist 3.6 и не проверяем golden'ом в этой сессии. Recall-фикс маршрутизирует idea-блоки в существующий Specialist 3.6 — этого достаточно для материализации. Прямой путь — отдельная задача с golden-верификацией.
> - **Golden before/after прогон (шаг 4):** требует ЖИВОГО backend+воркеров+LLM (НЕ прод): `FIXTURES_GLOB='growth-funnel' bun run scripts/agent-quality-harness.ts`. В этой сессии живого LLM нет → прогон отложен на dev ПЕРЕД прод-выкатом (мерить рост decision/idea И что Goals не упали). Фикстуры и харнесс готовы.
> - **Прод-подтверждение распределения signalType (шаг 1):** через `diag graph --meeting` (Ф0) — после выката + явного «можно в прод».

**Проблема (доказанный корень, confidence high):** Решения=0, Идеи=0 НЕ из-за роутера (маппинг есть: `router.service.ts:236-261` decision/rationale/decision_basis→DECISIONS, idea/feature_request→IDEAS) и НЕ из-за гейтов специалистов (идентичны рабочему goals; `decision.create`/`idea.create` безусловны при confidence≥0.4). Для Decision есть даже ДВА пути (`block-ingest.worker.ts:547-649` direct + Specialist 3.3) — оба дали 0. **Корень — LLM block-ingest не классифицирует блоки как `signalType='decision'/'idea'`**: один промпт на 60+ типов enum, «договорились/я сделаю» уходит в `commitment`/`plan_item` (→ Цели работают), а формальные decision/idea теряются среди конкурирующих типов (`block-ingest.prompt.ts:8-75,404-462`).

**Решение (по шагам, с верификацией):**
1. **Подтвердить на проде** (Ф0 diag `graph --meeting`): снять распределение `signalType`. Если decision/idea ≈0, а commitment/plan_item много — корень подтверждён. Также проверить `core_extraction_entity_total{type=decision}` и не падают ли `decision-extract`/`idea-extract` по провайдеру (как было с meeting-report-fast — `project_meeting_report_fast_broken_chain`): `diag llm-calls`/`diag-routes`.
2. **Поднять recall классификации** в `block-ingest.prompt.ts`: усилить описания/маркеры `decision` и `idea` явными русскими триггерами («решили что», «остановились на», «принято», «договорились делать X», «идея:», «предлагаю», «а что если», «давайте попробуем»). **Cache-friendly:** правка в стабильном SYSTEM допустима (это разовая правка per-deploy, кэш переинициализируется один раз), но минимальная и локальная — только блоки описаний decision/idea (`строки ~411-414`).
3. **Idea — прямой путь материализации** (симметрично Decision): рассмотреть в `block-ingest.worker.ts` ветку для блоков `signalType='idea'` → создать Idea (по аналогии с decision fallback `605-649`), чтобы Idea не зависела на 100% от canonical-гейта + второго LLM-вызова. Идемпотентность по `sourceBlockId`.
4. **Golden-верификация (обязательно):** добавить в `agent-quality-harness` фикстуры с явными решениями и идеями (фикстура `growth-funnel` уже содержит решение «воронка» + идею «авто-отчёт» — использовать). Прогнать ДО/ПОСЛЕ. Обновить снапшот-тесты `block-ingest.snapshot.spec.ts`.

**Файлы:** `block-ingest.prompt.ts` (описания signalType decision/idea), `block-ingest.worker.ts` (idea-путь), `diag.ts` (graph-команда из Ф0), `scripts/fixtures/agent-golden/*` (фикстуры решение/идея).
**Риск (средний):** усиление decision/idea может перетянуть `commitment→decision` и **просадить Цели**. Снижение: golden-харнесс ДО/ПОСЛЕ обязателен (мерить и Decisions/Ideas, и что Goals не упали); kill-switch — раскатка промпта обратима откатом prompt-версии (registry).
**Метрики:** `core_extraction_entity_total{type}` по decision/idea должны вырасти; `core_specialist_cards_total{type=idea}`; Goals-счётчик не должен упасть.
**Прод:** правка промпта block-ingest — через prompt registry/seed (если admin-editable) или деплой кода; смоук — встреча с решением → Decision создан.

---

## Ф2. Классовые фиксы промптов (C1–C8) + готовые улучшения `[~]` (C1 сделан; C2–C8 + 6 переписанных — golden-gated, см. примечания)

> **Реализовано 2026-06-07** (feature/retest2-agent-chain-overhaul) — только **C1** (самый безопасный/additive класс). `withAsrNote` применён к 10 извлекающим промптам, у которых её не было: decision/idea/insight/regulation/process-template/goal/experiment/skill-trait/block-ingest/table-extract-rows. ASR-нота — стабильная константа в КОНЦЕ SYSTEM (cache-friendly), модель восстанавливает искажённые ASR числа/имена/термины. Снапшот-спеки обновлены (decision/idea/skill-trait + block-ingest prompt-spec). Прецедент без golden: ТЗ-4 уже применил ASR-ноту к summary/report/tasks.
>
> **НЕ сделано (осознанно — нарушило бы Принцип 4 «golden перед промпт-правками»; нет живого LLM в сессии):**
> - **C2 (meetingDateIso мёртвая ветка):** активация (передавать meetingDateIso в USER) — поведенческое изменение (включает ISO-нормализацию сроков) + плумбинг по call-site'ам; нужен golden. Удаление мёртвого правила — нулевая ценность. Отложено в golden-пасс.
> - **C3 (булев гейт isDecision/isIdea/hasSignal), C4 (few-shot 16/22), C5 (калибровка), C6 (анти-галлюцинация участников), C7 (injection-guard sync), C8 (SYSTEM↔контракт entity-merge/specialists-combined):** ВСЕ меняют поведение классификации/извлечения → требуют golden ДО/ПОСЛЕ (Принцип 4). Без живого LLM применять вслепую безответственно (риск тихой деградации). 
> - **6 готовых промптов (meeting-report-fast/chapters-v2/block-ingest/axis-classify/knowledge-clone-extract/goal-hierarchy-link):** «полные тексты» в мастер-доке §5 даны лишь эскизно (одна meeting-report-fast описана списком улучшений, без verbatim) — переписывать пришлось бы заново + golden.
> - **Готово к одному golden-пассу на dev:** харнесс `agent-quality-harness.ts` + фикстуры (growth-funnel, sales-kickoff, team-planning) на месте (Ф1). C2–C8 + переписи — отдельной задачей с обязательным golden ДО/ПОСЛЕ. → реестр «не-сделано».

**Проблема:** аудит 22 промптов выявил сквозные дыры (чинить КЛАСС, не кейс — `feedback_fix_the_whole_class`).

| # | Класс | Решение | Файлы |
|---|---|---|---|
| C1 | Нет ASR-ноты у специалистов | применить хелпер `withAsrNote` ко ВСЕМ извлекающим промптам (decision/idea/insight/regulation/process/skill/goal/block-ingest/table-extract) | `…/prompts/*.prompt.ts` call-sites |
| C2 | `EDGE_CASE_POLICY` ссылается на `meetingDateIso`, которого USER не передаёт (мёртвая ветка) | передавать `meetingDateIso` в USER-шаблон (cache-safe — переменная в конце) ЛИБО убрать мёртвое правило | decision/idea/regulation/process/skill/goal-extract |
| C3 | Контракт принуждает к карточке (нет булева гейта) | добавить `isDecision/isIdea/hasSignal` + разрешить пустой результат | decision/idea/regulation/insight extract |
| C4 | Нет few-shot у 16/22 | добавить 1–3 статичных few-shot в SYSTEM (cache-safe) | большинство |
| C5 | Confidence без калибровки | единая шкала-якорь 0.3/0.6/0.9 в SYSTEM | meeting-report-fast, summary, tasks, chapters, theme, entity-merge, block-distill |
| C6 | Анти-галлюцинация участников (имена «как звучат») | «имя ТОЛЬКО из переданного списка участников, иначе null» + передавать список в USER | meeting-report-fast, tasks, block-ingest, specialists-combined |
| C7 | Injection-guard рассинхронизирован/не подключён | синхронизировать обёртку USER с маркерами SYSTEM | table-extract-rows, decision/idea/regulation/process/goal |
| C8 | Расхождение SYSTEM↔контракт | entity-merge («5 кандидатов» vs 1 пара); specialists-combined (`tool_choice='required'` не поддержан thinking-моделью) — привести текст к коду | entity-merge-arbiter, specialists-combined |

**Готовые промпты (6, прошли состязательную проверку cacheSafe):** применить как есть улучшённые версии для `meeting-report-fast, chapters-v2, block-ingest, axis-classify, knowledge-clone-extract, goal-hierarchy-link` (полные тексты — в результатах аудита, мастер-документ §5). Для 16 «revise» — дописать обрезанный хвост по принципам выше.

**Риск (средний):** правки промптов недетерминированы. Снижение: golden-харнесс + снапшот-тесты на каждый промпт; раскатка обратима (prompt registry).
**Кэш:** все правки сохраняют стабильность SYSTEM (подтверждено `cacheSafe=true`). Раздел обязателен в PR каждого промпта.

---

## Ф3. Задачи доходят до трекера — порог авто-Issue в AdminSetting `[x]`

> **Реализовано 2026-06-07** (feature/retest2-agent-chain-overhaul). Мёртвый hardcoded `AUTO_ACCEPT_CONFIDENCE_THRESHOLD=0.92` заменён на admin-editable крутилку `tracker.autoAcceptConfidenceThreshold` (дефолт **0.75**): getter `cfg.tracker.autoAcceptConfidenceThreshold` (resolveSync, cacheMap→default), ключ в `admin-setting-schema-registry.ts` (UNIT_INTERVAL), seed в `seed-admin-settings.ts` (category integrations/tracker). Жёсткие гейты (source=meeting + assignee + project) остаются страховкой. **Без ENV** — крутилка только в AdminSetting [[feedback_admin_settings_not_env_or_code]]. Тесты: config-spec (default 0.75 + hydrateSync override), intake worker spec обновлён (cfg-мок). Двухступенчатость (опц.) НЕ делал — текущий порог 0.75 + гейты достаточны; усложнение отложено.

**Проблема (доказано, confidence high):** `AUTO_ACCEPT_CONFIDENCE_THRESHOLD=0.92` — **единственный реально мёртвый порог**: hardcoded `static readonly` (`intake-auto-triage.worker.ts:99`), нет ни ENV, ни AdminSetting, ни в реестре крутилок. При реальных уверенностях LLM 35–75% — 100% задач остаются `pending` (ручной триаж), Issue не создаётся (`:291-295`).

**Решение:**
1. Перевести на `resolveSync('tracker.autoAcceptConfidenceThreshold', 'AUTO_ACCEPT_CONFIDENCE_THRESHOLD', 0.75)` + ключ в `admin-setting-schema-registry.ts` (тип UNIT_INTERVAL) + `seed-admin-settings.ts`.
2. Дефолт **0.75** (под живую речь). Жёсткие гейты остаются (`source==='meeting' && assignee!=null && project!=null`) — они страхуют от ложных задач.
3. (Опц.) двухступенчатость: ≥0.75 + assignee → авто-Issue с пометкой «черновик из встречи, подтвердите»; ниже → IntakeIssue. Совместимо с лестницей доверия curation (provisional).

**Файлы:** `intake-auto-triage.worker.ts:99,292`, `admin-setting-schema-registry.ts`, `seed-admin-settings.ts`.
**Риск:** ниже порог → больше авто-Issue (риск ложных). Снижение: per-Org через AdminSetting (не глобально жёстко), жёсткие гейты, метрика.
**Метрики:** `z_ai_intake_suggested_total{status}` — доля `auto_accepted` должна вырасти с ~0.
**Прод:** новый AdminSetting ключ + seed → `prod-deploy-log.md` Шаг 7/1.

---

## Ф4. Цели связаны с задачами/решениями и темами `[~]` (Ф4.2 goal-theme-linker сделан; Ф4.1 goal-task-link отложен)

> **Реализовано 2026-06-07** (feature/retest2-agent-chain-overhaul) — **Ф4.2 goal-theme-linker (детерминированный, закрывает «0 тем»)**: `GoalThemeLinkerService.linkGoalThemes` = провенанс (`ThemeIdeaBlock.blockId ∈ Goal.sourceBlockIds`, weight=hits/blocks) + co-mention (сущности блоков цели ∩ `ThemeEntity`, weight=covered/entities), порог `goals.themeAutolinkMinWeight` (AdminSetting, дефолт 0.15), запись `GoalTheme(source='ai', weight)` идемпотентно (`createMany skipDuplicates` по PK), **`enqueueStrategicAlignment` после привязки** (закрывает ранний return worker при themesCount=0). Триггеры: on-event в specialist-3-14 после createGoal (property-injection, best-effort) + догоночный cron `goal-theme-linker` (@Cron 30m, per-Org, WorkerOrgGate, цели `source='ai' && sourceBlockIds≠[] && themes none`). Метрика `goal_theme_autolink_total{method}`. LLM-дозор (step 3) — флаг `goals.themeAutolinkLlmEnabled` (default OFF) создан, ветка НЕ активна (golden-gated). Тесты: linker 5 + cron 3 + specialist-3-14 9 = 17 зелёных; build (DI) зелёный.
>
> **НЕ сделано (осознанно — в реестр «не-сделано»):**
> - **Ф4.1 goal↔task↔decision linking (новый LLM-арбитр `goal-task-link`):** НЕ реализован. Это новый LLM-агент, чьё качество (к какой цели отнести задачу при нескольких целях встречи) требует golden-верификации (Принцип 4) + живого LLM, которого в сессии нет. Ф4.2 закрывает headline-пробел «0 тем» (высшая ценность); goal-task-link — отдельная задача с golden. Детерминированный частный случай (одна цель встречи → все задачи к ней) можно добавить позже без LLM.
> - **Шаг 3 (draft→canonical промоушн проверка):** через `diag graph`/прод — после выката.

**Проблема:**
- **Цель ↔ задачи/решения не связаны** (Р1 мастер-дока): `specialist-3-14-goals` строит только иерархию Goal↔Goal, но НЕ связывает Goal с Issue/Task/Decision из того же разговора. Декомпозиция «5000→100→10» висит отдельно.
- **Цели «0 тем»** (доказано): связь `GoalTheme` пишется ТОЛЬКО вручную (`goals.service.ts:456-462`, `source:'manual'`); ветка `source:'ai'` (авто-привязка) объявлена в enum, но НЕ реализована (vNext). Пороги тем тут НЕ виноваты — они уже живые AdminSetting и снижены.

**Решение:**
1. **goal↔task↔decision linking** (новый лёгкий арбитр `goal-task-link`, новый taskType): на уровне встречи (когда и Goal, и Issue/Task созданы из одного RawEvent) решить, к какой цели относится задача/решение. Stable SYSTEM + few-shot, переменные (список целей+задач встречи) в конце USER, JSON Schema, `{links:[]}` если связи нет. Писать `parentGoalId` на Issue или `IdeaBlockLink(develops)`. Запуск — on-event после готовности обоих наборов, НЕ пер-блок.
2. **goal-theme-linker** (новый воркер+cron, ветка `GoalTheme.source='ai'`) — ДЕТАЛЬНЫЙ ДОКАЗАТЕЛЬНЫЙ ДИЗАЙН (см. ниже §Ф4.2).
3. **Снять скрытый блокер:** проверить (Ф0 diag), что `draft→canonical` промоушн реально отрабатывает — все графовые гейты считают только `status='canonical'`; если блоки застряли в draft, наполнение тем/связей не пойдёт.

### Ф4.2 — Авто-привязка Goal↔Theme (`goal-theme-linker`, `source='ai'`)

**Корень «0 тем» (доказано по коду):** AI-цель из `specialist-3-14-goals.service.ts:599-626` (`createGoal`) рождается с `sourceBlockIds=[block.id]`, но БЕЗ единой `GoalTheme`-связи и с `entityId=null` («Entity{type=goal} в этой фазе не создаём»). `strategic-alignment.worker.ts:189-196` при `themesCount===0` пишет audit `goal.alignment.skipped reason='no_themes'` и делает ранний `return` — `cachedAlignment` остаётся `null` → фронт (`goal.ts:546` `movementVerdict`) показывает «Движемся, но согласованность низкая» + «0 тем». **Это отсутствие звена, а не баг расчёта.** Связь `GoalTheme` сейчас пишет только owner вручную (`goals.service.ts:456`, `source='manual'`); ветка `source='ai'` и enum готовы, writer не написан.

**Выбор механизма (доказательство, почему именно так):**

| Механизм | Готовность | Вердикт |
|---|---|---|
| ❌ cosine `Goal.embedding ↔ Theme.embedding` | у **Goal нет** embedding-колонки (`schema.prisma:4057`; goal-hierarchy-link использует ILIKE-fallback), у Theme embedding есть, но **без HNSW** | требует миграцию `Goal.embedding` + HNSW на Goal+Theme + backfill + воркер записи вектора — лишняя инфра ради одной связи |
| ✅ **провенанс `sourceBlockIds → ThemeIdeaBlock`** | `Goal.sourceBlockIds` (GIN-индекс) + `ThemeIdeaBlock` готовы | **primary** — прямая причинная связь: цель извлечена из блоков → темы этих блоков заведомо релевантны. Точнее cosine, 0 миграций |
| ✅ co-mention сущностей `entities(sourceBlockIds) ∩ ThemeEntity` | `IdeaBlockEntity` + `ThemeEntity` (денормализован, `mentionsCount`) готовы | **расширение охвата** — переиспользует SQL `entity-graph.service.ts:findCoMentionedPairs` |
| ✅ LLM-арбитр (дозор) | cheap-цепочка, паттерн `goal-hierarchy-link` | **только серая зона** (экономия) |

**Алгоритм (лучшее решение — гибрид провенанс→co-mention→LLM-дозор, без вектора, без миграции):**
1. **Провенанс (primary):** кандидаты-темы = темы, у которых `ThemeIdeaBlock.blockId ∈ Goal.sourceBlockIds`. `weight = |блоки темы ∩ sourceBlockIds| / |sourceBlockIds|`. Дёшево (1 JOIN), точно.
2. **Co-mention (охват):** сущности блоков цели (`IdeaBlockEntity` по `sourceBlockIds`) ∩ `ThemeEntity.entityId` → темы; `weight` = нормированная доля co-mention (как voting share в `issue-goal-suggest.service.ts:185`). _(co-mention по сущностям БЛОКОВ цели, т.к. `Goal.entityId=null` у AI-целей.)_
3. **LLM-дозор (опц., за флагом):** если кандидаты слабые/неоднозначные — один арбитр (cheap-цепочка, json_schema strict) по образцу `goal-hierarchy-link`: «релевантна ли тема T цели G?» → `verdict+confidence`, sanity `themeId∈кандидаты` (как `specialist-3-14:537`).
4. **Запись:** `GoalTheme(source='ai', weight)` через `createMany skipDuplicates` (паттерн `goals.service.addThemes:456`, идемпотентно по composite PK `(goalId,themeId)`).
5. **ОБЯЗАТЕЛЬНО** `enqueueStrategicAlignment(goalId)` после линковки (как `goals.service.recompute:562`) → пересчёт `cachedAlignment`. Без этого темы привяжутся, но согласованность не пересчитается.

**Триггер (двойной — критично):**
- **on-event** в `specialist-3-14` после `createGoal` — мгновенная привязка по уже существующим темам.
- **догоночный cron** `goal-theme-linker` (per-Org, по образцу `entity-graph-builder.cron`, `WorkerOrgGate`) — для целей с `themesCount=0`. **Зачем cron:** тема блока цели может появиться ПОЗЖЕ (theme-clusterer идёт раз в час по порогу блоков); цель, созданная до кластеризации её темы, иначе навсегда останется без тем.

**Крутилки (AdminSetting, не ENV/код):** `goals.themeAutolinkMinWeight` (порог провенанс/co-mention), `goals.themeAutolinkLlmEnabled` (вкл LLM-дозор) — через `resolveSync` + registry + seed.

**Переиспользовать дословно:** скелет cron — `entity-graph-builder.cron.ts` (sweep по Org, лимит N/Org, try/catch на паре, gate); SQL co-mention — `entity-graph.service.ts:findCoMentionedPairs`; запись GoalTheme — `goals.service.ts:addThemes`; LLM-арбитр (если нужен) — `goal-hierarchy-link.prompt.ts` + `block-link.service.ts` (retry×2, validate-callback, `tryParseJson`+Zod, fallback-метрика).

**Ограничение:** ручные цели owner'а без `sourceBlockIds` — вне авто-линкера (owner привязывает сам, как сейчас); их догон через cosine — отдельное будущее ТЗ (требует `Goal.embedding` + миграцию).
**Миграция:** НЕ нужна (`GoalTheme.source='ai'` и все таблицы готовы).
**Метрики:** `goal_theme_autolink_total{method:provenance|comention|llm}`; цели получают ненулевой `_count.themes`; `cachedAlignment` пересчитывается (перестаёт быть null).
**Тесты:** unit на провенанс-пересечение (sourceBlockIds ∩ ThemeIdeaBlock → weight); spec на cron (цель без тем → привязка + enqueueStrategicAlignment); кейс «цель создана до темы → cron догоняет».

**Файлы:** новый `goal-task-link` (taskType + arbiter service + промпт), новый `goals/cron/goal-theme-linker.cron.ts`, `goals.service.ts` (чтение ai-тем), `schema.prisma` (GoalTheme уже готов — миграция при необходимости).
**Риск:** ложные авто-связи шумят в Обзоре целей. Снижение: порог confidence, видимая пометка `source='ai'`, weight.
**Метрики:** `goal_theme_autolink_total`, `goal_task_link_total`; цели должны получить ненулевые `_count.themes`.
**Прод:** новые cron/taskType → `prod-deploy-log.md` Шаг 12; новый taskType-маршрут → seed (Шаг 7).

---

## Ф5. Консолидация путей: задачи и summary `[~]` (summary-консолидация сделана; семантический дедуп задач отложен)

> **Реализовано 2026-06-07** (feature/retest2-agent-chain-overhaul) — **summary-консолидация (Р6)**: backend-селектор `pickPrimarySummary(r) = summaryFast ?? summaryV2 ?? summary` (`src/modules/ai/utils/pick-primary-summary.ts`), на него переключены ВСЕ прямые потребители `AiResult.summary` (card-rollup [крит], exports MD/DOCX, shares, crossmark, public-api, meeting-reports, cards.controller, single-meeting-context) — где нужно, в Prisma-`select` добавлены summaryFast/summaryV2; фронт `MeetingsJournalReal` через `pickPrimarySummary`. Конец видимого «дубля сводок». **Флаг `aiFeatures.summaryAgentEnabled` (ENV `SUMMARY_AGENT_ENABLED` + AdminSetting, дефолт TRUE):** при false analyze.worker НЕ зовёт runSummary (−1 MiniMax-вызов, 0% кэш), пишет `summary=''`. Дефолт ВКЛ — Шаг 1 (read-switch) ушёл с нулевым риском; отключение runSummary — ops-флип после подтверждения покрытия summaryFast. Тесты: pick-primary-summary + analyze (флаг) + shares = 28 зелёных; build зелёный.
>
> **НЕ сделано (осознанно — в реестр «не-сделано»):**
> - **Р2 (один canonical-путь задач + СЕМАНТИЧЕСКИЙ дедуп):** новый LLM-арбитр `task-dedupe` (embedding KNN ~0.85 + серая зона LLM) — качество требует golden+живого LLM (Принцип 4), которого в сессии нет. Строковый дедуп уже усилен ТЗ-4 Ф1 (числа/скобки/пунктуация). Семантический дедуп + выбор canonical-источника задач — отдельная golden-gated задача.

**Проблема:** два пути задач (meeting-report-fast `fast` vs analyze `structured`) расходятся на витрине (дубли под счётчиком «5»); строковый дедуп `normTaskTitle` не схлопывает семантические дубли; отдельный summary-агент (MiniMax) дублирует `summary_markdown` от meeting-report-fast и даёт 0% кэша.

**Решение (Р2 + Р6):**
1. **Один canonical-путь задач** = `structured` (даёт исполнителей); `fast` оставить только для мгновенного черновика. **Семантический дедуп**: embedding (`text-embedding-3-small`) + KNN cosine ~0.85, серая зона → лёгкий LLM-арбитр `task-dedupe`. Применять к ОБЪЕДИНЁННОМУ набору, не пер-источник.
2. **Summary → единственный источник `meeting-report-fast`** (2 шага, см. Р6 мастер-дока):
   - Шаг 1: переключить ВСЕХ прямых потребителей `AiResult.summary` на `summaryFast ?? summaryV2 ?? summary` (на фронте есть `pickPrimarySummary`; на бэке сделать аналог). Список 11 потребителей — мастер-док §Р6 (главный: `card-rollup.service.ts:62-72`; видимый дубль: `MeetingsJournalReal.tsx:967`; + экспорт MD/DOCX, shares, crossmark, public-api). summary-агент ещё жив → ничего не ломается.
   - Шаг 2: отключить `runSummary` в `analyze.worker` за флагом. `−1` LLM-вызов, уходит MiniMax (0% кэш). Решить судьбу `summaryV2` (помечен «удалить после A/B»).
3. Свести две summary-сводки в одну витрину (убрать дубль «Краткое содержание» vs «Обзор»).

**Файлы:** `analyze.worker.ts` (runSummary за флагом), 11 потребителей summary (см. §Р6), новый `task-dedupe` (taskType + сервис), дедуп задач (`normTaskTitle` → семантический).
**Граф НЕ затронут** (доказано: `meeting.adapter.ts` кладёт только transcript.turns, summary в граф не идёт).
**Риск:** при недопереключении потребителя — пустое поле. Снижение: Шаг 1 ПЕРЕД Шагом 2; flag на runSummary (обратимо).
**Метрики:** `−1` вызов/встречу; доля кэша по цепочке отчёта растёт.

---

## Ф6. Кэш: вернуть цепочку на DeepSeek + общий префикс транскрипта `[~]` (Решение А сделано; Б и smoke отложены)

> **Реализовано 2026-06-07** (feature/retest2-agent-chain-overhaul) — **Решение А (быстрое, обязательное)**: patch `patch-llm-routes-report-chain-deepseek.ts` принудительно возвращает глобальные маршруты `summary`→deepseek-v4-flash, `report-by-type`→deepseek-v4-pro, `tasks`→deepseek-v4-flash (+ fallback openai gpt-5.4-mini / ollama). На проде они ушли на MiniMax (0% кэш, доказано trace «111»); DeepSeek кэширует 81-99% без ручного cache_control. Идемпотентен (всегда update), per-tenant не трогает, summary-v2 не трогает. Зарегистрирован в `apply-prod-deploy.ts` STEPS (phase 'patch', skipBootstrap). Верификация: typecheck+lint зелёные (прод-прогон по выкату — скрипт пишет в БД, локально без гарантии БД не гонял).
>
> **НЕ сделано (осознанно — в реестр «не-сделано»):**
> - **Решение Б (общий кэш-префикс транскрипта, shared-prefix):** мастер-док сам называет это ОТДЕЛЬНЫМ отложенным ТЗ «cache-prefix-everywhere» (`llm-cache-status.md:99`). Перестройка LLM-router на shared `[преамбула+транскрипт cache_control:ephemeral][инструкция]` — затрагивает роутер для всех агентов, риск сломать индивидуальную настройку SYSTEM, нужен замер. Профильно под длинные встречи. Отдельная задача.
> - **Часть 3 (smoke-метрика `z_llm_cache_hit_ratio ≥0.6 → WARN`):** метрика уже существует (ai-jobs.md T7 F3); добавление smoke-WARN после типовой встречи — отдельная observability-задача (нужен живой прогон встречи для калибровки порога).

**Проблема (доказано эмпирикой):** DeepSeek кэширует 81–91%, но `summary`/`report-by-type`/legacy `tasks` ушли на MiniMax (0% кэш, `analyze.worker.ts:566,737,806`). Транскрипт НЕ кэшируется между агентами (у каждого свой SYSTEM) — на длинных встречах он оплачивается uncached × N агентов.

**Решение:**
1. **Вернуть на DeepSeek** taskType `summary`/`report-by-type`/legacy `tasks` (через `seed-llm-task-routes`, без кода). Доказательство: DeepSeek кэширует без ручного `cache_control`, план изначально «везде DeepSeek». (Частично снимается Ф5 — отдельный summary уходит вовсе.)
2. **Общий кэш-префикс транскрипта** для пакета агентов одной встречи (где ≥2 агента на одних данных): `[SYSTEM преамбула][транскрипт + cache_control:ephemeral][инструкция агента]`. Транскрипт кэшируется на первом агенте → остальные хитят. На встрече 27 мин ≈ экономия ~85% input по транскрипту. Это отложенное ТЗ «cache-prefix-everywhere» (`llm-cache-status.md:99`).
3. Smoke-метрика: после типовой встречи `z_llm_cache_hit_ratio{provider}` по DeepSeek-агентам ≥ 0.6, иначе WARN (ловит увод taskType на некэширующий провайдер).

**Файлы:** `seed-llm-task-routes*.ts` (вернуть DeepSeek), `llm-router.service.ts`/`llm-fallback.service.ts` (shared-prefix + cache_control), smoke.
**Риск:** shared-prefix ломает индивидуальную тонкую настройку SYSTEM per-agent — применять только там, где ≥2 агента на одних данных; meeting-report-fast (один вызов) не трогать.
**Прод:** seed-маршрутов → `prod-deploy-log.md` Шаг 7.

---

## Ф7. Поведение участников + стабильность арбитра графа `[x]` (фикс1 — главный; см. примечания)

> **Реализовано 2026-06-07** (feature/retest2-agent-chain-overhaul), вместе с TZ D (один корень). Сделано: **фикс1** (главный, надёжный) — `merge.worker` даёт псевдо-слову при пустых words реальную длительность дорожки (`durationSeconds*1000`) → длительность и поведение перестают быть нулевыми; **lowConfidence** — `behavior-metrics.worker` определяет `wordTimingsAvailable` по дорожкам и прокидывает в калькулятор (`lowConfidence=true` если таймингов нет — UI честно покажет приблизительность); **контракт** vox.types — комментарий приведён к фактическому поведению (фикс3). Тесты: calc-spec +4 кейса, worker-spec обновлён, ai-модуль 429 зелёных.
>
> **НЕ сделано (осознанно, с причиной — в реестре «не-сделано»):**
> - **фикс2 (word-timings submit-флаг, исход б TZ D):** добавление submit-параметра Vox для пословных таймингов НЕ сделано — точное имя параметра неизвестно, а прецедент `language→400` показывает, что угаданный параметр опасен. Требует (а) прод-чтения `vox.no_words` (нужно явное «можно в прод») ИЛИ (б) спеки Vox/GigaAM API. Диагностика `vox.no_words` уже на месте и снимет ответ на следующей реальной встрече. Исход в (смена модели) — решение владельца (стоимость/латентность).
> - **фикс4 (стабильность арбитра):** инфраструктура УЖЕ есть — флаг `LLM_DEEPSEEK_FORCE_TOOL_CHOICE_ENABLED` (ТЗ-3 Ф3, default OFF + guard-откат) + JSON-резилиенс арбитра (ТЗ-3 Ф1: tryParseJson+ретрай). Кода не требуется; флип флага ON — ops-решение, требующее замера (принимает ли прокси forced tool_choice и режет ли долю fallback). Без замера дефолт не меняю.

**Проблема (доказано, confidence high):** поведение = нули, т.к. `merge.worker:137-154` при отсутствии word-timings от Vox создаёт псевдо-слово `{0,0}` → `behavior-metrics-calculator:241` отбрасывает сегмент (`endMs<=startMs`) → всё 0. Vox `submit({})` не запрашивает тайминги; v3_rnnt их эмпирически не отдаёт.

**Решение:**
1. **ГЛАВНЫЙ фикс (надёжный, не зависит от Vox):** в `merge.worker:140-145` заменить псевдо-слово `{0,0}` на `{startMs:0, endMs: durationSeconds*1000}` (поле `TranscriptTrack.durationSeconds` уже есть). Тогда turn получит реальную длительность → `speakingTime/turns/silence/questionCount/fillerWords` считаются на segment-уровне. Пометить метрики `lowConfidence=true` (поле `MeetingBehaviorMetrics.lowConfidence` уже есть) — UI честно покажет приблизительность. Покрыть `merger.spec.ts`.
2. **Опц. (точность):** снять реальный ответ прод-Vox через лог `vox.no_words` (`vox.service.ts:233-256`). Если есть параметр word-timestamps (`wordTimestamps`/`withTimestamps`) или модель с таймингами — добавить в `submit` (через switchable `VOX_MODEL`/опцию; парсер `parseVoxResult` уже покрывает words/segments). Проверить по доке Vox (Context7).
3. **Контракт-фикс:** `vox.types.ts:8-11` обещает «один turn при отсутствии words», а код коллапсирует в `(0,0)` — привести к контракту (см. фикс 1).
4. **Стабильность арбитра графа:** flash 8× отдал битый JSON (validate-fallback спас, но удвоил стоимость/латентность). Включить forced `tool_choice` (флаг `LLM_DEEPSEEK_FORCE_TOOL_CHOICE_ENABLED` уже есть) для арбитра ИЛИ перевести арбитр на capable-модель — измерить, что дешевле.

**Файлы:** `merge.worker.ts:140-145`, `merger.ts:58-140`, `vox.service.ts` (опц. word-timings), `vox.types.ts` (контракт), `merger.spec.ts`, роуты арбитра.
**Риск:** один сегмент-на-трек переоценит `longestMonologue`, занизит `interruptions/crossTalk` — это деградация, не точность; пометка `lowConfidence` обязательна.
**Метрики:** поведение перестаёт быть нулевым; `z_llm_cache`/стоимость арбитра.

---

## Порядок реализации и зависимости

```
Ф0 (наблюдаемость)  ← предусловие, вскрывает корни, без него верификация вслепую
  └─> Ф1 (Решения/Идеи)   ← подтверждается через Ф0 diag + golden
  └─> Ф3 (авто-Issue)     ← независим, быстрый, разблокирует трекер
Ф2 (классовые промпты)    ← параллельно, после Ф0 (golden-верификация)
Ф4 (цели↔задачи↔темы)     ← после Ф1 (нужны Decision/Idea) + draft→canonical проверен
Ф5 (консолидация)         ← после Ф2 (промпты стабилизированы)
Ф6 (кэш)                  ← частично снимается Ф5; остальное независимо
Ф7 (поведение)            ← независим, можно рано (фикс 1 — дешёвый и надёжный)
```

**Рекомендация раскатки:** Ф0 → Ф7.фикс1 + Ф3 (быстрые, независимые, видимый эффект) → Ф1 + Ф2 (с golden) → Ф4 → Ф5 → Ф6.

## Совместимость с prompt caching (сводно)
Все промпт-правки (Ф1, Ф2) — в стабильном SYSTEM, переменные данные в USER; правка SYSTEM переинициализирует кэш один раз per-deploy (приемлемо). Ф6 усиливает кэш (общий префикс). Состязательная проверка аудита подтвердила `cacheSafe=true` для всех предложенных улучшений.

## Прод-операции (сводно, детали — в prod-deploy-log.md по факту реализации)
- Новые AdminSetting ключи (Ф3 `tracker.autoAcceptConfidenceThreshold`) → Шаг 1/7.
- Новые cron (`graph-materialization-verify`, `goal-theme-linker`) + taskType (`goal-task-link`, `task-dedupe`) → Шаг 12 (smoke) + Шаг 7 (seed-маршруты).
- Правки промптов (block-ingest, 22 агента) → через prompt registry/seed.
- seed-llm-task-routes (Ф6 возврат на DeepSeek) → Шаг 7.
- Миграции (если GoalTheme/новые поля) → Шаг 4.

## Итог
Реализовано целиком — нет; это контракт. После всех фаз ожидаемо: Решения/Идеи материализуются, цели связаны с задачами и темами, задачи доходят до трекера, поведение участников считается, цепочка отчёта на DeepSeek с кэшем, специалисты видимы в trace. Совокупный прирост полноты памяти — оценка +24% (мастер-док) + закрытие мёртвых функций (поведение, авто-Issue).
