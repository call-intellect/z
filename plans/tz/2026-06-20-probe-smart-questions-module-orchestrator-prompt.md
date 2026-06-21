# Orchestrator-prompt: умный модуль уточняющих вопросов (probe)

Ты — главный оркестратор-разработчик. Реализуешь ТЗ `plans/tz/2026-06-20-probe-smart-questions-module.md` фаза за фазой силами суб-агентов, с независимой приёмкой. **Не доверяй отчётам агентов — верифицируй грепом/re-Read/прогоном.**

## Порядок чтения (на старте)
1. `CLAUDE.md` + `.claude/CLAUDE.md` (vexp first, без grep/glob при живом демоне; русский язык; Ship-On; без комментариев в коде).
2. ТЗ `plans/tz/2026-06-20-probe-smart-questions-module.md` — контракт. Анализ-доказательство `plans/analysis/2026-06-20-probe-smart-questions-module.md`.
3. Код-якоря (перечитать перед правкой — номера строк дрейфуют, ищи по символам):
   - `backend/src/modules/probe/probe-digest.cron.ts` (`deriveQuestion`, `buildProbeDigestSummary`)
   - `backend/src/modules/probe/probe-dispatcher.worker.ts` (`formulate`, `judgeQuality`, `humanizeProbeFallback`, `passesMarkerCheck`)
   - `backend/src/modules/probe/probe-reason-labels.ts` (`PROBE_REASON_LABEL`/`PROBE_REASON_FALLBACK`)
   - `backend/src/modules/knowledge-core/prompts/probe-formulate.prompt.ts`
   - `backend/src/modules/ai/services/llm-router.service.ts` (union `LlmTaskType` ~стр.144, `ALL_LLM_TASK_TYPES` ~стр.716)
   - `backend/scripts/seed-llm-task-routes-ideas-and-probe.ts`

## Инструменты
- `run_pipeline` (vexp) для картографии; Context7 не нужен (внешних либ нет — только OpenAI SDK уже в проекте).
- Бенч-доказательство: `bun --env-file=backend/.env run backend/scripts/eval/probe-module-bench.ts` — гонять после Ф3 и Ф4 как приёмку (100% назвал объект, гейт 0 ложных пропусков). Требует `DEEPSEEK_API_KEY` (есть в `backend/.env`).

## Граф фаз (строго)
- **Ф1** (стоп-кран дайджеста) — независима, делать первой, коммит отдельно (ценность сразу).
- **Ф2** (вынос `ProbeFormulationService`) — до Ф3/Ф4/Ф5.
- **Ф3** (промпт+чистый объект) и **Ф4** (гейт) — после Ф2, можно параллельно (разные файлы), но коммитить раздельно.
- **Ф5** (дайджест формулирует) — после Ф2+Ф4 (использует сервис с гейтом).
- **Ф6** (судья видит объект) — после Ф2, независима.

## Определение «фаза закрыта»
Все Acceptance фазы машинно подтверждены ТОБОЙ (не агентом): нужные грепы дают ожидаемое, `bunx vitest run src/modules/probe` (и `knowledge-core/prompts` для Ф3) зелёные, `bun run typecheck && lint && build` зелёные. Только тогда — коммит фазы (`feat(probe): ФN — …`).

## Факт-чек (агенты врут про [x] — `feedback_agents_can_lie_about_edits`)
После каждого агента: `git status`, re-Read изменённых файлов, грепни ключевые маркеры:
- Ф1: `humanize` в цепочке `deriveQuestion`; гард-тест паритета существует и падает на дыре.
- Ф2: `private async formulate` в диспетчере отсутствует; сервис экспортирует `gate/formulate/judgeQuality`.
- Ф3: `PROBE_FORMULATE_SYSTEM_PROMPT` содержит «НАЗОВИ ОБЪЕКТ»; `contextCardTitle: args.message.slice` остался только у 3-2/3-5.
- Ф4: `'probe-value-gate'` ровно 2× в `llm-router.service.ts`; seed-объект добавлен; флаг в `feature-flags.md`.
- Ф5: дайджест зовёт `ProbeFormulationService`; есть фолбэк на Ф1 при LLM-ошибке.

## Failure-modes
- Не вводи новый `ProbeStatus` — переиспользуй `dropped_low_value` (миграции в этом ТЗ нет).
- Не ставь LLM-вызов в `ProbeService.suggest` (hot-path; Р2).
- Не ломай кэш: SYSTEM-промпты стабильны, переменные — в конце USER.
- Флаги — ДЕФОЛТ ON (Ship-On); не выкатывай OFF «понаблюдать».
- После push: обнови `second-brain/03_processes/probe-question-flow.md` + `01_projects/probe-agent.md` + `feature-flags.md` + рефлексия + prod-deploy-log (seed taskType, 2 флага).

Реализацию начинать по явному «начни реализацию» от владельца.
