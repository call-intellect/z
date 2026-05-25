---
date: 2026-05-25
type: reflection
distilled: false
covers: оркестрация 4-волновой реализации meeting-report-fast + hard participant identification + admin compare UI
related-commits: d1790cb, 137baa8, bf2547e, 4ee73b4
---

# Оркестрация: meeting-report-fast + жёсткая идентификация участников + compare UI

## Что было поставлено

Две связные задачи из ТЗ:

1. [`plans/tz/2026-05-25-meeting-report-split-from-block-ingest.md`](../../plans/tz/2026-05-25-meeting-report-split-from-block-ingest.md) — разделить «отчёт пользователю» и «память компании» на два независимых pipeline после эксперимента `sales-merge-experiment` (Б в 3.5× быстрее и в 4.6× дешевле).
2. [`plans/tz/2026-05-25-hard-participant-identification.md`](../../plans/tz/2026-05-25-hard-participant-identification.md) — провести `User.id` через всю AI-цепочку (LiveKit identity → AI prompt → LLM output → Task.assigneeUserId), убрать matching by name. ТЗ написан в этой же сессии после исследования.

Бюджет: 4 коммита, ~4-5 часов работы агентов в фоне.

## Как решал

### Оркестрация — 4 волны без остановок между ними

| Волна | Что | Коммит |
|---|---|---|
| 1 | Имплементер #1: meeting-report-fast Фазы 1-3 + 4.6 (промпт, воркер, Prisma поля, LlmRouter route, расширение LlmRouter для tools) | вошло в `d1790cb` |
| 1 | Параллельно — исследователь по идентификации участников | inform для ТЗ #2 |
| 2 | Имплементер #2 (meeting-report-fast Фаза 4): producer в merge.worker + ENV kill-switch | вошло в `d1790cb` |
| 2 | Параллельно — имплементер #3: вся задача участников (7 фаз) | вошло в `d1790cb` |
| 3 | Имплементер #4: gap fix TASKS_STRUCTURED_JSON_SCHEMA → buildTasksStructuredJsonSchema(participants?) | `137baa8` |
| 4 | Сам в основном потоке — Phase 7 second-brain docs (4 файла) + исследователь admin UI в фоне | `bf2547e` |
| 5 | Имплементер #5: Фаза 5 admin compare UI (backend + frontend, react-markdown) | `4ee73b4` |

Между волнами — только факт-чек через grep + git status, без остановки на ожидание подтверждения. Push'и — с явным подтверждением пользователя (правило репо).

### Чему научился

1. **Параллельные сессии в репо реальны и опасны.** Hook `post-push-reflection.py` и другие сессии могут сделать `git pull`, поглотить мои изменения в общих файлах (schema.prisma, business-metrics.service.ts, env.schema.ts, typed-config.service.ts, core-queue.service.ts) и закоммитить их вместе со своими. После факта обнаружил, что мои поля Prisma (summaryFast*, reportFastStatus*) уже в HEAD как часть `800fdbd feat(events,concierge): Calendar MVP` и `acd9a14 feat(clones): Фаза 1`. История размазана по чужим коммитам — откатывать нельзя (повредит чужую работу). Принял как факт, в commit-message честно отметил.

2. **Факт-чек после каждого агента обязателен.** Из 5 имплементеров двое отчитались о работе, которая частично не сохранилась (параллельная сессия откатила правки) — но при этом перепрокачали. Без grep'а ключевых символов после агента невозможно понять, действительно ли он сделал что заявил. Применял `feedback_agents_can_lie_about_edits` каждый раз — спасало.

3. **CRLF warnings в `git add` на Windows — норма, не блокер.** Видел их в каждом stage'инге, на пайплайн не влияет.

4. **Промпт каждому агенту должен явно перечислять baseline untracked-файлы** — иначе агент может случайно тронуть «чужие» untracked (.claude/skills/dzen-content-research/, backend/scripts/eval/, etc.) и притащить их в свой PR. У меня сработало благодаря явному перечислению в каждом промпте.

5. **Один большой коммит лучше двух раздельных, если файлы пересекаются.** `schema.prisma` и `business-metrics.service.ts` были общими для двух задач. Разделять через stash/cherry-pick рискованно (см. п.1). Сделал один `feat(ai): meeting-report-fast + жёсткая идентификация участников` — связные изменения в одной AI-pipeline-улучшалке, commit message честно описывает обе задачи.

6. **Gap'ы агенты подмечают честно, если попросить.** Имплементер #3 сам отметил, что `TASKS_STRUCTURED_JSON_SCHEMA` — const на module-load, и strict-провайдеры не получат `assigneeUserId`. Я не просил его это исправить (это было вне его волны), но он зафиксировал в коде комментарием и в second-brain. Следующая волна (#4) закрыла gap через `buildTasksStructuredJsonSchema(participants?)`.

7. **Phase 7 (docs) проще делать самому, чем агентом.** 4 файла edit + 1 create + index.md — заняло ~10 минут моего времени. Агенту я бы тратил столько же на промпт + время на запуск + факт-чек. Только агенту имеет смысл делегировать когда задача >30 минут или требует много контекста.

8. **Архитектурный шов admin-навигации.** AdminMeetingsTable ссылается на `/admin/meetings/[id]`, новая compare-страница лежит в `/admin/media/meetings/[id]/compare`. Next.js работает по абсолютным URL, но переходов между разделами админки сейчас нет. Отдельная фаза «выровнять admin routes» — но не сейчас.

## Что вышло

- **`d1790cb` feat(ai)** — 32 файла, +3575/-10. meeting-report-fast pipeline + hard participant identification + 1644 unit-теста зелёные.
- **`137baa8` fix(ai)** — 5 файлов, +346/-22. Закрыт gap TASKS_STRUCTURED_JSON_SCHEMA. 54 теста зелёные.
- **`bf2547e` docs(second-brain)** — 5 файлов, +152. Карта pipeline + правки реестров.
- **`4ee73b4` feat(admin)** — 5 файлов, +619/-6. Compare UI v2 vs fast. typecheck + lint green.

### Открытые вопросы / vNext

- **Фаза 6 (свёртка v2)** — заблокирована продуктовой обратной связью. После того, как продакт поработает с compare-UI на dev-трафике 1-2 недели и подтвердит «fast не хуже v2», помечаем v2-агенты `@deprecated`, переключаем UI с `summaryV2` на `summaryFast`, через 2 недели удаляем.
- **AdminMeetingsTable путь** — выровнять с `/admin/media/meetings/[id]` (сейчас старый `/admin/meetings/[id]`).
- **quality_score в БД** — воркер `meeting-report-fast` пока только логирует. Когда продакт скажет, что это нужно в UI — добавим запись в `MeetingQualityScore` или JSON в `AiResult`, плюс collapsed-блок в compare-UI.
- **Тесты на dev-встречах** — pipeline пока не запускался на реальном dev-трафике. Когда `MEETING_REPORT_FAST_ENABLED=true` и проедет первая встреча — проверить `Meeting.reportFastStatus='ready'`, `AiResult.summaryFast` непустой, метрики `z_meeting_report_fast_total` инкрементились.

## Prod-операции, которые нужно сделать вручную

1. **На prod backend выполнить миграцию схемы:**
   ```
   bun run prisma:push
   bun run prisma:generate
   ```
   Добавятся поля: `AiResult.summaryFast`/`summaryFastModel`/`summaryFastGeneratedAt`; `Meeting.reportFastStatus`/`reportFastError`/`reportFastGeneratedAt`; `Task.assignee` relation; `User.assignedTasks` обратная.

2. **На prod ENV добавить (опционально):**
   ```
   MEETING_REPORT_FAST_ENABLED=false   # на первое время — выключено
   ```
   На dev оставить `true` (или не задавать — default true).

3. **На prod запустить seed для регистрации LLM-маршрута:**
   ```
   bun run backend/scripts/seed-llm-task-routes-knowledge-core.ts
   ```
   Добавит `LlmTaskRoute('meeting-report-fast')`: `deepseek/deepseek-v4-pro` → `openai-via-proxy/gpt-5.4-mini` → `ollama/qwen3.5:9b`.

4. **Проверить, что producer не падает:** в логах backend искать `merge: meeting-report-fast — job поставлен в core.meeting-report-fast` (при `MEETING_REPORT_FAST_ENABLED=true`).

5. **Метрики в Grafana** — добавить виджеты:
   - `z_meeting_report_fast_total{status="ready"}` / `rate(... 5m)`
   - `z_meeting_report_fast_duration_seconds{quantile="0.95"}`
   - `z_task_assignee_ambiguous_total{reason}` — особенно `llm_hallucination`

## Ссылки

- ТЗ #1: [meeting-report-split-from-block-ingest](../../plans/tz/2026-05-25-meeting-report-split-from-block-ingest.md)
- ТЗ #2: [hard-participant-identification](../../plans/tz/2026-05-25-hard-participant-identification.md)
- Карта pipeline: [`01_projects/meeting-report-pipeline.md`](../01_projects/meeting-report-pipeline.md)
- Карта идентификации: [`01_projects/participant-identification.md`](../01_projects/participant-identification.md)
- Эксперимент: [`backend/test/eval/sales-merge-experiment/reports/SUMMARY-ALL.md`](../../backend/test/eval/sales-merge-experiment/reports/SUMMARY-ALL.md)
