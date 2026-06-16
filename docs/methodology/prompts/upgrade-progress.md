# Реестр апгрейда промптов агентов Коры

> **Назначение.** Опора-трекер: видеть, у каких агентов промпт уже переписан по
> методологии, что в работе, что в очереди. Идём пачками (~5 агентов за заход).
>
> **Что где:** *как писать промпт* — [README.md](README.md) (методология);
> *что внедряем в код* — ТЗ в `plans/tz/`; *что уже сделано* — **этот файл**.
>
> **Легенда статусов:**
> `⬜` не тронут · `🟡` переписан (финальный текст готов, ждёт выката) ·
> `🟢` выкачен в прод.
>
> Правило ведения: переписали промпт → строка сюда (статус `🟡` + ссылка на ТЗ
> с финальным текстом). Выкатили на прод → `🟢` + дата. Берём новую пачку →
> разворачиваем её поимённо из «Очереди».

## Сделано / в работе

| Агент / `taskType` | Файл | Статус | Финальный текст | Дата |
|---|---|---|---|---|
| `meeting-report-fast` | [meeting-report-fast.prompt.ts](../../../backend/src/modules/ai/services/prompts/meeting-report-fast.prompt.ts) | 🟡 | ТЗ 2026-06-11, Прил. A1 | 2026-06-11 |
| `extract_sales` (type-sales) | [type-sales.ts](../../../backend/src/modules/ai/services/prompts/type-sales.ts) | 🟡 | ТЗ 2026-06-11, Прил. A2 | 2026-06-11 |
| `client-meeting-split` | [client-meeting-split.prompt.ts](../../../backend/src/modules/ai/services/prompts/client-meeting-split.prompt.ts) | 🟡 | ТЗ 2026-06-11, Прил. A3 | 2026-06-11 |
| `query-understand` (`dialog-multi-query` v2 — модуль понимания запроса, слияние контекстуализатора + оценщика + расширителя; **реализовано в коде**) | [query-understand.prompt.ts](../../../backend/src/modules/dialog-layer/prompts/query-understand.prompt.ts) · [эталон](examples/query-understand.md) | 🟡 | ТЗ 2026-06-14, Прил. A | 2026-06-14 |
| `dialog-extract-plan` (извлекатель плана — вход 3 формулировки, объединённый план) | [extract-plan.prompt.ts](../../../backend/src/modules/dialog-layer/prompts/extract-plan.prompt.ts) | 🟡 | ТЗ 2026-06-14, Прил. B | 2026-06-14 |
| `concierge-respond` (помощник — развилка + руки + уточнитель + границы) | [concierge.service.ts](../../../backend/src/modules/concierge/services/concierge.service.ts) | 🟡 | ТЗ 2026-06-14 (assistant-router-dedup), Прил. A | 2026-06-14 |
| chat-v2 (единый ответчик — слияние BASE + «факт» + «синтез», без режимов; человеческий русский контекст; **часть A реализована в коде**) | [chat-v2.service.ts](../../../backend/src/modules/knowledge-core/services/chat-v2.service.ts) · [эталон](examples/chat-v2-answer.md) | 🟡 | ТЗ 2026-06-15, Прил. A | 2026-06-15 |

ТЗ выката: [plans/tz/2026-06-11-meeting-report-consolidation-graph-and-prompts.md](../../../plans/tz/2026-06-11-meeting-report-consolidation-graph-and-prompts.md) · [plans/tz/2026-06-14-dialog-layer-unified-query-understanding.md](../../../plans/tz/2026-06-14-dialog-layer-unified-query-understanding.md) · [plans/tz/2026-06-15-chat-v2-unified-answer-prompt.md](../../../plans/tz/2026-06-15-chat-v2-unified-answer-prompt.md)

## Очередь — отчёты по типам встреч (`extract_*`)

Однотипны с `type-sales`; паттерн уже отработан (роль+чистый русский, граница D6
у клиентских, дискриминатор близких сущностей, полнота примеров по required).

| Тип | Файл | Класс | Статус |
|---|---|---|---|
| custdev | type-custdev.ts | клиентский (внутр.+протокол) | ⬜ |
| customer_success | type-customer_success.ts | клиентский (+follow-up) | ⬜ |
| partner | type-partner.ts | клиентский (внутр.+протокол) | ⬜ |
| team | type-team.ts | внутренний | ⬜ |
| standup | type-standup.ts | внутренний | ⬜ |
| plan_fact | type-plan_fact.ts | внутренний | ⬜ |
| project | type-project.ts | внутренний | ⬜ |
| interview | type-interview.ts | внутренний | ⬜ |
| review | type-review.ts | внутренний | ⬜ |
| retrospective | type-retrospective.ts | внутренний | ⬜ |

(`task_discussion` → использует `team`; `sprint_review` → использует
`retrospective` — отдельных файлов нет, покрываются вместе с ними.)

## Очередь — прочие группы агентов (разворачиваем при заходе в группу)

Полный реестр LLM-задач — `union LlmTaskType` (~127 `taskType`). Здесь — группы
для планирования пачек; поимённо разворачиваем, когда берём группу.

| Группа | Примеры агентов | Статус группы |
|---|---|---|
| Сводка/письма встречи | `system-summary`, `follow-up` | ⬜ (учесть: часть слоя меняется в ТЗ 2026-06-11) |
| knowledge-core: специалисты графа | 3-1 regulations, 3-3 decisions, 3-5 insights, 3-6 ideas, 3-7 skill, 3-9 experiments | ⬜ |
| knowledge-core: ingest/distill | block-ingest, block-distill, специалист-routing | ⬜ |
| Клоны / персоны | knowledge-clone-extract, executable-persona, skill-trait-detect | ⬜ |
| Probe (уточняющие вопросы) | `probe-formulate` (✅ эталон методологии), probe-question | ⬜ |
| Chat / Chat-v2 | synthesize, стадии, query | 🟡 единый ответчик — ТЗ 2026-06-15; стадии/query — ещё ⬜ |
| Operations / Pulse | checkin-sentiment, meeting-speaker-analyzer, meeting-roi, decision-hygiene | ⬜ |
| Smart-tables | table-architect, table-auto-fill, table-extract-rows, table-infer-schema, table-semantic-filter | ⬜ |
| Документы | document-attribution-suggest, structured-document-compiler | ⬜ |
| Спринты | sprint-helper-suggest, sprint-review-summary | ⬜ |

> Когда заходим в группу — переносим её агентов в раздел «Сделано / в работе»
> поимённо, с файлами и статусами.
