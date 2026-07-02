---
date: 2026-06-30
type: reflection
feature: task-extraction-pipeline-unification
branch: work/2026-06-29
distilled: false
---

# Рефлексия — единый движок задач, заход B (combo эмитит tasks[] + снос старых движков, оркестрация)

## Что было поставлено

Заход B = «задачная сторона» переписывания извлекающего слоя. Цель: тот же общий разборщик `specialists-combined` (combo), что достаёт граф из разговора, тем же проходом достаёт задачи/обещания и отдаёт их в трекер — для **всех каналов** (встречи И чат). До этого задачи тащил отдельный путь (из встреч — `MeetingExtractActionsService`, из чата — почти никак: обещание уходило в Цели и терялось), плюс слабый per-block спайн `specialist-3-15-tasks`.

Порядок (из брифа): **Шаг 1** трекер-машинерия (ТЗ задач Ф1/Ф2/Ф4, вариант А) → **Шаг 2** combo эмитит `tasks[]` (rewrite Ф7) → **Шаг 3** снос старых движков (rewrite Ф11в/г). Ф5/Ф6 ТЗ задач (отдельный движок + суточный крон) — ОТМЕНЕНЫ вариантом А.

## Как решал (фазы, файлы, коммиты)

Вёл оркестратором: своя картография по живому коду (line-номера ТЗ устаревают), затем суб-агенты-кодеры по фазам, своя приёмка (typecheck/lint/build/тесты — сам, не по отчёту агента), коммит по фазам.

- **Ф1+Ф2** (`6816cacd`): `subtasks[]` в канон `TaskItemSchema` (`common.ts`); миграция `20260630030000_add_intake_issue_checklist_json` (`IntakeIssue.checklistJson Json?`); util `intake-checklist-materialize.util.ts` + вызов в ДВУХ accept-точках (`intake-auto-triage.worker`, `intake.service`) — чек-лист рождается при приёме.
- **Ф4** (`fe400eaa`): новый `TaskDraftMaterializerService` (tracker, provider+export) — канало-агностичный материализатор drafts→IntakeIssue: idempotency `mat_<sha1(channel:sourceId:quote|title)>`, резолв исполнителя (org-wide→skill-routing), дедуп-suggest через `TaskDedupService.evaluate`, `subtasks`→`checklistJson`, enqueue auto-triage; метрика `task_draft_materialized_total{channel,status}`. **meeting-extract НЕ рефакторил** (вариант А: его не переводят на материализатор, а сносят — combo заменяет).
- **Ф7** (`6d1c82d5`): combo эмитит `tasks[]` — `TaskDraftCombinedSchema` (канон-поля + `sourceBlockId`, lenient `optional+default([])`); tool `submit_all_8_entities`→`submit_all_entities` (9 выходов); промпт: маршрут tasks[], правило «обещание=задача» (само-назначение), `SUBTASKS_BLOCK`, **правило ГРУППИРОВКИ** (соседние поручения одного автора = шаги одного дела → одна задача + subtasks, не N карточек — это собирает обратно то, что нарезчик разрезал по окнам); `persistTasks` → материализатор (@Optional инжект, knowledge-core→tracker без цикла). Снапшот combo-промпта обновлён осознанно.
- **Ф11в** (`a7434d72`): снос ИЗВЛЕКАЮЩЕГО спайна — роут `action_item→TASKS` + `TASKS` из `RouterService.SPECIALIST`/`PRIORITY` (иначе LLM-fallback достал бы спайн через whitelist `Object.values(SPECIALIST)`); регистрация воркера в диспетчере + провайдер в `ai/workers.module`; удалён `Specialist315TasksWorker`+spec + spine-only integration-тест. **Сервис `Specialist315TasksService` СОХРАНЁН** (держит живую `runClarifySweep`).
- **Ф11г** (`fa55ddf2`): вывод `MeetingExtractActionsService` (сервис+spec+caller в `analyze.worker`+DI в tracker.module+retired-метрика `ai_meeting_actions_extracted_total`). **`prompts/tasks.ts` СОХРАНЁН** (живой через `code-fallback.adapter`; тип `MeetingExtractActionsContext` держит org-context).
- **Шаг 4**: интеграционный тест нового пути (combo→materializer, stateful-идемпотентность/чек-лист/канало-агностичность + wiring) взамен удалённого spine-chain; prod-deploy-log (миграция + гейт сноса), feature-flags, 04-не-сделано, второй мозг, рефлексия.

## Что вышло (верификация)

- `bun run build` (DI/декораторы) — exit 0; полный `tsc --noEmit` (вкл. .spec) — 0 ошибок на каждой фазе.
- Широкий регресс-прогон tracker+knowledge-core+ai — **66 файлов / 759 тестов passed**; интеграционный combo-tasks — 33 теста passed; lint 0 везде.
- Снос проверен грепом: 0 ссылок на `Specialist315TasksWorker`, `SPECIALIST.TASKS`, `MeetingExtractActionsService`, retired-метрику; спайн-сервис+clarify-cron целы; `prompts/tasks`/llm-router taskType целы.

## Чему научился

- **Снос почти никогда не «чистое удаление».** Спайн-сервис `3-15` держал ВТОРУЮ роль (`runClarifySweep` через clarify-cron) — удалить целиком нельзя, только воркер+роут (сервис жив). `MeetingExtractActionsService` тянул `prompts/tasks.ts`, но тот ЖИВ через `code-fallback.adapter` + тип для org-context. Перед сносом — карта импортёров каждого осиротевшего экспорта; «minimal-safe» (снести сервис, оставить общий prompt-файл) бьёт «снести всё подряд».
- **Whitelist fallback'а — скрытый путь к удалённому коду.** `RouterService.fallbackToLlm` строит whitelist как `Object.values(SPECIALIST)`. Снять только `case 'action_item'` мало — `action_item` уехал бы в default→LLM-fallback и мог выбрать удалённый спайн. Убирать таргет из самой константы `SPECIALIST` (+ `PRIORITY`).
- **Lenient combo-схема против парс-фейлов.** Combo'шный парс-фейл — известная боль #1 (strict-схемы роняют валидный ответ при пропуске поля). Новый `tasks[]` сделал `optional+default([])` + поля `nullable().optional()` — модель инструктируется в tool/промпте, но пропуск не роняет весь разбор.
- **build-then-delete: снос — отдельный deploy-этап, гейтован прод-проверкой.** Combo-tasks и снос сосуществуют (дубли гасит `TaskDedupService` suggest). Сносовые коммиты ВЫКАТЫВАТЬ после разовой проверки глазами, что combo даёт задачи (point 5/ВР8) — иначе после сноса фолбэка задач нет. Зафиксировано гейтом в prod-deploy-log + строкой в 04-не-сделано.
- **DI-развязка knowledge-core→tracker.** `KnowledgeCoreModule` @Global И импортирует `TrackerModule` (одно направление) → материализатор в tracker (export) спокойно инжектится в combo, без цикла. Проверять граф модулей, не угадывать.

## Что НЕ сделано / гейт (честно)

- **Выкат сносовых коммитов `a7434d72`/`fa55ddf2` — gated**: только после разовой прод-проверки, что combo создаёт задачи (встреча+чат → IntakeIssue). A/B владельцу недоступно (ВР8); страховка = рубильник combo + метрики + проверка глазами. Откат сноса — `git revert`; откат combo — рубильник.
- **Residual: недостижимый `processBlock`** в спайн-сервисе `3-15` (воркер снесён, сервис жив ради clarify-sweep) — follow-up trim (04-не-сделано).
- **Probe «кому поручить?» при неразрешённом исполнителе** в материализаторе осознанно опущен (у combo нет turn-level автора, который был у meeting-extract); покрытие — нота при accept + clarify-sweep. Если на проде окажется нужным — отдельным ТЗ.
