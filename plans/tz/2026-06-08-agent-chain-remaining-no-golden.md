# ТЗ — Доделать остаток цепочки агентов (БЕЗ golden, выкат + наблюдение прода)

> **Контекст:** батч `feature/retest2-agent-chain-overhaul` (2026-06-07/08, 13 коммитов) закрыл основное по 4 ТЗ + зонтичному `2026-06-07-agent-chain-overhaul.md`. Часть пунктов была отложена «до golden-прогона». **Решение владельца (2026-06-08): golden НЕ делаем.** Реализуем остаток, выкатываем и **смотрим прод напрямую**. Это ТЗ — список «что недоделано → что доделать».
>
> **Источники истины по остатку:** `second-brain/04_не-сделано/README.md` (раздел «Открыто», строки 2026-06-08) + соответствующие фазы `plans/tz/2026-06-07-agent-chain-overhaul.md`.

## Принципы (обязательны)
1. **БЕЗ golden.** НЕ запускать `agent-quality-harness.ts`, НЕ ждать «живого LLM-стенда», НЕ откладывать «до eval». Реализуем → выкат → наблюдаем прод. ([[feedback_no_golden_ship_and_observe_prod]])
2. **Unit-тесты не обязательны** для промпт/агентных правок (на усмотрение). Жёстко только: **`bun run typecheck` + `bun run build` зелёные** (иначе не задеплоится).
3. **Рискованное/недетерминированное — за feature-flag, дефолт безопасный** (откат без редеплоя). Крутилки — в AdminSetting, не ENV/код ([[feedback_admin_settings_not_env_or_code]]).
4. **Cache-friendly промпты** (стабильный SYSTEM, переменные в конце USER) — [[feedback_llm_prompts_cache_friendly]].
5. **Наблюдаемость вместо тестов:** после выката смотреть `diag graph --meeting <id>`, `diag chain --trace mtg_<id>`, метрики `kc_materialization_gap_total` / `goal_theme_autolink_total` / `core_extraction_entity_total{type}` / `core_specialist_skipped_total`. Это и есть приёмка.
6. Версионируемые миграции Prisma, если трогается БД (skill `prisma-db-push-rules`).

---

## 1. Ф2 — классовые фиксы промптов C2–C8 + 6 готовых промптов
**Недоделано:** в батче применён только C1 (ASR-нота на 10 промптах, `c9339992`). Остальные классы — нет.
**Доделать (по `plans/analysis/2026-06-07-agent-chain-best-solutions.md §3,§5`):**
- **C2** — `EDGE_CASE_POLICY` (`src/modules/ai/services/prompts/common.ts`) ссылается на `meetingDateIso`, которого USER не передаёт (мёртвая ветка). Либо передавать `meetingDateIso` в USER-шаблон extract-промптов (decision/idea/regulation/process/skill/goal-extract), либо убрать мёртвое правило. Рекомендация: передавать (оживляет ISO-нормализацию сроков).
- **C3** — булев гейт: добавить `isDecision`/`isIdea`/`hasSignal` в схемы decision/idea/regulation/insight-extract + разрешить пустой результат (анти-плодёж).
- **C4** — few-shot (1–3 статичных примера в SYSTEM, cache-safe) у ~16 промптов без него.
- **C5** — единая калибровка confidence: применить `withConfidenceCalibration` к meeting-report-fast/summary/tasks/chapters/theme/entity-merge/block-distill, где её нет.
- **C6** — анти-галлюцинация участников: правило «имя ТОЛЬКО из переданного списка участников, иначе null» + передавать список в USER (meeting-report-fast, tasks, block-ingest, specialists-combined).
- **C7** — синхронизировать injection-guard: обернуть USER в `wrapUserData(...)` там, где SYSTEM содержит маркеры (`table-extract-rows`, decision/idea/regulation/process/goal).
- **C8** — привести SYSTEM к коду: `entity-merge-arbiter` («5 кандидатов» vs реально 1 пара); `specialists-combined` (`tool_choice='required'` не поддержан thinking-моделью).
- **6 готовых промптов** — переписать улучшённые версии для `meeting-report-fast`, `chapters-v2`, `block-ingest`, `axis-classify`, `knowledge-clone-extract`, `goal-hierarchy-link` по принципам §3 (полных verbatim-текстов в мастер-доке нет — писать по принципам: ASR-нота + few-shot + калибровка + анти-галлюцинация id/имён + анти-плодёж).
**Файлы:** `src/modules/knowledge-core/prompts/*.prompt.ts`, `src/modules/ai/services/prompts/*`.
**Наблюдение прода:** `core_extraction_entity_total{type}` не должен падать; `diag graph` — распределение signalType стабильно/лучше.

## 2. Ф1 — idea direct-path
**Недоделано:** recall маркеры decision/idea добавлены (`0c066468`), но прямого пути материализации Idea нет.
**Доделать:** в `src/modules/knowledge-core/workers/block-ingest.worker.ts` добавить ветку для блоков `signalType='idea'` → создать `Idea` (через `prisma.idea.create`, как Specialist 3.6), **идемпотентно по `sourceBlockId`** (skip, если Idea с этим sourceBlockId уже есть). Согласовать с дедупом Specialist 3.6 (чтобы не плодить дубли — добавить в 3.6 проверку existing по sourceBlockId перед KNN-create).
**Наблюдение:** `diag graph --meeting` — Идеи материализуются; нет дублей Idea на одну встречу.

## 3. Ф4.1 — goal↔task↔decision linking (новый LLM-арбитр)
**Недоделано:** Ф4.2 (goal-theme-linker) сделан (`5f55ee35`); связь Goal↔Task/Decision — нет.
**Доделать:** новый taskType `goal-task-link` + arbiter-сервис + промпт (образец `goal-hierarchy-link.prompt.ts` + `block-link.service.ts`: retry×2, validate-callback, `tryParseJson`+Zod, fallback-метрика). Запуск **on-event** на уровне встречи, когда и Goal, и Issue/Task созданы из одного RawEvent (НЕ пер-блок). Stable SYSTEM + few-shot, переменные (список целей+задач встречи) в конце USER, JSON Schema, `{links:[]}` если связи нет. Писать `parentGoalId` на Issue ЛИБО `IdeaBlockLink(develops)`. Маршрут в `seed-llm-task-routes` (deepseek-v4-flash). За feature-flag.
**Наблюдение:** метрика `goal_task_link_total`; в дашборде CEO дерево цель→задачи навигируемо.

## 4. Ф5 Р2 — один canonical-путь задач + семантический дедуп
**Недоделано:** summary-консолидация сделана (`ac3fa181`); пути задач и семантический дедуп — нет (строковый `normTaskTitle` усилён ещё ТЗ-4).
**Доделать:** canonical-источник задач = `structured` (даёт исполнителей), `fast` — только мгновенный черновик. Семантический дедуп: embedding (`text-embedding-3-small`) + KNN cosine ~0.85, серая зона → лёгкий LLM-арбитр `task-dedupe` (новый taskType + сервис). Применять к ОБЪЕДИНЁННОМУ набору задач встречи, не пер-источник. За feature-flag.
**Наблюдение:** на витрине встречи нет дублей задач; счётчик задач совпадает между fast/structured.

## 5. TZ D — word-timings Vox (исход б/в)
**Недоделано:** надёжный fallback длительности/поведения сделан (`c8cf2602`); реальные пословные тайминги от Vox — нет.
**Доделать:**
1. Прочитать форму ответа Vox: `diag chain --trace mtg_<свежая_встреча> --json` → найти запись `vox.no_words` → поля `rawKeys`/`nestedKeys`/`firstSegmentKeys` (диагностика уже в `vox.service.ts:233-256`). _(Это прод-чтение — владелец запускает diag или даёт «можно в прод».)_
2. По результату:
   - **(а)** тайминги под другим ключом → расширить парсер `parseVoxResult` в `vox.service.ts` (дёшево).
   - **(б)** Vox умеет по submit-флагу → добавить параметр в `submit()` form (`vox.service.ts:85-93`) **за switchable ENV** (`VOX_REQUEST_WORD_TIMESTAMPS`, default OFF). Осторожно: прецедент `language→400` — сначала проверить имя параметра.
   - **(в)** `v3_rnnt` не отдаёт в принципе → сменить модель/режим (`VOX_MODEL`) или forced-alignment шаг — оценить стоимость/латентность.
**Наблюдение:** `transcript.totalDurationSeconds` реальный; «Поведение участников» с долями говорения; `vox.no_words` не пишется на встречах с речью.

## 6. Ф6 — Решение Б (shared-prefix транскрипта) + smoke cache-WARN
**Недоделано:** Решение А (маршруты → DeepSeek) сделано (`c381e7c8`).
**Доделать:**
- **Решение Б** (профильно под длинные встречи): общий кэш-префикс транскрипта для пакета агентов одной встречи: `[SYSTEM преамбула][транскрипт + cache_control:'ephemeral'][инструкция агента]`. Транскрипт кэшируется на первом агенте → остальные хитят. Применять только где ≥2 агента на одних данных; `meeting-report-fast` (один вызов) не трогать. Файлы: `llm-router.service.ts` / `llm-fallback.service.ts`. За feature-flag (router-wide изменение).
- **Часть 3** — smoke-метрика: после типовой встречи `z_llm_cache_hit_ratio{provider}` по DeepSeek-агентам ≥ 0.6, иначе WARN (ловит увод taskType на некэширующий провайдер). Метрика уже есть — добавить smoke-проверку.
**Наблюдение:** `z_llm_cache_hit_ratio` по DeepSeek ≥ 0.6; на длинной встрече input-токены транскрипта падают.

## 7. TZ B Фаза 4 — хвост наблюдаемости/тех-долга
**Недоделано:** smoke/алертинг (Ф1–3) починены (`3a2d0ce4`); хвост Фазы 4 — нет.
**Доделать:**
- **ollama-401** — прод-конфиг: прописать валидный `OLLAMA_API_KEY`/URL ЛИБО деактивировать ollama-провайдера в админке (это НЕ код; владелец/ops). Код-фильтр без baseUrl уже есть.
- **Express 5 route** — найти регистрацию `/api/v1/*` (глобальный fallback/404 или статика) и привести к синтаксису Express 5 (`/*splat`), иначе сломается на след. мажоре.
- **JSON-резилиенс** — применить паттерн `tryParseJson`+ретрай (как ТЗ-3) к `MeetingSpeakerAnalyzerWorker` и `IntakeAutoTriageWorker` (у них свой parse без устойчивого разбора).
- **forced tool_choice** — флаг `LLM_DEEPSEEK_FORCE_TOOL_CHOICE_ENABLED` уже есть (default OFF). Включить и **посмотреть прод**: режет ли долю fallback'ов арбитра графа (flash 8× битый JSON). Если прокси принимает и доля падает — оставить ON.
**Наблюдение:** в логах нет ollama-401/Express5-WARN/`невалидный JSON` от speaker/intake; доля `LlmRouter dispatch fallback` падает.

---

## Порядок (рекомендация, всё независимо)
Быстрые/безопасные вперёд: **7 (хвост B)** → **2 (idea direct-path)** → **1 (Ф2 C2–C8 промпты)** → **4 (task dedup)** → **3 (goal-task-link)** → **6 (shared-prefix)** → **5 (Vox word-timings, нужен прод-read)**.

## Итог (заполнять при реализации)
- [x] 1. Ф2 C2–C8 + 6 промптов (`0c283e60`+`6dd216f5`+`0dfe170f`): C1 ASR расширен на 8 промптов; C5 калибровка где есть числовой confidence; C6 анти-галлюцинация имён (meeting-report-fast+block-ingest); C2 meetingDateIso (meeting-report-fast); C3 булев гейт isDecision/isIdea (decision+idea, у обоих есть fallback); C8 entity-merge «5→1»; C7 уже на месте. **Частично:** C4 few-shot только process-template (широкий 16-промптовый — не делал, нужен eval); C2 для пер-блочных специалистов не протянут (нет дешёвой даты); C3 для regulation/insight не делал (нет fallback → recall-риск) — см. отчёт
- [x] 2. Ф1 idea direct-path (`7430162e` — direct-path за kill-switch knowledge.ideaDirectPathEnabled + guard Specialist 3.6 по sourceBlockId)
- [x] 3. Ф4.1 goal-task-link (`e174baaa` — LLM-арбитр goal-task-link: goal→meeting→ungoaled Issues, проставляет Issue.goalId non-destructive; on-event + cron; флаг goals.goalTaskLinkEnabled default OFF)
- [x] 4. Ф5 Р2 семантический дедуп задач (`a933138e` — MeetingTaskDedupeService: embedding KNN + LLM-арбитр task-dedupe серой зоны, non-lossy удаление fast-черновиков, флаг meetings.taskDedupeEnabled default OFF)
- [x] 5. TZ D word-timings Vox (`accdfe7b` — прод-чтение vox.no_words показало ключ `extendedResult` у v3_e2e_rnnt; парсер расширен на extendedResult (исход а, безопасно); диагностика +extendedResultKeys/taskParamsKeys для решения б/в на след. встрече без угадывания submit-параметра)
- [x] 6. Ф6 smoke cache-WARN (`f28200cb` — z_llm_calls_total знаменатель + getLlmCacheHitRatio + checkCacheHitRatio cron, флаги llm.cacheSmokeEnabled/cacheHitRatioWarnThreshold). **Part a (shared-prefix Решение Б) — осознанно отложен**: router-wide реструктуризация (роль SYSTEM→хвост USER), нужен прод-замер прокси cache_control + риск регрессии per-agent SYSTEM; зонтичное ТЗ вынесло в отдельное «cache-prefix-everywhere». Smoke-метрика — инструмент будущего замера. → реестр не-сделано
- [x] 7. TZ B Фаза 4 хвост (код: Express5 named-wildcard + JSON-резилиенс triage/speaker — `c457403d`; ollama-401 + forced tool_choice = прод-конфиг/наблюдение, владелец)
