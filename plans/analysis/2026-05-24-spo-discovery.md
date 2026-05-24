---
type: discovery
status: needs-owner-review
date: 2026-05-24
for: plans/tz/2026-05-24-supervised-prompt-optimization.md
---

# SPO Discovery — что нужно решить с владельцем перед стартом

## TL;DR — рекомендация на одну минуту

**Рекомендация: вариант B+ — собрать MVP SPO поверх уже готовых `PromptTemplateVersion` + `PromptExperiment` + `AiResultFeedback` + новой пары моделей `PromptEvalCase` / `PromptEvalRun` + LLM-judge с rubric 0–5.** Это полностью покрывает ТЗ §1–§6, не требует DSPy/RLHF и переиспользует sticky-A/B (`stickyAllocate` в `prompt-experiments.service.ts:597`) для live-промоутинга. Зелёный свет даём только когда владелец подтвердит (а) приоритет `type-sales` как bootstrap, (б) ~15 ч ручной разметки и (в) бюджет $200–500/полный SPO-run.

## 1. Что такое SPO в нашем контексте

SPO (Supervised Prompt Optimization, viven.ai) — автоматический итеративный цикл «прогнать промпт → LLM-judge оценил → сильная LLM предложила N новых кандидатов → отобрали по Pareto → повторить 10–15 раз». У нас уже есть **63 системных промпта** в 7 группах: `backend/src/modules/ai/services/prompts/` (11 типов встреч + 10 сервисных: `type-sales.ts`, `type-interview.ts`, `tasks-unified.ts`, `chapters.ts`, `follow-up.ts`, `meeting-quality-score.ts` и др.), `backend/src/modules/knowledge-core/prompts/` (27 промптов ядра — `block-ingest.prompt.ts`, `decision-extract.prompt.ts`, `idea-extract.prompt.ts`, `insight-extract.prompt.ts`, `skill-trait-detect.prompt.ts`), `chat-v2/prompts/`, `dialog-layer/prompts/`. Все они доступны через `PromptResolverService` (`backend/src/modules/ai/services/prompt-resolver.service.ts`) с цепочкой `db_org → db_system → code_fallback`, а сигнал качества копится в `AiResultFeedback` (👍/👎 + comment, см. `ai-result-feedback.service.ts`). SPO превращает этот ручной цикл в измеримый.

## 2. Топ-5 кандидатов на автооптимизацию

Критерий отбора: (а) есть прямое влияние на бизнес-решение / граф знаний, (б) промпт частый и дорогой, (в) ошибки видны пользователю и копятся в `AiResultFeedback`.

| Промт | taskType | Почему первым | Сколько feedback нужно |
|---|---|---|---|
| `type-sales.ts` | `summary` (meetingType=sales) | Самый высокий чек, самая жёсткая обратная связь от менеджеров, sales-отчёт прямо влияет на сделку | 30 размеченных кейсов + 30 встреч с 👍 за квартал |
| `idea-extract.prompt.ts` | `idea-extract` | Ошибка извлечения = идея навсегда потеряна для бэклога; ядро Specialist 3.6 | 30 кейсов + сигнал из `Idea.userFeedback` (если появится) |
| `decision-extract.prompt.ts` | `decision-extract` | Критично для аудита: пропущенное решение нельзя восстановить пост-фактум; влияет на supersede-логику | 30 кейсов из встреч с явно зафиксированным решением |
| `meeting-extract-actions` (`tasks-unified.ts`) | `meeting-extract-actions` | Wave 3: автозадачи в трекер. Низкий confidence ломает auto-triage; пользователи правят → есть имплицитный feedback | 30 кейсов + diff пользовательских правок Issue |
| `type-interview.ts` | `summary` (meetingType=interview) | `role_fit/strengths/weaknesses` — основа решений о найме; промпт уже использует enum-шкалу, легко строить rubric | 30 кейсов + явный 👍/👎 HR-а |

`clone-respond` (γ-1) и `chat-v2 synthesize` — кандидаты второй волны: субъективная оценка стиля плохо ложится на rubric 0–5.

## 3. Метрика «лучше vs хуже»

Возможные сигналы качества (по приоритету):

1. **LLM-judge rubric-score 0–5** (по 4–6 критериям из `PromptRubric`, среднее) — основная метрика SPO. Repeatable, дешёвая, не требует пользователя.
2. **`AiResultFeedback` ratio** (положительные / всего) — самый честный сигнал, но медленный (нужно ≥30 фидбеков на версию).
3. **Downstream task success** — для `idea-extract` доля идей, дошедших до `IdeaCluster` + `status=in_progress`; для `meeting-extract-actions` — доля автозадач, у которых пользователь НЕ переписал `title/assignee`.
4. **Cost reduction** — снижение `AiUsageLog.costUsd` при том же rubric-score (короче промпт = дешевле).
5. **Latency reduction** — `AiUsageLog.durationMs` (важно для chat-v2 / dialog-layer).
6. **% invalid responses** — `z_prompt_invalid_response_total` (косвенно, F6 hardening).

ТЗ закладывает №1 как primary, №2 — как валидация после promote. Остальные — дашборды.

## 4. Сколько данных нужно

- **Минимум для rubric-судьи:** 30 эталонных кейсов на `(taskType + meetingType)` — это нижняя планка из статьи viven (75 у них для production). При 30 кейсах × 5 кандидатов × 15 итераций = 2250 LLM-вызовов на полный SPO-run.
- **Минимум для статистики A/B по AiResultFeedback:** ≥30 фидбеков на каждую группу, чтобы Wilson confidence interval сжался до ±0.15. При текущем потоке встреч у пилотных Org это 2–4 недели на тип.
- **Минимум для plateau-detection:** 3 итерации подряд без улучшения `bestAvgScore` (см. `pareto_plateau` в ТЗ §6.2.3).
- **Bootstrap-разметка:** 30 кейсов × ~30 мин на кейс (synthetic draft + human edit + human reasoning) = **~15 часов на тип**. Для 9 типов — 135 часов разовой инвестиции (ТЗ §6).

## 5. Бюджет на LLM meta-оптимизацию

**Вопрос владельцу:** какой бюджет на полный SPO-run одного типа встречи?

Дефолты в ТЗ:
- Judge: **DeepSeek-R1** через `proxy.agent-lia.ru` (~$0.5/1M input, $2/1M output).
- Proposer: **DeepSeek-R1** (или GPT-5 medium reasoning override через тот же proxy).
- **НЕ Anthropic** (нет ключа — см. `memory/project_z_infra_and_ai.md`).

Грубая оценка на DeepSeek-R1 при 15 итерациях × 5 кандидатов × 30 кейсов:
- 10 промт-итераций/мес × $30 = **~$300/мес** (мелкий поток, один тип в активной разработке).
- 100 промт-итераций/мес × $30 = **~$3000/мес** (несколько типов параллельно).
- 1000 итераций/мес × $30 = **~$30 000/мес** (полный 9-тип pipeline + knowledge-core, требует пересмотра модели на более дешёвую).

`maxCostUsd` в `PromptOptimizationRun` (default 50 USD/run, override до 200 USD super_admin'ом) — hard-stop на уровне воркера.

## 6. Три архитектурных подхода

### A. DSPy

- **что:** Stanford-фреймворк, программирует LLM-pipelines как Python-модули; автоматическая компиляция промптов через few-shot bootstrapping (`BootstrapFewShot`, `MIPROv2`) + teacher-student.
- **плюсы:** академически выверенный optimizer, активная community, готовые модули для CoT / ReAct / RAG.
- **минусы:** Python-rantime (наш бэк — Node/Bun/NestJS), потребует отдельный microservice или job-runner, не интегрируется с `LlmRouterService` без обёртки, абстракция «Signature / Module» чужеродна нашему `PromptResolver → tool_use` контракту, цена внедрения 3–4 недели + операционная сложность.
- **оценка интеграции:** низкая. Будет «второй стек» для одной фичи. Рассмотреть только если B даст плохие результаты.

### B. Простой A/B на базе уже существующих LlmModelExperiment + PromptExperiment

- **что:** SPO как BullMQ-воркер на Node, использует `PromptTemplateVersion` для хранения кандидатов, `PromptEvalCase/PromptEvalRun/PromptEvalResult/PromptOptimizationRun` (4 новые модели) для eval, `PromptExperiment.stickyAllocate` для live-валидации победителя. Judge и proposer — через тот же `llm-router.service.ts` с двумя новыми taskType (`prompt_judge`, `prompt_propose`).
- **плюсы:** **интегрируется с тем что есть** (75% инфраструктуры готово: версионирование, A/B-аллокация, sticky-hash, RBAC, entitlements, ai-models page). Один стек. Polный контроль над Pareto-логикой. Прямое использование `AiResultFeedback` как валидационного сигнала.
- **минусы:** Pareto + plateau-detection пишем сами (но это не R&D, а ~200 строк кода). Нет academic-fancy optimizer'ов.
- **оценка интеграции:** высокая. Это путь, описанный в ТЗ. 5 человеко-недель.

### C. RLHF-light (feedback-driven prompt rewriting)

- **что:** не SPO в чистом виде — пропускаем eval-set, оптимизируем сразу на пользовательском `AiResultFeedback`. Cron собирает встречи с 👎 за неделю, агрегирует комментарии, скармливает GPT-5 как «переписать промпт, чтобы такие случаи не повторялись».
- **плюсы:** ноль ручной разметки (нет PromptEvalCase), быстрый старт, прямой пользовательский сигнал.
- **минусы:** очень медленный feedback loop (недели), нет contained eval — каждый change катится в прод и риcкует регрессией; шумный сигнал (👎 часто из-за технических багов, не качества промпта); не Pareto-надёжный — оптимизирует «не получить 👎», а не «дать максимум value».
- **оценка интеграции:** средняя. Хорошо как **дополнение** к B (cron-фидер новых кейсов в `PromptEvalCase`), плохо как замена.

## 7. Безопасность и контроль

Чтобы SPO не выкатил худший промпт в прод:

1. **Golden-set тестов.** Каждая новая `PromptTemplateVersion` от SPO обязана пройти существующие `prompts.spec.ts` / `tasks-unified.spec.ts` / `meeting-quality-score.spec.ts` (стабильность сборки строки `system+user` билдером, см. F15 hardening).
2. **A/B-канарейка через `PromptExperiment`.** SPO-winner не становится `activeVersionId` напрямую — `POST /optimization-runs/:id/promote` запускает `PromptExperiment` с `splitPercent=10` против текущего champion на 7 дней. По результатам — manual promote.
3. **Manual approval перед promote → A/B.** В UI кнопка «Запустить A/B 50/50» требует подтверждения super_admin + non-empty `reason` (как в `LlmTaskRouteChange.reason`).
4. **Rollback в 1 клик.** Если в A/B `bestAvgScore` упал — `PromptTemplate.activeVersionId` откатывается на предыдущую версию через существующий `POST /admin/prompt-templates/:id/activate-version/:versionId`.
5. **Judge calibration.** Раз в неделю прогон контрольных кейсов с известным эталонным score — alert при дрейфе ±0.3 (ТЗ §4).
6. **Cost-cap + per-Org concurrency=1 + global=5** (ТЗ §11) — защита от runaway cost и DDoS proxy.

## 8. Вопросы к владельцу (5 ключевых)

1. **Bootstrap-тип:** подтверждаем `type-sales` как первый? (15 часов вашего времени на разметку 30 эталонов с reasoning). Или начать с `meeting-extract-actions` (дешевле разметка — пользовательские правки Issue уже служат имплицитным эталоном)?
2. **Бюджет judge/proposer:** OK на DeepSeek-R1 как primary для обоих ролей (ожидаемый чек $200–500 на полный SPO-run одного типа)? Готовы платить $300/мес за «активный type» или нужна более жёсткая cost-cap?
3. **Источник эталонов:** гибрид (synthetic draft через GPT-5 → human edit + human reasoning) приемлем, или хотите чистые «реально хорошие» отчёты с 👍 (риск: SPO упрётся в потолок текущего champion'а)?
4. **Promotion-политика:** SPO-winner идёт в `PromptExperiment` со `splitPercent=10` (канарейка 7 дней) и только потом — `activate-version`. Это OK или хотите ручной promote сразу на 100%?
5. **Entitlement:** SPO — фича Pro/Business (квота `spo_runs_per_month`: Pro=5, Business=20). OK или нужно сделать internal-only (только super_admin) на первой итерации, чтобы пилотировать без UX-обвязки?

## 9. Next steps если зелёный свет

1. **Неделя 1:** Phase 1 (Foundation) — 4 Prisma-модели (`PromptRubric`, `PromptEvalCase`, `PromptEvalRun`, `PromptEvalResult`) через `bun run prisma:push`; регистрация `prompt_judge` taskType в `llm-router.service.ts:44` (union) + `ALL_LLM_TASK_TYPES`; сервис `prompt-eval.service.ts`; worker'ы `spo-eval-batch.worker.ts` + `spo-judge.worker.ts`; стартовая `PromptRubric v1` для `type-sales` с 4 критериями (completeness / structure / accuracy / actionability).
2. **Неделя 2:** 30 эталонов для `type-sales` (15 ч силами владельца через UI «Эталонные кейсы»); прогнать текущий champion → получить baseline rubric-score (ожидаемо 3.0–3.5).
3. **Неделя 3–4:** Phase 2 (Optimization loop) — `PromptOptimizationRun` + worker `spo-optimize-iteration.worker.ts` с Pareto-отбором (3 оси: `avgScore` × `worstCaseScore` × `worstCriterionScore`); регистрация `prompt_propose`; admin UI `/admin/prompts/[id]/spo/`.
4. **Неделя 4:** первый полный SPO-run на `type-sales` → если bestAvgScore ≥ 4.0 — promote через `PromptExperiment` со `splitPercent=10` на 7 дней.
5. **Неделя 5:** Phase 3 (Regression detection) — nightly cron + judge calibration + alerts; рефлексия в `second-brain/05_история/`.
6. **Параллельно с Phase 2:** разметка эталонов для `idea-extract` и `decision-extract` (если бюджет владельца позволяет).
