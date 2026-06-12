---
title: МАСТЕР-ТЗ — Полная переделка AI-промптов Z + орг-документы + пост-встречные агенты + фронтенды
date: 2026-06-10
status: ready-to-implement (единый документ; объединяет все предыдущие ТЗ и анализы)
type: tz-master
supersedes_as_umbrella:
  - plans/tz/2026-06-09-prompt-fleet-strengthening.md          # предв. ТЗ по фазам Ф0–Ф10 (вобран целиком)
  - plans/tz/2026-06-10-post-meeting-and-org-docs.md           # пост-встречные доноры (вобран)
appendix_detail:
  - plans/analysis/2026-06-09-prompt-rewrites/                 # БЫЛО→СТАЛО всех ~126 промптов (детальное приложение)
  - plans/analysis/2026-06-09-prompt-rewrites/22-org-entities-COMPARE-and-compiler.md  # орг-экстрактор + компилятор
  - plans/analysis/2026-06-09-prompt-fleet-audit.md            # аудит 145 (анализ-обоснование)
---

# МАСТЕР-ТЗ — переделка всех AI-промптов Z + орг-документы + пост-встречные + фронтенды

> **Что это.** ЕДИНЫЙ контракт на реализацию всей работы по AI-промптам Z: инфраструктура, переделка
> всех ~126 промптов, консолидация/ретайр, орг-документы + компилятор, пост-встречные отчёты/протоколы/
> граф, **и все затронутые фронтенды**. Пер-промптовые тексты «БЫЛО→СТАЛО» — в приложении
> [prompt-rewrites/](../analysis/2026-06-09-prompt-rewrites/) (22 файла, ~14 000 строк); здесь — мастер-план:
> фазы, контракты, схемы, фронт, миграции, приёмка.

## 0. Состав (что объединено в этот документ)

| Источник | Что давал | Где в этом ТЗ |
|---|---|---|
| Предв. ТЗ `prompt-fleet-strengthening` | Ф0–Ф10 (инфра + фазы + Р1–Р5) | **Часть A**, §A0–A10 |
| Аудит 145 промптов | 12 системных пробелов, Прил. А/Б | обоснование; находки → рерайты |
| Рерайты `prompt-rewrites/` (22 файла) | БЫЛО→СТАЛО ~126 промптов + INDEX §4 (контракт-изменения) + call-site | **Приложение-деталь**, lift в §A2/A4/A6 |
| Анализ 22 (орг-сущности) | экстрактор-добавки + компилятор | **§A7/A10/A12** |
| Пост-встречные доноры (2026-06-10) | отчёт/протокол/граф (D1–D10) | **§A11** |
| **Карта фронтендов (2026-06-10)** | поверхности UI под новые контракты | **Часть B** (НОВОЕ) |

### Принципы (применяются ко всему)
1. **Гард конструкцией, не инструкцией** (инъекции/аудитория/статус — кодом/структурой вызова).
2. **Класс, а не кейс** — общий helper + машинный гард вместо правки N промптов; CI ловит регресс.
3. **Ship-On** — выкатываем включённым; рискованное за kill-switch (ON), не «дефолт OFF».
4. **Без golden-гейта** — приёмка = `typecheck`+`build`+снапшоты; затем выкат и наблюдение прода.
5. **Cache-friendly** — стабильный блок в КОНЕЦ system; переменные данные в user.
6. **Снапшоты** — правка промпта = обновить `*.snapshot.spec.ts` в том же коммите.
7. **E1/E2 — обёрткой на call-site**, не текстом SYSTEM (правило рерайтов).

## 1. Решения владельца (зафиксированы)

| Р | Решение | Влияние |
|---|---|---|
| Р1 | v2-стек (tasks-v2/summary-v2/chapters-v2) — **удалить целиком** (промпты+сервисы+воркеры+admin-поля) | §A6 + §B4 |
| Р2 | «Инструкция» — **first-class** (новая таблица + извлечение + API + RBAC + фронт + backfill) | §A10 + §B2 |
| Р3 | HR/оценки людей — матрицу не менять; **разблокировать выдачу ролей** hr_partner/coo | §A5 |
| Р4 | `process-steps-extract` — **удалить** (сирота) | §A6 |
| Р5 | `runTasks`/`AiResult.tasks` — **убрать** (мёртвое поле) | §A6 |
| **Р-A** | «N документов» донора — **НЕ сливать в один агент** (раздельно: отчёт + протокол + граф) | §A11 |
| **Р-B** | extraction-status орг-сущностей — **3 значения** `существует/нужен/обсуждается` (не 4) | §A0.5, §A12, §B2 |

---

# ЧАСТЬ A — BACKEND

## §A0. Инфраструктура (Ф0) — спина всего ТЗ

Helper'ы в `backend/src/modules/ai/services/prompts/common.ts` (создаются один раз, дальше применяются):

- **A0.1 `applyInputGuards(system,user,{asr,participants,meetingDateIso,injection})`** — общий слой
  E1/E2 (`withInjectionGuard`+`wrapUserData`+опц.`withAsrNote`); kill-switch `aiFeatures.inputGuardEnabled` (ON).
- **A0.2 машинный гард `inputKind`** (`raw-transcript|raw-user-text|derived|machine`) + CI-lint (падает,
  если raw-* call-site не обёрнут) + расширить `sanitize-custom-prompt` (рус. «действуй как», code-fence, XML).
- **A0.3 семейство калибровок** — `withForecastConfidenceCalibration` + `withToneConfidenceCalibration`.
- **A0.4 `withDecisionDiscriminator`** + glossary-ключ `process-discriminator` (норма+повторяемое≠разовое;
  решение≠пожелание; insight≠жалоба; черта≠эпизод).
- **A0.5 единый `status`-enum** — **3 значения** `существует|нужен|обсуждается` (Р-B) + правило
  «извлечённый ≠ подтверждённый». *(Оверрайд Ф0.5 предв. ТЗ: было 4, владелец выбрал 3.)*
- **A0.6 `withPeopleHypothesisGuard`** — оценки людей гипотезно, приватно.
- **A0.7 `withDocumentCompilerMode`** — СОЗДАНИЕ/ДОПОЛНЕНИЕ + маркеры `[требует уточнения]`/`[конфликт]`/
  `[изменено]` + «ничего не теряй» + версия+changelog.
- **A0.8 прокидка `meetingDateIso`** + подключение `withEdgeCasePolicy` к extract-путям.

**Приёмка A0:** unit на идемпотентность guards + снапшоты констант; `typecheck`+`build`.

## §A1. E2 на мутирующих/внешних входах (немедленно)
`concierge` (мутирующие tools), `intake-auto-triage` (внешний канал→Issue), `telegram-create/forward-task`
(чужой форвард), `commitment-extract-status` (инъекция ложно закрывает обещание). Обернуть через A0.1.
**Деталь:** рерайты `40a`, `60a`, `60b`.

## §A2. Массовое `applyInputGuards` (E2/E1)
Все raw call-site вне `analyze.worker` (полный список — рерайты + аудит §1.1). **Холостые guard'ы**
(нота в SYSTEM есть, user не обёрнут): `sprint-helper`, `sprint-review`, `table-extract-rows`,
`table-infer-schema`, `follow-up` — добавить `wrapUserData`. **Уже есть обёртка** (не дублировать):
`analyze.worker`, `regulation-extract`(флаг), `experiment-extract`, `helpfulness-trait-merge`,
`chat-v2.ask`(флаг), `card-rollup-v2`, `task-dedupe`, `fact-supersede`, `block-distill`(проверить).
**Деталь:** рерайты + INDEX §5 (полный список сервисов).
**Приёмка:** CI-lint `inputKind` зелёный по всему реестру raw-*.

## §A3. B3 — разделение аудитории конструкцией (клиентские)
Разбить клиентский tool-вызов на ДВА: нейтральный протокол наружу + внутренняя карточка (`internal-only`).
Применить к `type-customer_success` (split), `type-sales`, `follow-up`, `type-partner`, `type-custdev`,
`card-rollup-v2`(client/deal/vendor), `chatbox-summary`. → реализуется новым агентом `client-meeting-split` (§A11/B0).
**Деталь:** пилот `01` §2, рерайты `10b`, `11`.

## §A4. Смысловые гарды экстракторов (A1/C2/E3/E4)
- **A1** (`withDecisionDiscriminator`): process-template-extract, regulation-extract, specialists-combined,
  block-ingest(группа Б), type-standup/team/project/retrospective/plan_fact, insight-extract,
  experiment-extract, skill-trait-detect; в `tasks-unified` BASE_SYSTEM вынести анти-«надо бы».
- **C2** (status): process-template-extract, regulation-extract, decision-extract (убрать дефолт
  `approved`), block-ingest, type-*, tasks, insight/idea-extract.
- **E3/E4**: прокинуть `meetingDateIso`+`withEdgeCasePolicy` в block-ingest/regulation/decision/tasks/
  type-project/retrospective/plan_fact/sales/standup/custdev, table-extract-rows, issue-infer-fields, intake-auto-triage.
**Деталь:** рерайты `10a`, `20`, `21a-d`, пилот `01` §3/§5.
**Приёмка:** diag — разовая задача НЕ создаёт active-«Процесс».

## §A5. ПРАВИЛО-ЛЮДИ + выдача HR-ролей (Р3)
`withPeopleHypothesisGuard` к: hr-recommender, knowledge-clone-extract, type-review, type-interview,
goal-vector-tracker, team-health, reflection-quality, clone-style. RBAC-видимость **не менять**.
**Разблокировать роли** (Р3): `UpdateMemberSchema`+`InviteMemberSchema` += `coo|hr_partner` (фронт §B4).
**Деталь:** рерайты `50b`, `21c`.

## §A6. Консолидация + ретайр (Р1/Р4/Р5)
- **Р5:** убрать `runTasks` (мёртвый `AiResult.tasks`).
- **Качество:** один источник 5-категорийной оценки (report-fast vs quality-score).
- **Telegram:** один builder `mode=own|forward`.
- **goalId:** убрать ветку из issue-infer-fields (владелец — issue-goal-suggest).
- **chat-v2-synthesize MODE_PROMPTS** → перенести addon в боевые BASE/factual/synthetic → ретайр.
- **Р1 ретайр v2-стека целиком:** 3 промпта + 3 сервиса + meeting-analyze-v2.worker/cron + module/queue +
  admin-compare поля `summaryV2`/`analyzeV2` (контроллер + **фронт §B4**) + union/ALL_LLM_TASK_TYPES.
  `pickPrimarySummary` → `summaryFast || summary`. **Страховка:** read-only diag прода (нет живых summaryV2).
- **Р4 ретайр сироты** `process-steps-extract` (промпт + union/ALL + smoke + комментарий в 3-1-regulations).
**Деталь:** аудит §3, рерайты `40b`, `60a/b`.

## §A7. Новый агент `structured-document-compiler` (Ф7)
Один компилятор-владелец регламент/процесс/инструкция/политика: F2 (создание/дополнение, версии,
маркеры) + D1 (действующая vs устаревшая) + C2 (статус), incremental к `contentMd`.
- **Контракт:** tool `compile_org_document` → `contentMd` · `steps[]`(process) · `changeReason`(→`RegulationVersion`) · `signals[]`.
- **Вход:** `kind` · `name` · `newSourceBlocks[]` · `existingContentMd` · `existingSteps[]` · `nowIso`.
- **SYSTEM:** полный текст — анализ 22 §3 (режимы, слияние, структуры по типам, маркеры, чек-лист).
- **Оркестрация:** после `regulation-dedupe` (new/merge/extension) вызывать компилятор (сейчас extension=plain update).
**Деталь:** анализ 22 §3.

## §A8. F1 cache-friendly + D1 supersession
- **F1:** вынести переменное из SYSTEM в user — clone-respond (имена/persona), concierge (preHits),
  goal-alignment («дедлайн близок»), chat-v2-synthesize, participant-context.
- **D1:** supersession-правило — card-rollup-v2, clone-respond, chat-v2-factual, decision/regulation-арбитры,
  debate-decision-supersede stance, block-distill/reframing/entity-merge.
**Деталь:** рерайты `40a/b`, `21a/c`, `30`, `60c`.

## §A9. C1-калибровка + structured output (I11)
Калибровки (A0.3) + **синхронизация якорей с порогами** (`AdminSetting`): intake-auto-triage (0.92→0.75),
telegram (0.85), issue-infer (0.7), hr-recommender; generic — block-linker/entity-link/specialists-combined/
fact-supersede (**КРИТ:** вес ребра графа); прогнозная — forecaster; тональная — speaker-analyzer/team-health.
Native json_schema strict — daily-digest/goals-pulse/orchestrator-plan/feedback-cluster.
**Деталь:** рерайты `21c`, `50b`, `60a/c`.

## §A10. Сущность «Инструкция» first-class (Р2)
- **Модель/миграция:** Prisma `Instruction` (name/contentMd/forRole/status/версии/embedding); additive,
  `prisma:migrate` + HNSW/GIN в `postgres-init.sql` → `prod-deploy-log` Шаги 4–5.
- **Извлечение:** `kind='instruction'` в `regulation-extract` И `specialists-combined` синхронно +
  `withDecisionDiscriminator` (single-role признак из `scope='role:<id>'`). **Гейт:** в SYSTEM вводить
  только после обновления Zod-схемы (иначе Zod-reject).
- **API+RBAC:** `RegulationKindSchema += instruction`; роутинг list/get/confirm/correct/supersede; новый
  `ResourceType instruction` в policy.csv; card-handler `type:'instruction'`.
- **Backfill:** `backfill-reclassify-instructions.ts` (`Process` со `scope='role:*'` → `Instruction`),
  идемпотентно, dry-run; в `apply-prod-deploy.ts` STEPS + `prod-deploy-log` Шаг 8.
- **Фронт:** §B2.

## §A11. Пост-встречные доноры — отчёт/протокол/граф (D1–D10)

> **Р-A: «N документов» = N агентов** (отчёт + протокол + граф раздельно). Граф — единый источник
> (block-ingest); идеи донора про граф → туда, не плодим второй извлекатель.

**Сквозное (Волна 1, текст SYSTEM):** идентификация сторон/спикеров + «спикер не определён» (D1);
само-проверка перед выдачей (D3); честная пустота «не зафиксировано/не выявлено» (D10).
**Сквозное (Волна 2, схема):** поле `data_quality: string|null` (или структурное для report-fast/block-ingest).

**B0. НОВЫЙ агент `client-meeting-split`** — нейтральный протокол наружу (free-text Markdown, отдельный
taskType, kill-switch `clientProtocolEnabled` ON). Структура — донор A «===ПРОТОКОЛ===». Граница D6
(ноль оценок; «перечитай глазами клиента»). Отправка вручную (гейт). Хранение — **отдельный Report
`kind='client_protocol'`** (рекоменд., см. §B1) либо `structuredData.client_protocol_md`.

**Командный отчёт (§A11.A):** meeting-report-fast + type-team/standup/plan_fact/project/retro/review/interview:
- **Волна 2 (схема, `structuredData` JSON — миграций НЕТ):** `ideas[]`/`proposals[]` (идеи ≠ задачи, D8);
  `decisions: string[]→[{text,speaker,changes_what}]` (team); `not_done→[{item,responsible,reason}]`+`unexplained_gaps[]`
  (plan_fact); `agreements→[{text,speaker,supersedes}]`+`responsibilities→[{who,what,deadline}]`+`ideas[]` (project);
  `recurring_problems[]` (retro); `decisions[]` (review); `competing_offers` (interview); `data_quality` везде.
- **Волна 1:** «решили≠обсудили»; «не уточнено»=сигнал; динамика команды наблюдаемая (не психологизировать).

**Клиентские (§A11.B):** type-sales (`competitors[]` вкл «ничего не делать», `decision_criteria[]`,
`what_hooked`, `main_blocker`, `data_quality`), type-customer_success (`churn_risk_quote`,
`competitors_mentioned[]`, split), type-partner/custdev (`data_quality`, СК-1), follow-up (D6 анти-утечка).

**Граф `block-ingest` (§A11.C):** Волна 1 — авторство неизвестно при пустых speakers[]; `evidenceQuote`≤15–20
слов; значимое не каждую реплику. Волна 2 — `dataQuality{speakerCoveragePercent,transcriptTruncated,lowConfidenceBlockCount}`,
`sideHint:our|client|unknown`(клиентский тип). Темпоральное замещение — НЕ в ingest (downstream-арбитры).

**Вспомогательные (§A11.D):** summary (D2/D10 фразы), chapters (D5/D10), tasks-unified (D3/D8 главный фикс),
meeting-quality-score (D2/D5), card-rollup v1 (D6 анти-утечка client/deal, D7 конкуренты).
**Деталь:** ТЗ `2026-06-10-post-meeting-and-org-docs.md` (вобран), рерайты `10a/10b/11/12a/20`.

## §A12. Орг-сущности — экстрактор-добавки (из анализа 22)
- **Волна 1 (текст):** «Чего НЕ извлекать» += чужие практики · гипотетика · упоминание документа без
  содержания (→`существует`,low conf); доменная калибровка confidence; few-shot на 2 сущности.
- **Волна 2 (схема):** `kind+=instruction` (§A10); `extractionStatus∈{существует,нужен,обсуждается}` (Р-B,
  чинит «всё Действует»); `roles: string[]`; `evidenceQuote` в вывод.
**Деталь:** анализ 22 §2.

---

# ЧАСТЬ B — FRONTEND (под новые контракты)

> Слои `ApiDto→DomainModel→UiModel`. Большинство правок — additive (новые поля/метки); ломких мало.

## §B1. Отчёт встречи (рендер `structuredData` + протокол)
**Файлы:** `meeting-result-v2/MeetingResultPageReal.tsx` (оркестратор), `meeting-result-v2/structured-report.tsx`
(движок рендера), `domain/ai-result.ts` (маппер), `ReportsTab.tsx`/`ReportDetailDialog`/`ReportOutputRenderer`,
`api/meeting-reports.api.ts`+`domain/meeting-report.ts`.

- **B1.1** `STRUCTURED_FIELD_LABELS` (structured-report.tsx) += `ideas:'Идеи'`, `proposals:'Предложения'`,
  `data_quality:'Качество данных'`, `competitors:'Конкуренты'`, `what_hooked:'Что зацепило'`,
  `main_blocker:'Главный блокер'`, `churn_risk_quote:'Цитата риска оттока'`, `recurring_problems:'Повторяющиеся проблемы'`,
  `unexplained_gaps:'Без объяснённой причины'`, `competing_offers:'Другие офферы'`.
- **B1.2 Специализированные рендеры** (не generic key-value):
  - `data_quality` → бейдж/коллапс-блок «Качество данных» вне общего грида (НЕ путать с QualityScore встречи).
  - `churn_risk_quote` → `<blockquote>` с подсветкой.
  - `ideas/proposals` → визуально отличны от tasks (иконка «лампочка»), отдельная секция.
  - `decisions`-объекты `{text,speaker,changes_what}` → `objectMeta()` показывает speaker + «что меняет».
  - `not_done`/`agreements`/`responsibilities`-объекты → карточки с под-полями.
- **B1.3** `StructuredFieldValue` — передавать `fieldKey` в рекурсию (сейчас «главный текст» угадывается по
  `[title,text,name,...]` — хрупко при новых объектах). `structuredReportToMarkdown` — сериализовать новые структуры.
- **B1.4 Клиентский протокол** — **отдельный Report `kind='client_protocol'`** (рекоменд.: переиспользует
  ReportsTab/ReportDetailDialog): `ReportKindApi += 'client_protocol'`; в ReportCard — бейдж «Клиенту» +
  кнопка «Отправить вручную»/«Скопировать» (см. развилку Ф-1). `domain/ai-result.ts`: `ideasFromApi`/`decisionsFromApi`
  парсеры (как `tasksFromApi`).
- **B1.5** FollowUpCard → «Письмо участникам»; D6 — для клиентских типов не показывать внутренние оценки.

## §B2. Регламенты / Инструкции / Процессы
**Файлы:** `regulations/RegulationsListClient.tsx`, `domain/regulation.ts`, `api/regulations.api.ts`,
`processes/ProcessTemplatesClient.tsx`, `domain/process-template.ts`, `api/processes.api.ts`.

- **B2.1 Instruction:** `RegulationKindApi += 'instruction'`; `REGULATION_KIND_LABEL += instruction:'Инструкция'`;
  вкладка-фильтр «Инструкция» в `KIND_FILTERS`; `buildRegulationCorrectionFields` — ветка instruction (как process).
- **B2.2 extractionStatus (Р-B):** `ExtractionStatusApi = 'exists'|'needed'|'discussed'` в api; поле
  `extractionStatus` в ListItem/Detail (regulations И processes); лейблы `Существует/Нужен/Обсуждается`;
  **отдельный чип** (exists=success/needed=warning/discussed=info), визуально отделён от lifecycle.
- **B2.3 Фикс «всё Действует»:** для записей с `extractionStatus∈{needed,discussed}` НЕ показывать lifecycle
  «Действует» (секция «Черновики/обсуждается»). *(Не добавлять `draft` в lifecycle-enum — гейтить через extractionStatus.)*
- **B2.4 Структурный `contentMd` + маркеры:** заменить `<pre>` на Markdown-рендер с `parseContentMarkers(text)`
  → `[требует уточнения]`=warning-чип, `[конфликт]`=danger-чип. Маркеры — **литеральные строки** в contentMd
  (рекоменд., см. Ф-2). Сделать contentMd основным блоком (убрать `<details>`/условие `contentMd!==statement`).
- **B2.5 changeReason:** в «История изменений» выделить лейблом «Причина изменения:» (regulations: `changeReason`;
  processes: `changeNote` — показать под тем же лейблом); индикатор `source` (agent/manual/imported) чипом.

## §B3. Админка промптов/моделей
**Файлы:** `admin/prompts/*` (PromptsListClient/PromptEditor/PromptPreviewModal/PromptVersionsTab),
`admin/media/meetings/[id]/compare/*` + `AdminMeetingCompareSummaries.tsx`, `admin/llm-routes/*`, `admin/ai-models/*`.

- **B3.1 Новые taskType** в `PROMPT_TASK_TYPES` + метки: `client-protocol`, `compile-org-document`,
  (+ существующие support-* если есть). Русские группы в `domain/admin-ai-model.ts` (`taskTypeGroupLabel`).
- **B3.2 Ретайр v2 (Р1):** убрать колонку v2 из `AdminMeetingCompareSummaries` (Summary/Chapters/Tasks);
  убрать `summaryV2*`/`reportStatuses.analyzeV2` из `admin.api.ts` и `AiResultApi`/`aiResultFromApi`;
  `pickPrimarySummary` source → `'fast'|'legacy'`; страницу `/compare` → «Детали AI-отчёта» или удалить (редирект).
- **B3.3 Превью промпта** (PromptPreviewModal) — рендерить структурный вывод через `StructuredFieldValue`, не `<pre>`.

## §B4. Потребители agent-output (минорно)
- **Выдача ролей (Р3):** в форме приглашения/редактирования участника (`(authenticated)/.../members` или
  `admin/members`) добавить роли `coo|hr_partner` в селект (после расширения DTO §A5).
- `DecisionsListClient`/`domain/decision.ts` — если decisions-объекты обогатились (rationale/alternatives) —
  согласовать рендер DecisionDetail.
- `IdeasTopWidget`/`InsightsListClient` — подхватят новые ключи через STRUCTURED_FIELD_LABELS; фильтры — опц.
- `GoalVectorVerdictWidget` — не затронут напрямую (свой API).

## §B6. Читабельность чата chat-v2 + нейминг «Мастер Кора» (хэндофф 2026-06-10, фронт владельца ГОТОВ)
> Параллельная сессия владельца уже сделала фронт chat-v2 — **не трогать/не дублировать.**
- **Сделано (фронт):** новый `frontend/src/ui/components/chat-v2/AssistantMarkdown.tsx` (react-markdown@10 + rehype-sanitize@6, без prose, наследует цвет бабла, `[BLOCK:id]` срезается `stripContextMarkers` до парсинга); подключён в `ChatV2Client.tsx` (MessageView), `chat-v2/ChatPanel.tsx`, `tracker/IssueChat.tsx`. Текст пользователя — plain; ответ ассистента — markdown. Метка «Режим: Синтез» убрана → единая подпись **«✨ Мастер Кора»** для всех ответов.
- **Долг по промптам (наш, рерайты `40b-chat`):** в СТАЛО `factual.prompt.ts`/`synthetic.prompt.ts`/`clone-style.prompt.ts` добавить **стабильную (cache-friendly, в КОНЕЦ system) секцию `## Формат`** — реальный markdown: вводная строка → смысловые блоки с пустой строкой → перечисления списком (не «стена») → жирные подзаголовки/термины → **один** сдержанный эмодзи-маркер в начало пункта (📌🎯⚠️💡✅) → `[BLOCK:id]`/маркеры уверенности инлайн (фронт их режет). `factual` — легче (1–3 предложения, список только при нескольких фактах); `clone-style` — эмодзи по минимуму, в тон сотрудника. **Реализуется в Волне 7 (A8 chat-v2).**
- **Вне scope:** глобальный ребренд «консьерж → мастер» (`ui/concierge/*`, плавающая кнопка, admin-аналитика, `concierge.api`) — отдельная задача, ждёт go владельца; `ConciergeChat.tsx` (плоский вывод ~350) — markdown туда в рамках того же ребренда.

## §B5. Развилки фронта (рекомендации — нужно «ок» владельца)
- **Ф-1 (клиентский протокол):** отдельный `Report kind='client_protocol'` *(рекоменд.: переиспользует
  инфру отчётов)*. Кнопка — **«Скопировать»** в v1 (Ship-On, без email-инфры), backend-`sendToClient` — следующей волной.
- **Ф-2 (маркеры):** литеральные строки `[требует уточнения]`/`[конфликт]` в `contentMd` + frontend-парсер
  *(рекоменд.: без доп. поля annotations)*.
- **Ф-3 (data_quality):** `string|null` (1–2 фразы) в v1 *(рекоменд.)*; структурный объект — позже.
- **Ф-4 (страницы):** `/regulations` и `/processes` оставить раздельно; instruction — вид Regulation на `/regulations` *(рекоменд.)*.

---

# СВОДНЫЕ ТАБЛИЦЫ

## Мастер-таблица контракт/схема (backend)
| Зона | Изменение | Тип | Миграция БД |
|---|---|---|---|
| отчётные type-* | `ideas/proposals/decisions-объекты/competitors/data_quality/...` в `structuredData` | additive/брейк | **нет** (JSON) |
| meeting-report-fast | `data_quality` в tool-схеме | additive | нет |
| type-sales/cs | `competitors[]/decision_criteria/what_hooked/main_blocker/churn_risk_quote` | additive | нет |
| **client-meeting-split** | новый агент + `Report kind='client_protocol'` | новый | нет |
| block-ingest | `dataQuality{}`, `sideHint` | additive | JSON=нет / колонка=да |
| regulation-extract/specialists-combined | `kind+=instruction`, `extractionStatus`(3), `roles[]`, `evidenceQuote` | брейк/additive | **да** (Instruction, Ф10) |
| **Instruction** | новая таблица + индексы | новый | **да** (Шаг 4–5) |
| **structured-document-compiler** | новый агент `compile_org_document` | новый | нет |
| decision-extract | убрать дефолт `status='approved'` | поведение | нет |
| commitment-extract-status | **+ статус `unclear`** (КРИТ) | брейк-код | нет |
| v2-стек | удалить (Р1) | удаление | колонки можно оставить мёртвыми |
| runTasks/AiResult.tasks | убрать (Р5) | удаление | нет |
| RBAC | `+coo|hr_partner` в Update/InviteMember; `ResourceType instruction` | additive | нет |

## Мастер-таблица фронт
| Файл | Изменение | Ломкое? |
|---|---|---|
| structured-report.tsx | новые ключи labels + спец-рендеры (data_quality/churn_quote/ideas/decisions-объекты) | нет (additive) |
| MeetingResultPageReal.tsx | секции «Качество данных», протокол, идеи; v2-чистка | нет |
| domain/ai-result.ts | парсеры ideas/decisions; убрать summaryV2; pickPrimarySummary→fast/legacy | да (v2-чистка) |
| meeting-reports.api/domain | `ReportKind += client_protocol`; (опц.) sendToClient | additive |
| regulations (client/domain/api) | instruction + extractionStatus + маркеры contentMd + changeReason | additive |
| processes (client/domain/api) | extractionStatus + changeReason/source-чип | additive |
| AdminMeetingCompareSummaries + admin.api | ретайр v2-колонок/полей | да (удаление) |
| admin/prompts/* | новые taskType + структурное превью | additive |
| members/invite UI | роли coo/hr_partner | additive |

## Миграции БД (только эти)
1. **`Instruction`** таблица + HNSW/GIN (Ф10) → `prod-deploy-log` Шаг 4–5.
2. *(опц.)* block-ingest `dataQuality`/`sideHint` если типизированными колонками (иначе JSON — без миграции).
3. backfill `backfill-reclassify-instructions.ts` → Шаг 8.
> Все отчётные новые поля — в `AiResult.structuredData` (JSON) ⇒ **миграций нет**.

---

# Порядок реализации (волны)

1. **Волна 0 — инфра A0** (helper'ы + CI-lint). Без неё фазы 2–9 не на чем стоять.
2. **Волна 1 — безопасный текст** (no-schema, катим сразу): A1(E2-крит), A4-текст, A11-Волна1 (стороны/
   само-проверка/честная пустота), A12-текст, `tasks` D3/D8, `follow-up`/`card-rollup` D6 (анти-утечка).
3. **Волна 2 — массовый класс-фикс:** A2 (applyInputGuards везде) + A9-калибровки на необратимом.
4. **Волна 3 — отчётные схемы** (`structuredData`, миграций нет): A11-Волна2 поля + **фронт B1** пакетами
   (сначала labels+generic, потом спец-рендеры, потом провенанс-объекты team/project/plan_fact).
5. **Волна 4 — клиентский протокол:** `client-meeting-split` (B0) + **фронт B1.4** (Report kind).
6. **Волна 5 — консолидация/ретайр:** A6 (v2/runTasks/telegram/goalId) + **фронт B3.2** (admin v2-чистка).
7. **Волна 6 — орг-документы:** A10 (Instruction миграция+backfill) + A7 (компилятор) + A12-схема +
   **фронт B2** (instruction/extractionStatus/маркеры).
8. **Волна 7 — добивка:** A5 (people-guard+роли, фронт B4), A8 (F1/D1), A9 (structured output).

> Каждая волна — зелёные `typecheck`/`build`/снапшоты + наблюдение прода (diag). Между волнами не стоп —
> commit и следующая волна (но push — с подтверждением владельца).

# Приёмка (общая)
- `cd backend && bun run typecheck && lint && build` зелёные; `cd frontend && bun run typecheck && build` зелёные.
- Все тронутые `*.snapshot.spec.ts` обновлены; CI-lint `inputKind` зелёный.
- Фронт-рендер `structuredData` не падает на новых/пустых полях.
- Diag на тест-встречах: (а) клиентский протокол без оценок/температуры; (б) идеи не в задачах; (в) «спикер
  не определён» вместо угадывания; (г) разовая задача не создаёт active-«Процесс»; (д) инъекция не исполняется.

# Прод-операции
- **Флаги:** `aiFeatures.inputGuardEnabled` (kill-switch ON), `clientProtocolEnabled` (kill-switch ON) →
  `feature-flags.md` + `prod-deploy-log` Шаг 1.
- **Миграции:** `Instruction` (Ф10) + опц. block-ingest колонки → Шаг 4–5; backfill → Шаг 8.
- **RBAC:** `ResourceType instruction` + роли hr_partner/coo → `policy.csv` + `feature-flags.md`.
- **Ретайр v2 (A6):** перед удалением — read-only diag прода.
- Отчётные `structuredData`-поля — без миграций; деплой = `docker compose up -d --build`.

# Что НЕ входит
- Слияние отчёта и графа в один агент (Р-A).
- Дублирование графовых фактов отчётными промптами.
- Дашборд-редизайн (отдельный трек).
- Email-инфра отправки протокола (v1 — копирование; backend-send — следующей волной).

# Приложения (детальная часть этого ТЗ)
- **Пер-промптовые БЫЛО→СТАЛО** — [prompt-rewrites/](../analysis/2026-06-09-prompt-rewrites/) (22 файла; INDEX §4 — контракт-изменения, §5 — call-site).
- **Орг-сущности + компилятор** — [22-org-entities-COMPARE-and-compiler.md](../analysis/2026-06-09-prompt-rewrites/22-org-entities-COMPARE-and-compiler.md).
- **Пост-встречные доноры (деталь)** — [2026-06-10-post-meeting-and-org-docs.md](2026-06-10-post-meeting-and-org-docs.md).
- **Аудит-обоснование** — [prompt-fleet-audit.md](../analysis/2026-06-09-prompt-fleet-audit.md).

# Итог
Реализовано: нет (ТЗ). Это **единый мастер-контракт**: инфра Ф0 + ~126 промптов (рерайты-приложение) +
консолидация/ретайр + орг-документы/компилятор + пост-встречные доноры + **все фронтенды**, 7 волнами по
приоритету. Backend `structuredData`-изменения — без миграций БД; миграции только под `Instruction`.
Начинать по «погнали Волну N».
