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
| `skill-trait-detect` (M5 клон, пачка 1 — извлечение черты; + якорь смысла + self-check + people-hypothesis guard) | [skill-trait-detect.prompt.ts](../../../backend/src/modules/knowledge-core/prompts/skill-trait-detect.prompt.ts) | 🟡 | ТЗ 2026-06-16, Прил. A1 | 2026-06-16 |
| `skill-trait-merge` (M5 клон, пачка 1 — арбитр дублей; + якорь + 3 few-shot + targetId required + код-гард cosine≥0.85) | [skill-trait-merge.prompt.ts](../../../backend/src/modules/knowledge-core/prompts/skill-trait-merge.prompt.ts) | 🟡 | ТЗ 2026-06-16, Прил. A2 | 2026-06-16 |
| `skill-trait-verify` (M5 клон, пачка 1 — grounding-гейт; + якорь + 2 few-shot + код-предфильтр <2 цитат) | [skill-trait-verify.prompt.ts](../../../backend/src/modules/knowledge-core/prompts/skill-trait-verify.prompt.ts) | 🟡 | ТЗ 2026-06-16, Прил. A3 | 2026-06-16 |
| `value-motivation-detect` (M5 клон, пачка 2 — ценности из trade-off; + якорь + self-check, few-shot уже был) | [value-motivation-detect.prompt.ts](../../../backend/src/modules/knowledge-core/prompts/value-motivation-detect.prompt.ts) | 🟡 | ТЗ 2026-06-16, Прил. B1 | 2026-06-16 |
| `process-marker-detect` (M5 клон, пачка 2 — маркеры процесса; + якорь + self-check, few-shot уже был) | [process-marker-detect.prompt.ts](../../../backend/src/modules/knowledge-core/prompts/process-marker-detect.prompt.ts) | 🟡 | ТЗ 2026-06-16, Прил. B2 | 2026-06-16 |
| `role-principle-synthesize` (M5 клон, пачка 2 — принципы роли; + якорь + self-check, few-shot уже был) | [role-principle-synthesize.prompt.ts](../../../backend/src/modules/knowledge-core/prompts/role-principle-synthesize.prompt.ts) | 🟡 | ТЗ 2026-06-16, Прил. B3 | 2026-06-16 |
| `cdm-case-interview` (M5 клон, пачка 3 — CDM-вопрос; уже почти эталон, точечно усилен якорь) | [cdm-case-interview.prompt.ts](../../../backend/src/modules/knowledge-core/prompts/cdm-case-interview.prompt.ts) | 🟡 | ТЗ 2026-06-16, Прил. C1 | 2026-06-16 |
| `skill-trait-concept-name` (M5 клон, пачка 3 — имя концепта; + якорь + few-shot) | [skill-trait-concept-name.prompt.ts](../../../backend/src/modules/knowledge-core/prompts/skill-trait-concept-name.prompt.ts) | 🟡 | ТЗ 2026-06-16, Прил. C2 | 2026-06-16 |
| `executable-persona-compile` v2 (M5 клон, пачка 3 — сборка персоны; + якорь + few-shot-образец + self-check) | [executable-persona-compile.prompt.ts](../../../backend/src/modules/knowledge-core/prompts/executable-persona-compile.prompt.ts) | 🟡 | ТЗ 2026-06-16, Прил. C3 | 2026-06-16 |
| `clone-respond` (M5 клон, пачка 4 — ответ от лица роли, user-facing; + якорь + few-shot good/deepfake + self-check, оба режима) | [clone-respond.prompt.ts](../../../backend/src/modules/knowledge-core/prompts/clone-respond.prompt.ts) | 🟡 | ТЗ 2026-06-16, Прил. D1 | 2026-06-16 |
| `dialog-multi-query-clone` (M5 клон, пачка 4 — расширение запроса по аналогии; + якорь + few-shot) | [multi-query-clone.prompt.ts](../../../backend/src/modules/dialog-layer/prompts/multi-query-clone.prompt.ts) | 🟡 | ТЗ 2026-06-16, Прил. D2 | 2026-06-16 |
| `persona-behavior-judge` (M5 клон, пачка 4 — судья v1/v2; + якорь + 1 калибровочный few-shot) | [persona-behavior-judge.prompt.ts](../../../backend/src/modules/knowledge-core/prompts/persona-behavior-judge.prompt.ts) | 🟡 | ТЗ 2026-06-16, Прил. D3 | 2026-06-16 |
| `block-ingest` (ingest, пачка 1 — главный экстрактор; + роль/якоря + 5 различий классов intent≠commitment/decision/idea/question + 6 few-shot + self-check + запрет кодов в человеческие поля) | [block-ingest.prompt.ts](../../../backend/src/modules/knowledge-core/prompts/block-ingest.prompt.ts) | 🟡 | ТЗ 2026-06-16 (ingest-prompts), Прил. A1 | 2026-06-16 |
| `axis-classify` (ingest, пачка 1 — разметка осей; + человеческий ярлык signalType (словарь код→ярлык), temporal-enum на русские ярлыки + reverse-маппер, узкий добор, 5 few-shot) | [axis-classify.prompt.ts](../../../backend/src/modules/knowledge-core/prompts/axis-classify.prompt.ts) | 🟡 | ТЗ 2026-06-16 (ingest-prompts), Прил. A2 | 2026-06-16 |
| `entity-merge-arbiter` (ingest, пачка 1 — арбитр дедупа сущностей; + асимметрия цены ошибки, человеческие ярлыки вида, canonicalId слово-в-слово, снят нерелевантный ASR-нот, 5 few-shot) | [entity-merge-arbiter.prompt.ts](../../../backend/src/modules/knowledge-core/prompts/entity-merge-arbiter.prompt.ts) | 🟡 | ТЗ 2026-06-16 (ingest-prompts), Прил. A3 | 2026-06-16 |
| `block-distill` (ingest, пачка 2 — арбитр дублей блоков; роль-хранитель + якоря + асимметрия цены ошибки (при сомнении distinct) + 8 критериев + 5 few-shot + self-check; снят нерелевантный ASR-нот; signalType→человеческий ярлык на входе) | [block-distill.prompt.ts](../../../backend/src/modules/knowledge-core/prompts/block-distill.prompt.ts) | 🟡 | ТЗ 2026-06-16 (ingest-prompts), Прил. B1 | 2026-06-16 |
| `block-linker` (ingest, пачка 2 — арбитр связей графа; роль-картограф + якоря + «общая тема=none» + направление causes/consequences_of + 6 критериев + 5 few-shot + self-check; signalType→ярлык; обёртка confidence сохранена) | [block-linker.prompt.ts](../../../backend/src/modules/knowledge-core/prompts/block-linker.prompt.ts) | 🟡 | ТЗ 2026-06-16 (ingest-prompts), Прил. B2 | 2026-06-16 |
| `специалист-routing` (`knowledge-specialists-combined`) (ingest, пачка 2 — 1 вызов→8 типов сущностей; + якоря «куда уйдёт каждый тип» + маршрутизация по человеческим ярлыкам, не кодам + people-hypothesis для skill_traits + запрет кодов в человеческих строках + 5 few-shot + self-check) | [specialists-combined.prompt.ts](../../../backend/src/modules/knowledge-core/prompts/specialists-combined.prompt.ts) | 🟡 | ТЗ 2026-06-16 (ingest-prompts), Прил. B3 | 2026-06-16 |
| `decision-extract` (3-3, пачка 3 — реестр решений, ЖИВОЙ прод-путь; + якоря + 3-й few-shot «отказ» + self-check + signalType→ярлык) | [decision-extract.prompt.ts](../../../backend/src/modules/knowledge-core/prompts/decision-extract.prompt.ts) | 🟡 | ТЗ 2026-06-16 (specialist-extractors), Прил. C1 | 2026-06-16 |
| `idea-extract` (3-6, пачка 3 — сборщик идей; + якоря + self-check + signalType→ярлык, 3 few-shot были) | [idea-extract.prompt.ts](../../../backend/src/modules/knowledge-core/prompts/idea-extract.prompt.ts) | 🟡 | ТЗ 2026-06-16 (specialist-extractors), Прил. C2 | 2026-06-16 |
| `insight-extract` (3-5, пачка 3 — радар проблем/рисков; + якоря + **3 новых few-shot** problem/risk/негативный + self-check + signalType→ярлык) | [insight-extract.prompt.ts](../../../backend/src/modules/knowledge-core/prompts/insight-extract.prompt.ts) | 🟡 | ТЗ 2026-06-16 (specialist-extractors), Прил. C3 | 2026-06-16 |
| `regulation-extract` (3-1, пачка 3 — хранитель регламентов; + якоря + self-check + signalType→ярлык, 3 few-shot были) | [regulation-extract.prompt.ts](../../../backend/src/modules/knowledge-core/prompts/regulation-extract.prompt.ts) | 🟡 | ТЗ 2026-06-16 (specialist-extractors), Прил. C4 | 2026-06-16 |
| `experiment-extract` (3-9, пачка 3 — трекер экспериментов; + якоря + **3 новых few-shot** hypothesis/completed/негативный + self-check + signalType→ярлык) | [experiment-extract.prompt.ts](../../../backend/src/modules/knowledge-core/prompts/experiment-extract.prompt.ts) | 🟡 | ТЗ 2026-06-16 (specialist-extractors), Прил. C5 | 2026-06-16 |
| `knowledge-clone-extract` (3-2, пачка 4 — профиль знаний сотрудника; + якоря + **3 few-shot** + self-check + signalType→ярлык; people-hypothesis сохранён) | [knowledge-clone-extract.prompt.ts](../../../backend/src/modules/knowledge-core/prompts/knowledge-clone-extract.prompt.ts) | 🟡 | ТЗ 2026-06-16 (specialist-extractors), Прил. D1 | 2026-06-16 |
| `knowledge-clone-merge` (3-2, пачка 4 — слияние профиля с decay; + якоря + few-shot угасания + self-check + **обёртка people-hypothesis добавлена**) | [knowledge-clone-merge.prompt.ts](../../../backend/src/modules/knowledge-core/prompts/knowledge-clone-merge.prompt.ts) | 🟡 | ТЗ 2026-06-16 (specialist-extractors), Прил. D2 | 2026-06-16 |
| `goal-extract` (3-14, пачка 4 — извлечение целей outcome≠output; лёгкая правка: + якорь + self-check + signalType→ярлык, 3 few-shot были) | [goal-extract.prompt.ts](../../../backend/src/modules/knowledge-core/prompts/goal-extract.prompt.ts) | 🟡 | ТЗ 2026-06-16 (specialist-extractors), Прил. D3 | 2026-06-16 |
| `process-template-extract` (process-detector, пачка 4 — шаблоны процессов; + якоря + **2 новых few-shot** (методика-роль/негативный) + dedup-пример + self-check + signalType→ярлык) | [process-template-extract.prompt.ts](../../../backend/src/modules/knowledge-core/prompts/process-template-extract.prompt.ts) | 🟡 | ТЗ 2026-06-16 (specialist-extractors), Прил. D4 | 2026-06-16 |
| `decision-supersede-detect` (3-3, пачка 5 — арбитр устаревания решений; роль-хранитель + асимметрия + 4 few-shot + self-check + мэппинг ярлык→enum new/merge/supersedes + ключи evolvingMeta) | [decision-supersede-detect.prompt.ts](../../../backend/src/modules/knowledge-core/prompts/decision-supersede-detect.prompt.ts) | 🟡 | ТЗ 2026-06-16 (dedup-supersede), Прил. E1 | 2026-06-16 |
| `fact-supersede-detect` (bitemporal, пачка 5 — арбитр устаревания фактов; роль + асимметрия (3-уровневое отступление) + 5 few-shot + self-check + мэппинг enum; signalType→ярлык; confidence-обёртка сохранена) | [fact-supersede-detect.prompt.ts](../../../backend/src/modules/knowledge-core/prompts/fact-supersede-detect.prompt.ts) | 🟡 | ТЗ 2026-06-16 (dedup-supersede), Прил. E2 | 2026-06-16 |
| `regulation-dedupe` (3-1, пачка 5 — арбитр дублей регламентов; роль + асимметрия + 5 few-shot + self-check; **исправлена семантика extension=аддитивно** (не «замена»); kind→ярлык; мэппинг enum) | [regulation-dedupe.prompt.ts](../../../backend/src/modules/knowledge-core/prompts/regulation-dedupe.prompt.ts) | 🟡 | ТЗ 2026-06-16 (dedup-supersede), Прил. E3 | 2026-06-16 |
| `task-dedupe` (пачка 5 — арбитр дублей задач; роль + асимметрия + 4 few-shot + self-check + правило ASR-искажённого имени исполнителя; ASR-обёртка сохранена) | [task-dedupe.prompt.ts](../../../backend/src/modules/knowledge-core/prompts/task-dedupe.prompt.ts) | 🟡 | ТЗ 2026-06-16 (dedup-supersede), Прил. E4 | 2026-06-16 |
| `goal-hierarchy-link` (3-14, пачка 6 — иерархия целей; роль + асимметрия + 4 few-shot (2 негат.) + self-check + мэппинг ярлык→enum duplicate/child_of/standalone; горизонт→ярлык; снят ASR) | [goal-hierarchy-link.prompt.ts](../../../backend/src/modules/knowledge-core/prompts/goal-hierarchy-link.prompt.ts) | 🟡 | ТЗ 2026-06-16 (linking), Прил. E1 | 2026-06-16 |
| `goal-task-link` (3-14, пачка 6 — связь задача↔цель; роль + асимметрия + 4 few-shot + self-check + **шкала силы связи в теле** (не generic confidence-обёртка, порог 0.6) + true/false-гард) | [goal-task-link.prompt.ts](../../../backend/src/modules/knowledge-core/prompts/goal-task-link.prompt.ts) | 🟡 | ТЗ 2026-06-16 (linking), Прил. E2 | 2026-06-16 |
| `insight-link-to-decisions` (3-5, пачка 6 — причина боли в решениях; роль-следователь + асимметрия + критерий времени + 4 few-shot (2 негат.) + self-check; insightKind/decisionStatus→ярлык (8 значений)) | [insight-link-to-decisions.prompt.ts](../../../backend/src/modules/knowledge-core/prompts/insight-link-to-decisions.prompt.ts) | 🟡 | ТЗ 2026-06-16 (linking), Прил. E3 | 2026-06-16 |
| `goal-alignment` (strategic-alignment, пачка 6 — выравнивание цели со стратегией; роль-ревизор + асимметрия «не завышать» + шкала score в теле + 3 few-shot (негат. «не про цель») + self-check; signalType→ярлык) | [goal-alignment.prompt.ts](../../../backend/src/modules/knowledge-core/prompts/goal-alignment.prompt.ts) | 🟡 | ТЗ 2026-06-16 (linking), Прил. E4 | 2026-06-16 |
| `theme-classify` (пачка 7 — арбитр тем; роль + асимметрия «не натягивать» + 8 критериев + 4 few-shot (негат. «разнородный→none») + self-check + мэппинг ветка→enum (UI-ярлыки) + clients/sales-дискриминатор; снят ASR; signalType/entityType→ярлык) | [theme-classify.prompt.ts](../../../backend/src/modules/knowledge-core/prompts/theme-classify.prompt.ts) | 🟡 | ТЗ 2026-06-16 (cluster-rollup), Прил. E1 | 2026-06-16 |
| `idea-cluster-merge` (пачка 7 — арбитр кластеров идей; роль + асимметрия + 5 few-shot (2 негат.) + self-check + мэппинг enum + targetClusterId слово-в-слово; standalone смягчён (известное расхождение ≡new_cluster)) | [idea-cluster-merge.prompt.ts](../../../backend/src/modules/knowledge-core/prompts/idea-cluster-merge.prompt.ts) | 🟡 | ТЗ 2026-06-16 (cluster-rollup), Прил. E2 | 2026-06-16 |
| `card-rollup-v2` (пачка 7 — синтез сводной карточки, **ВСЕ 6 kind-констант**; роль-летописец + анти-галлюцинация + сохранность источника + темпоральность + 3+ few-shot на kind с негат. + self-check; имена-собственные технологий разрешены, коды нет; cardKind/signalType→ярлык) | [card-rollup-v2.prompts.ts](../../../backend/src/modules/knowledge-core/prompts/card-rollup-v2.prompts.ts) | 🟡 | ТЗ 2026-06-16 (cluster-rollup), Прил. E3 | 2026-06-16 |
| `idea-status-summarize` (пачка 7 — синтез уведомления о смене статуса идеи; роль-вестник + анти-галлюцинация + 4 few-shot (3 негат.: выдуманный прогресс/причина/тон) + self-check; oldStatus/newStatus→ярлык) | [idea-status-summarize.prompt.ts](../../../backend/src/modules/knowledge-core/prompts/idea-status-summarize.prompt.ts) | 🟡 | ТЗ 2026-06-16 (cluster-rollup), Прил. E4 | 2026-06-16 |
| `role-profile-build` (пачка 8 — синтез карты должности; роль-кадровик + people-hypothesis-обёртка + якоря + 4 few-shot (негат. пустой вход) + self-check + мэппинг 5 enum дословно + id ЦЕЛИКОМ + **3 deprecated-поля обязательны (required)**) | [role-profile-build.prompt.ts](../../../backend/src/modules/knowledge-core/prompts/role-profile-build.prompt.ts) | 🟡 | ТЗ 2026-06-16 (final-misc), Прил. E1 | 2026-06-16 |
| `reframing` (пачка 8 — ночное переосмысление графа, **2 константы**: блоки/темы; роль-куратор смысла + якоря (лог vs необратимо меняет граф) + 3 few-shot/проход (негат.) + self-check (направление merge: target остаётся); signalType из payload убрать) | [reframing.prompt.ts](../../../backend/src/modules/knowledge-core/prompts/reframing.prompt.ts) | 🟡 | ТЗ 2026-06-16 (final-misc), Прил. E2 | 2026-06-16 |
| `structured-document-compiler` (пачка 8 — компиляция орг-документа; роль-методист + анти-галлюцинация + сохранность при дополнении + 3 маркера + структуры по типам по-русски + 4 few-shot (негат. потеря при дополнении) + self-check; дубль режимов с note убран; kind→ярлык) | [structured-document-compiler.prompt.ts](../../../backend/src/modules/knowledge-core/prompts/structured-document-compiler.prompt.ts) | 🟡 | ТЗ 2026-06-16 (final-misc), Прил. E3 | 2026-06-16 |

> ✅ **МОДУЛЬ УСВОЕНИЯ (knowledge-core) ЗАКРЫТ: 31/31 промпт-агента переписаны по методологии** (пачки 1–8, без клон-агентов M5 — те ведёт другая сессия). Все 🟡 (текст готов, ждут реализации в коде + выката).

ТЗ выката: [plans/tz/2026-06-11-meeting-report-consolidation-graph-and-prompts.md](../../../plans/tz/2026-06-11-meeting-report-consolidation-graph-and-prompts.md) · [plans/tz/2026-06-14-dialog-layer-unified-query-understanding.md](../../../plans/tz/2026-06-14-dialog-layer-unified-query-understanding.md) · [plans/tz/2026-06-15-chat-v2-unified-answer-prompt.md](../../../plans/tz/2026-06-15-chat-v2-unified-answer-prompt.md) · [plans/tz/2026-06-16-clone-agents-prompt-revision.md](../../../plans/tz/2026-06-16-clone-agents-prompt-revision.md)

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
| knowledge-core: специалисты графа | 🟡 пачки 3–4 (ТЗ 2026-06-16 specialist-extractors): C1–C5 поблочные (decisions/ideas/insights/regulations/experiments) + D1–D4 (knowledge-clone-extract/merge, goal-extract, process-template-extract). 3-7 skill = skill-trait-detect (готов, клоны). 3-4 project-customer — projection-handler без LLM-промпта; 3-8 helpfulness / 3-12 personal-relation — только в combined (B3). **Группа промпт-агентов закрыта.** Осталась под-пачка целей-связей: goal-hierarchy-link, goal-task-link, goal-alignment, sprint-helper-suggest | 🟢 10/10 промпт-агентов |
| knowledge-core: ingest/distill | 🟡 пачки 1–2 (6 агентов: block-ingest, axis-classify, entity-merge-arbiter, block-distill, block-linker, специалист-routing — ТЗ 2026-06-16 ingest-prompts, Прил. A1–A3 + B1–B3 + общий словарь `signal-type-label.ts`); группа закрыта | 🟡 6/6 |
| Клоны / персоны (модуль M5) | 🟡 ВСЕ 12 🟣 clone-only агентов (пачки 1–4, ТЗ 2026-06-16 Прил. A–D); промпты закрыты, ждут реализации в коде + код-гарды Г1–Г4 | 🟡 12/12 (текст готов; общие 🔵-агенты — отдельная сессия) |
| Probe (уточняющие вопросы) | `probe-formulate` (✅ эталон методологии), probe-question | ⬜ |
| Chat / Chat-v2 | synthesize, стадии, query | 🟡 единый ответчик — ТЗ 2026-06-15; стадии/query — ещё ⬜ |
| Operations / Pulse | checkin-sentiment, meeting-speaker-analyzer, meeting-roi, decision-hygiene | ⬜ |
| Smart-tables | table-architect, table-auto-fill, table-extract-rows, table-infer-schema, table-semantic-filter | ⬜ |
| Документы | document-attribution-suggest, structured-document-compiler | ⬜ |
| Спринты | sprint-helper-suggest, sprint-review-summary | ⬜ |

> Когда заходим в группу — переносим её агентов в раздел «Сделано / в работе»
> поимённо, с файлами и статусами.
