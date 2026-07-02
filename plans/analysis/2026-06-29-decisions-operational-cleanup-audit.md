---
type: analysis
status: scope-decided
feature: decisions-operational-cleanup
date: 2026-06-29
owner: sergrv80@gmail.com
related:
  - plans/analysis/2026-06-27-task-decision-dashboard-control-model.md
  - plans/tz/2026-06-27-task-decision-execution-unified-tz.md
  - plans/analysis/2026-06-29-operational-inspectors-cleanup.md
  - plans/analysis/2026-06-25-tasks-vs-decisions-noise-audit.md
  - plans/analysis/2026-06-20-idea-vs-decision-disambiguation.md
---

# Решения: чистка оперативно-контрольного хвоста (аудит под модель «две оси»)

Полный разбор кода, который трактует **решение (Decision) как контролируемую оперативную единицу**, и план приведения его в порядок под целевую модель, где решение — это **пассивная сущность памяти/графа**, а оперативный контроль целиком живёт на задачах.

---

## 1. Что было решено

### Старая модель = «петля» (отвергнута)

Один объект нёс один из N взаимоисключающих ярлыков — «задача ИЛИ решение». Это **категориальная ошибка**: любая ошибка классификации вычитала работу из трекера (поручение, помеченное `decision`, переставало исполняться), ничего не отнимая у памяти. Диагноз и матрица вариантов — [plans/analysis/2026-06-27-task-decision-dashboard-control-model.md:51,84-122](../analysis/2026-06-27-task-decision-dashboard-control-model.md) (вариант D2-c — реактивный контролёр внедрения на 21 дне — **отвергнут окончательно как источник боли**).

### Новая модель = две ортогональные оси (зафиксирована владельцем 2026-06-27)

На каждое высказывание — две независимые оси:

1. **Ось ПАМЯТЬ** — «что это за высказывание?» (выбор/идея/факт/обещание) → богатая типизация `Decision`/`Idea`/`IdeaBlock` в графе знаний. **Не трогаем.**
2. **Ось ИСПОЛНЕНИЕ** — «влечёт ли это работу, которую надо довести до конца?» → `Task`/`Issue` (владелец/срок/статус) + журнал хода `IssueProgressUpdate`.

Оси ортогональны: «решили перейти на Postgres» = и решение (память), и задача «мигрировать» (исполнение). Объединение — это **не** `task=decision` (это убило бы память), а **снятие границы с пути исполнения**: actionable всегда даёт задачу независимо от типа в памяти. Реализовано PR #63 / `feature/task-decision-execution-unified` (Ф2 `60039787` — `Decision.impliesAction` → авто-заведение `Task` через `IntakeService(source=decision)` + дедуп + `DecisionTaskLink('derived')`).

### Роль Decision в новой модели

`Decision` — **богатая пассивная сущность памяти/графа**: `rationale`, `alternatives`, `status`, supersede-связи, извлечение из ингеста, секция решений в отчёте встречи, различение decision↔idea, `DecisionTaskLink` как провенанс «решение→порождённая задача». Оперативный контроль (ответственный/срок/просрочка/итог/ход) живёт **исключительно на задаче**. Решение **не** является единицей контроля и **не** порождает вопросов Коры.

Формулировка владельца 2026-06-29 ([plans/analysis/2026-06-29-operational-inspectors-cleanup.md](../analysis/2026-06-29-operational-inspectors-cleanup.md), `status: decided`): «Решение остаётся пассивной сущностью в памяти/графе — мы за ним НЕ следим и вопросов про него не задаём. Оперативный контроль уже целиком на задачах.»

---

## 2. Корень беспорядка

Модель «две оси» внедрялась поэтапно, и ТЗ от 2026-06-27 **намеренно оставило оперативно-decision-остатки** как компромисс:

- (а) `decisions/throughput` + `decisions/stalled` переведены из ежедневной очереди контроля в **недельную метрику-утечку** «N решений не превратились в действие» (D3-b, control-model §5/§6);
- (б) реактивный крон-21 (`DecisionImplementationCron`) оставлен **«как нижняя страховка»** ([plans/tz/2026-06-27-task-decision-execution-unified-tz.md:48,209-218](../tz/2026-06-27-task-decision-execution-unified-tz.md), R21 «throughput/stalled остаются — не удалять»).

Владелец 2026-06-29 решил убрать **инспектор решений целиком** (probe + проактивный нудж `decision_no_owner` — самый частый нудж, ~17 дней подряд). Это первый чёткий шаг дальше ТЗ. Но §5 removal-документа **явно оставляет открытой развилку** по «смежному пласту» — дашборд-контрольным поверхностям решений. Дословно: «Фраза владельца "не контролируем" МОЖЕТ означать снести и это. Решается отдельно… фиксирую как открытый вопрос, чтобы не расширять scope удаления инспектора.»

Итог: вектор однозначен — **убрать решение из оперативного управления и почистить хвост 21-дня**, но финальный вердикт по дашборд-поверхностям и недельной метрике ещё за владельцем (см. §5).

---

## 3. Главная таблица инвентаря

`21д` = touches21Day (след `decision.stale_days` / `DEFAULT_DECISION_STALE_DAYS=21` / `implementationStatus='stalled'` / `DecisionImplementationCron`).

### A. remove-operational — старая оперативка решений (вне 21-дня)

| path:line | symbol | роль | 21д | что делать |
|---|---|---|---|---|
| backend/.../dashboard/services/hanging-decisions.service.ts:16-147 | HangingDecisionsService | «висящие решения» (proposed/approved/active, age≥7д, raisedCount≥2) — ежедневный KPI | нет | удалить сервис целиком |
| backend/.../dashboard/services/director-dashboard.service.ts:233-237,193,71-72,33 | kpiHangingDecisions + safe('hangingDecisions') | KPI-плитка «висящие решения» на главном дашборде | нет | удалить KPI + вызов |
| backend/.../dashboard/dto/director-dashboard.dto.ts:153 | DirectorDashboardDto.kpiHangingDecisions | контракт KPI висящих решений | нет | удалить поле |
| backend/.../dashboard/services/team-health.service.ts:117-181,259,41,65-66 | decisions / decisionsByDept / toneDecisions / listHangingWithAuthors | здоровье отдела по числу висящих решений | нет | удалить атрибут decisions |
| backend/.../operations/services/decision-implementation.service.ts:167 | allLinkedTasksCompleted() | проверка для авто-implemented | нет | удалить с сервисом |
| backend/.../operations/services/weekly-digest.service.ts:667,769,985,1117,1151 | hangingDecisions / hanging_decisions / buildLinearForecast / shiftToDto | «зависшие решения» недели (decidedAt<weekStart-7, outcomes null) + прогноз | нет¹ | вырезать hanging_decisions из дайджеста+прогноза |
| backend/.../operations/dto/weekly-digest.dto.ts:17,53,78 | hangingDecisions[] / metric 'hanging_decisions' | контракты зависших решений недели | нет¹ | удалить поля/enum |
| backend/.../activity-feed/services/cora-feed.service.ts:577 | prisma.decision.count в countByType | счётчик решений в фид-навигаторе | нет | переадресовать в «Память» (см. adjust) |
| second-brain/01_projects/director-dashboard.md:129,138 | DecisionThroughputWidget, team-health.decisions | описание оперативных decision-виджетов | нет | удалить строки после снятия кода |
| second-brain/02_architecture/module-map.md:2487 | team-health.decisions, DecisionThroughput на доске | карта модуля dashboard/operations | нет | обновить после снятия |
| frontend/.../dashboard/operations/widgets/DecisionThroughputWidget.tsx:25,47,104 | DecisionThroughputWidget | «Доведение решений» % + «застряло без движения» | да | удалить виджет |
| frontend/.../dashboard/operations/OperationsDashboardClient.tsx:279 | <DecisionThroughputWidget/> | монтаж в секцию «Риски» | да | снять монтаж |
| frontend/src/domain/decision-throughput.ts:17,37 | fromDecisionThroughputApi / fromStalledDecisionsApi | мапперы throughput/stalled | да | удалить файл |
| frontend/src/api/operations-dashboard.api.ts:376,385,224 | getDecisionThroughput / getStalledDecisions / StalledDecisionApi | вызовы оперэндпоинтов | да | удалить |
| frontend/.../dashboard/registry/widgets/DecisionsWidget.tsx:31,69 | DecisionsWidget (особ. daily «Решения без действия») | решения в ежедневной очереди — нарушение D3-b | да | удалить (минимум daily-ветку) |
| frontend/.../dashboard/registry/presets.ts:11,47 | owner/coo today → "decisions" | решения в today-пресете | да | убрать today-вхождения |
| frontend/.../dashboard/registry/widget-registry.ts:142 | WIDGET_REGISTRY.decisions (rhythm today/week/month) | реестр виджета | да | убрать минимум 'today' |

¹ собственный порог 7д + raisedCount≥2, не `decision.stale_days`; но та же стейл-семантика решений.

### B. Механика 21-дня — выделенный кластер (всё remove-operational, 21д=да)

Это **осиротевший хвост старой модели «решение = контролируемая единица»** (D2-c, отвергнут окончательно). Происхождение: введено в `plans/tz/2026-06-08-agents-daily-value-engine.md` Фаза 3.B. Снимается **пакетом** — всё взаимосвязано.

| path:line | symbol | роль | что делать |
|---|---|---|---|
| backend/.../operations/services/decision-implementation.scoring.ts:3 | DEFAULT_DECISION_STALE_DAYS = 21 | порог стейла решения | удалить |
| backend/.../operations/services/decision-implementation.scoring.ts:5 | isDecisionStalled() | предикат «решение застряло» | удалить |
| backend/.../operations/services/decision-implementation.scoring.ts:16 | classifyImplementationStatus() | not_started/in_progress/done/stalled | удалить |
| backend/.../operations/services/decision-implementation.scoring.ts:54 | decisionThroughputPercentForStatus() | статус→% | удалить |
| backend/.../operations/services/decision-implementation.scoring.ts:65 | decisionStatusSortRank() | сортировка по статусу внедрения | удалить |
| backend/.../operations/services/decision-implementation.service.ts:26,29,38 | DecisionImplementationService / CONTROLLED_STATUSES / computeForTenant() | сервис-контролёр внедрения целиком | удалить |
| backend/.../operations/services/decision-implementation.service.ts:255,287,326 | resolveMonthDecisionStatus / listStalledForTenant / resolveStaleDays | статус месяца, stalled-список, чтение крутилки | удалить |
| backend/.../operations/workers/decision-implementation.cron.ts:11,25,106 | DecisionImplementationCron @Cron('0 6 * * *') / флаг enabled / notifyResponsible | ежедневный крон + пуш «Решение не двигается» | удалить |
| backend/.../operations/controllers/operations-dashboard.controller.ts:400,84 | GET decisions/stalled / inject DecisionImplementationService | эндпоинт + зависимость | удалить |
| backend/.../operations/dto/execution-agents.dto.ts:52 | StalledDecisionDto / StalledDecisionsListDto | DTO (ageDays, implementationCheckedAt) | удалить |
| backend/.../operations/operations.module.ts:153,154,186 | providers/exports DecisionImplementationService+Cron | регистрация | удалить |
| backend/.../operations/services/value-recap.service.ts:255 | resolveMonthDecisionStatus (потребление) | навешивание stalled на recap | удалить |
| backend/.../activity-feed/services/cora-feed.service.ts:189,219,224,740 | collectDecisions / impl=='stalled'→risk / implLabel() | решение как risk-айтем фида по implementationStatus | удалить |
| backend/.../activity-feed/services/cora-feed.service.spec.ts:235 | тест 'decision stalled → risk' | закрепляет снимаемую семантику | удалить тест |
| backend/.../common/metrics/business-metrics.service.ts:1886,5189 | decisionStalledTotal / incDecisionStalled | метрика «решение stalled» | удалить |
| backend/prisma/schema.prisma:6493 | Decision.implementationStatus | поле контролёра | миграция-удаление (см. §6) |
| backend/prisma/schema.prisma:6496 | Decision.implementationCheckedAt | служебное поле крона | миграция-удаление |
| backend/.../admin/settings/admin-setting-schema-registry.ts:258 | 'decision.stale_days' (POSITIVE_INT) | крутилка 21-дня | удалить строку |
| backend/.../admin/settings/admin-setting-schema-registry.ts:259 | 'operations.decision_controller.enabled' | kill-switch контролёра | удалить строку |
| backend/scripts/seed-admin-setting-execution-agents.ts:136,145 | seed decision.stale_days=21 + флаг | сид крутилок | удалить из сида |
| docs/operations/feature-flags.md:94 | operations.decision_controller.enabled (🟢 ВКЛ) | реестр флагов | удалить строку |
| docs/operations/prod-deploy-log.md:1819-1837,1373 | блок выката контролёра + smoke decisions/stalled | прод-инструкция | откатить/удалить блок |

### C. adjust — переехать/обновить (память остаётся, контрольная часть снимается)

| path:line | symbol | роль | 21д | что делать |
|---|---|---|---|---|
| backend/.../operations/services/decision-implementation.service.ts:206 | listDecisionsForMonth() | список решений месяца + implementationStatus | да | оставить список, снять статус-внедрения |
| backend/.../operations/services/value-recap.service.ts:42,317 | inject DecisionImplementationService / computeDecisions() | список решений месяца + status/throughputPercent | да | перецепить на источник памяти, снять контрольные поля |
| backend/.../operations/services/value-recap.scoring.ts:24 | ValueRecapDecision{status, throughputPercent} | строка решения recap | да | оставить id/statement, убрать status/throughputPercent |
| backend/.../operations/dto/weekly-digest.dto.ts:33 | WeeklyDigestSourcesDto.decisionIds[] | provenance id решений недели | нет | наполнение меняется при выносе hanging |
| backend/.../operations/services/daily-digest.service.ts:1072 | decisionsToday → kind:'decision' | решения дня со ссылкой /decisions/:id | нет | переезд в раздел «Память» (D3-b), не в ежедневную ленту |
| backend/.../activity-feed/services/cora-feed.service.ts:577 | decision.count | счётчик типа фида | нет | в «Память» |
| backend/prisma/schema.prisma:6490 | Decision.linkedTaskCount | денорм-счётчик DecisionTaskLink | да | связь-провенанс оставить, stalled-использование убрать |
| backend/scripts/backfill-decision-linked-task-count.ts | backfill linkedTaskCount + DecisionTaskLink | бэкфилл связей | да | связи оставить, оперативную часть пересмотреть |
| backend/.../tracker/services/decision-task-link.util.ts:99-146 | maybeMarkDecisionsImplementedForIssue | авто-переход Decision→implemented по закрытию задач | нет | оставить как пометку памяти, убрать как «доведение решений» |
| frontend/src/ui/mobile/exec/overview-zones.ts:50 | requiresYouCount → c.decision | решение в ежедневной очереди «требует вас» | нет | исключить категорию decision из ежедневного счётчика |
| second-brain/01_projects/director-dashboard.md:183-190 | §Ф4 R19/R20/R21 | промежуточная модель (решения как недельная аналитика) | да | переписать после чистки |
| second-brain/01_projects/decisions.md:201 | пункт «Дашборд Ф4: знаменатель доведения» | привязка impliesAction к throughput | да | обновить (остальной §Ф2 — keep) |
| second-brain/02_architecture/data-model.md:434 | хвост «Дашборд Ф4 использует impliesAction как знаменатель» | описание полей | да | убрать хвост про stalled/throughput |
| second-brain/01_projects/workers-queues.md:115 | task-reconcile «образец DecisionImplementationCron» | ссылка-образец | да | переформулировать (крон снимается) |
| backend/.../tracker/services/task-reconcile.service.ts:27 | комментарий-ссылка на DecisionImplementationService | пример паттерна (R13: решений не трогает) | нет | поправить текст комментария |
| docs/operations/prod-deploy-log.md:211,208,1373 | Шаги Ф4 (decision-implementation += impliesAction, DecisionsWidget, миграция) | прод-rebuild Ф4 | да | переписать строки |
| second-brain/04_не-сделано/README.md:65,67,133 | бэкфилл impliesAction / UI outcome-capture / orphan контролёр | открытые пробелы под снимаемые метрики | да/нет | убрать/скорректировать строки |

### D. investigate — нужно решение владельца (см. §5)

| path:line | symbol | роль | 21д | развилка |
|---|---|---|---|---|
| backend/.../operations/services/decision-implementation.scoring.ts:39 | computeDecisionThroughput() | % решений до результата | нет | недельная аналитика или удалить |
| backend/.../operations/services/decision-implementation.service.ts:182 | getDecisionThroughput() | питает throughput-эндпоинт+recap | нет | то же |
| backend/.../operations/controllers/operations-dashboard.controller.ts:371 | GET decisions/throughput | эндпоинт COO-дашборда | нет | то же |
| backend/.../operations/dto/execution-agents.dto.ts:29,44 | DecisionThroughputQuerySchema / Dto | контракт throughput | нет | судьба эндпоинта |
| backend/.../operations/services/value-recap.service.ts:286 | computeTeam(): getDecisionThroughput | командные метрики recap | нет | оставить недельной или убрать |
| backend/.../operations/services/value-recap.scoring.ts:18 | ValueRecapTeam{decisionsTotal, decisionsThroughputPercent} | throughput-поля recap | нет | то же |
| backend/.../common/metrics/business-metrics.service.ts:1891,5194 | decisionThroughputPercent gauge | метрика-витрина Ф5 | нет | adjust→weekly или remove |
| backend/.../common/metrics/business-metrics.service.ts:1911,5220 | decisionAutoImplementedTotal | авто-переход approved→implemented | да | часть жизненного цикла implementationStatus |
| backend/.../operations/services/daily-digest.service.ts:960,1113 | raisedDecisions → kind:'raised_decision' | повторно поднятый вопрос (raisedCount≥2) | нет | контроль нерешённости, не 21-день |
| backend/.../operations/dto/daily-digest.dto.ts:100 | urgentItems kind 'raised_decision' | enum срочного айтема | нет | то же |
| backend/.../dashboard/agents/decision-hygiene-scorer.worker.ts:24-203 | DecisionHygieneScorerWorker (Bezos type-1/2, reversibility) | пишет reversibility в Decision; питает irreversibleDecisions | нет | качество памяти vs алерт-гигиена |
| backend/.../dashboard/prompts/decision-hygiene.prompt.ts | DECISION_HYGIENE_SYSTEM_PROMPT + JSON-схема + парсер | контракт скоринга обратимости | нет | судьба = судьба скорера/алерта |
| backend/.../dashboard/queues.ts:5 | DECISION_HYGIENE queue + JobData | очередь скоринга гигиены | нет | то же |
| backend/.../dashboard/services/dashboard-queue.service.ts:71-80 | enqueueDecisionHygiene() | постановщик скоринга | нет | то же |
| backend/.../knowledge-core/workers/specialist-3-3-decisions.worker.ts:89-126 | enqueueHygieneForBlock | ставит блок на скоринг гигиены | нет | то же |
| backend/.../dashboard/services/pulse-patterns.service.ts:544-581 + dto/pulse-patterns.dto.ts:106-116 | getIrreversibleDecisions + DTO | недельный паттерн type-1 решений + alertCount | нет | срез памяти о критичных vs алерт |
| backend/.../dashboard/agents/forecaster.cron.ts:136,153-161,205-212 + prompts/forecaster.prompt.ts:63-67 | hanging_decisions как тренд прогноза | недельный прогноз метрики | нет | заменить/убрать метрику |
| frontend/src/ui/components/dashboard/IrreversibleDecisionsAlert.tsx:13 | IrreversibleDecisionsAlert | «N необратимых решений без альтернатив» | нет | гигиена памяти vs дашборд-алерт |
| frontend/src/domain/value-recap.ts:128,120,239 | ValueRecapDecision / decisionProgressTone / decisionsThroughputText | статусы внедрения + % доведения в recap | да | судьба recap-метрики |
| frontend/.../dashboard/value-recap/ValueRecapDashboardClient.tsx:330,376 | «Решения доведены» / DecisionsBlock «дисциплина решений» | месячная витрина дисциплины решений | да | оставить недельной/месячной или убрать |
| frontend/.../dashboard/registry/presets.ts:27,60,76,96 | owner/coo week+month → "decisions" | виджет в недельном/месячном пресетах | да | зависит от судьбы DecisionsWidget |
| frontend/src/domain/director-dashboard.ts:126 | signalCounters.decision + label «Решение» | категория сигнала «требует действия» | нет | убирать ли decision из requiresAction |
| frontend/src/lib/nav-help.ts:17 | nav-help "/month" «…доведённые решения…» | подсказка витрины месяца | нет | поправить текст при удалении метрики |
| backend/.../decisions/dto/decisions.dto.ts:17 + services/decisions.service.ts:518-525 | DeadlineFilterSchema 'overdue' + buildWhere | фильтр «просроченные решения» | нет | контроль исполнения на решении? |
| second-brain/01_projects/decisions.md:50,52,170-175 | probe decision.overdue / outcome_unknown / runDailyChecks | probe-крон по решениям (НЕ 21-день) | нет | оперпинки по решениям — снимать ли |
| backend/.../onboarding/demo-data/operations.ts:1177 | sourcesJson{decisions:1} | demo-счётчик решений в дневном дайджесте | нет | оставить ли decisions в дневном |
| backend/.../onboarding/demo-data/pulse-snapshots.ts:123 | hasImplementedDecision:false | demo-флаг «доведено ли решение» (windowDays:21 — окно топика, НЕ stale_days) | нет | оставить ли pulse-сигнал внедрения |
| second-brain/04_не-сделано/README.md:235 | mention-based decision auto-implement | отложенный авто-перевод решения | нет | нужен ли вообще |
| backend/prisma/schema.prisma:6498,6499 | Decision.impliesAction + actionExtractedAt | маркеры оси ИСПОЛНЕНИЕ на записи решения | нет | провенанс-флаг деривации (keep?) vs контроль |

### E. keep-memory — оставить как память (НЕ трогать; кратко)

Ядро «решение как знание/граф», провенанс и governance — изменениям не подлежат:

- **Сущность и CRUD/граф:** `schema.prisma:7653` DecisionTaskLink (провенанс), `decisions/decisions.controller.ts:58-272`, `decisions/dto/decisions.dto.ts:5-153`, `decisions/services/decisions.service.ts:184-198,373-381`, `frontend/src/domain/decision.ts:96,19`, `frontend/src/api/decisions.api.ts:109`, `decisions/page.tsx`, `DecisionsListClient.tsx:37`, `common/graph/graph.types.ts:20`, `common/graph/graph.service.ts:361-766`.
- **Извлечение/различение:** `knowledge-core/services/specialist-3-3-decisions.service.ts:1090-1106,1504-1583` (включая мост `maybeEnqueueActionableTask` — целевая модель), `prompts/decision-extract.prompt.ts`, `decision-supersede-detect.prompt.ts`, `insight-link-to-decisions.prompt.ts`, `task-decision-examples.ts`, `block-ingest.prompt.ts:330-445`, `block-extraction.service.ts:230`, `tracker/services/decision-task-link.util.ts:3-97`, `tracker/services/intake.service.ts:817`.
- **Источники решений вне pipeline:** `messaging/services/message-actions.service.ts:70` (messageToDecision), `messaging/services/poll.service.ts:289` (решение из голосования), `messaging/conversation.controller.ts:353`, `messaging/dto/conversation.dto.ts:99`.
- **Доступ/связи:** `search/search.service.ts:490`, `insights/services/insights.service.ts:343` + `dto/insights.dto.ts:84` + `frontend/.../insights/InsightsListClient.tsx:587`.
- **Governance (НЕ Decision-сущность):** role-map decision-policies (`role-map.controller.ts:331`, `dto:125`, `frontend/src/api/role-map.api.ts:54`, `RoleMapCards.tsx:212`); processes decision-points (`processes.controller.ts:196`, `dto:104`, `ProcessTemplatesClient.tsx:718`, `processes.api.ts:30`); `dataclass-policy.service.ts:24`.
- **Память-метрики и витрины (count извлечения, не контроль):** `value-recap.service.ts:219` decisionsExtracted, `value-recap.scoring.ts:4`, `business-metrics.service.ts:2562` supersedeChainLength, `dashboard/services/director-dashboard.service.ts:699-769,600-639` (decisionsExtracted, signalCounters.decision), `narrative-citations-parser.service.ts:91`, `sample-story.dataset.ts:56-66`, `frontend/src/ui/mobile/exec/MobileOverviewClient.tsx:160`, `frontend/src/lib/nav-help.ts:73`.
- **Отчёт встречи / память дня-месяца:** `meeting-result-v2/DecisionsSection.tsx:27`, `MobileMemoryClient.tsx:39`, `daily-digest.service.ts:576,928` (решения дня как событие памяти), `monthly-digest.service.ts:268` + `dto:16`, `month-company/MonthDecisions.tsx:8` («Что решить собственнику» — НЕ Decision-сущность), demo `onboarding/demo-data/meetings.ts:88` + `knowledge-graph.ts:63`.
- **Прочее governance/исполнение:** `pending-actions/providers/task-review.provider.ts:22` (контроль ЗАДАЧ после supersede, не решений), concierge `assistant-confirm-classify.prompt.ts:4` + `assistant-channel.bridge.ts:349` («decision» = вердикт классификатора реплики, не бизнес-решение).

**Ловушки — НЕ путать (не входят в scope):** `dashboard.stuck.staleDaysThreshold=5` (`execution-dashboard.service.ts:402`) и `daily-checkin.staleDaysThreshold` — это стейл **задач/чек-инов**, а не решений; `GoalProgressStatus 'stalled'` — про цели.

---

## 4. Что уже решено vs открыто

**Решено владельцем (вектор однозначен):**
- Probe-инспектор решений целиком (`Specialist33ProbeService`, cron `@Cron('0 5 * * *')`, on-ingest хуки) + проактивный нудж `decision_no_owner` + поводы `decision.*` — на удаление ([2026-06-29-operational-inspectors-cleanup.md §1](../analysis/2026-06-29-operational-inspectors-cleanup.md)). *Это отдельная поверхность (concierge/probe), пересекается с данным аудитом только по вектору; ТЗ на неё ведётся по removal-доку.*
- Хвост 21-дня (D2-c) — отвергнут окончательно ещё ТЗ 2026-06-27.

**Открыто (см. §5):** дашборд-контрольные поверхности решений и недельная метрика-утечка.

---

## 5. SCOPE-развилка для владельца

> **✅ РЕШЕНИЕ ВЛАДЕЛЬЦА (2026-06-29): Вариант 1 — полная чистка.** Убрать всю оперативную часть решений, включая недельную/месячную метрику «доведение/застряло», эндпоинт `decisions/throughput` и `%` доведения в value-recap. Весь блок D переходит в **remove** (кроме гигиены, см. ниже). Решение становится строго пассивной памятью — ровно формулировка «за решением не следим».
> **✅ Микро-вопрос гигиены решений:** сохранить признак обратимости (Bezos type-1/type-2) как **атрибут качества памяти** на карточке решения — `decision-hygiene-scorer` + промпт + очередь + `enqueueHygieneForBlock` **остаются** (наполняют атрибут `Decision`), но **убрать дашборд-алерт** `IrreversibleDecisionsAlert.tsx` и pulse-срез `getIrreversibleDecisions`. Это единственный пункт блока D, остающийся как память.

Removal-документ §5 оставлял это нерешённым — **теперь закрыто** (см. блок выше). Ниже — обоснование вариантов (для истории).

### Вариант 1 — полная чистка (рекомендую)

Убрать **всю** оперативную часть решений, включая недельную аналитику throughput и крон-21-страховку. Решение становится строго пассивной памятью — ровно формулировка владельца «мы за ним не следим».

**Затрагивает дополнительно к блокам A+B (которые удаляются при любом варианте):** весь блок D переводится в **remove** — `computeDecisionThroughput`/`getDecisionThroughput`/`GET decisions/throughput` + DTO (`execution-agents.dto.ts:29,44`), `decisionThroughputPercent` gauge (`business-metrics.service.ts:1891`), `decisionAutoImplementedTotal`, value-recap throughput (`value-recap.service.ts:286`, `value-recap.scoring.ts:18`, `frontend/src/domain/value-recap.ts:128,239`, `ValueRecapDashboardClient.tsx:330,376`), `decision-hygiene-scorer.worker.ts` + промпт + очередь + `enqueueHygieneForBlock`, `IrreversibleDecisionsAlert.tsx` + `pulse-patterns getIrreversibleDecisions`, forecaster `hanging_decisions`-тренд, week/month вхождения в `presets.ts`/`widget-registry.ts`, `raised_decision` в daily-digest, фильтр `'overdue'` на решениях, probe decision.overdue/outcome_unknown.

- **Плюсы:** одна непротиворечивая модель — ноль оперативного контроля над решениями; нет «осиротевших» виджетов, которые завтра снова начнут шуметь; меньше кода, метрик, прод-операций для поддержки; полностью устраняет «петлю». Согласуется с уже принятым полным сносом инспектора обещаний (для консистентности removal-док склоняется к тому же по решениям).
- **Минусы:** теряем недельную/месячную аналитику «N решений не превратилось в действие» и «дисциплина решений %» — если она реально читалась владельцем как ценность; `decision-hygiene`/«необратимые решения» — потенциально полезный риск-флаг **качества памяти** (Bezos two-way-door), который не про контроль исполнения, — уйдёт вместе с алертом. Больший diff и больше прод-шагов на откат.

### Вариант 2 — мягкая чистка

Убрать только **ежедневное** (today-виджеты, daily-feed risk, requiresYou) и **крон-21** (с пушами), но **оставить недельный индикатор-утечку** throughput/stalled как чистую аналитику (без ежедневной очереди и без пушей) — ровно компромисс ТЗ 2026-06-27 (D3-b).

**Затрагивает:** блоки A+B удаляются **кроме** недельных потребителей throughput; блок D в части throughput/recap/hygiene/irreversible — **остаётся** (как недельная аналитика), правится только перевод «ежедневное → недельное».

- **Плюсы:** сохраняет витрину ценности «сколько решений зависло» на недельном/месячном горизонте; меньший diff; не теряем decision-hygiene/«необратимые решения» как качество памяти.
- **Минусы:** **противоречит прямой формулировке владельца** «за решением НЕ следим и вопросов про него не задаём» — недельная метрика-утечка всё равно есть форма надзора за решением как единицей; оставляет stalled-механику (поля `implementationStatus`/`implementationCheckedAt` в схеме, крутилку — частично), то есть «петля» не закрыта до конца; риск, что осиротевший недельный код снова обрастёт ежедневными хуками.

### Рекомендация

**Вариант 1 (полная чистка).** Причины: (1) он буквально соответствует решению владельца 2026-06-29 и снятию инспектора обещаний «целиком, включая дашборд»; (2) убирает источник «петли» под корень, а не оставляет дремлющий хвост; (3) проще поддерживать одну модель, чем гибрид «решение пассивно, но недельно мы за ним всё-таки следим». Единственное, что стоит **вынести в отдельный микро-вопрос** даже внутри Варианта 1: `decision-hygiene` / «необратимые решения» — это не контроль исполнения, а **качество знания**; если владелец видит в нём ценность как в риск-флаге памяти, его можно сохранить **как атрибут памяти на карточке решения** (reversibility), убрав лишь дашборд-алерт и очередь-скоринг. Это единственный пункт блока D, у которого есть keep-memory-трактовка.

---

## 6. Риски и зависимости

- **DTO дашборда:** удаление `kpiHangingDecisions` (`director-dashboard.dto.ts:153`), `StalledDecisionDto`/`DecisionThroughputDto` (`execution-agents.dto.ts:44,52`), `hangingDecisions[]`/`hanging_decisions` (`weekly-digest.dto.ts:17,53,78`) — это изменение API-контракта. Фронт-потребители (`operations-dashboard.api.ts`, `DecisionThroughputWidget`, `DecisionsWidget`, domain-мапперы) удаляются синхронно — иначе TS-сборка фронта красная. Снимать backend+frontend одной фазой.
- **Миграция Prisma:** `Decision.implementationStatus` (`schema.prisma:6493`) и `implementationCheckedAt` (`:6496`) — кандидаты на удаление (Вариант 1). Поля `impliesAction`/`actionExtractedAt` (`:6498-6499`) и `linkedTaskCount` (`:6490`) — **оставить** (ось ИСПОЛНЕНИЕ / провенанс). Любое изменение схемы = файл миграции (`prisma:migrate`), ревью SQL, авто-применение на проде через `migrate deploy`. Прод почти пуст (~4 юзера) — drop колонок дёшев. `DecisionTaskLink` (`:7653`) — **не трогать**.
- **Demo/seed-data:** `seed-admin-setting-execution-agents.ts:136,145` (крутилки) удалить из сида; `demo-data/operations.ts:1177` и `pulse-snapshots.ts:123` — investigate (правка demo-флагов внедрения). `backfill-decision-linked-task-count.ts` — связи оставить.
- **Тесты:** `decision-implementation.scoring.spec.ts`, `.service.spec.ts`, `value-recap.scoring.spec.ts`, `weekly/daily/monthly-digest.*.spec.ts`, `cora-feed.service.spec.ts:235` — разделяют классификацию своего кода: удаляются/правятся вместе с прод-кодом, не отдельными пунктами.
- **Метрики:** снятие `decision_stalled_total` (и в Варианте 1 — `decision_throughput_percent`, `decision_auto_implemented_total`) ломает дашборды Prometheus/Grafana, если они эти ряды читают — проверить.
- **Прод-деплой:** `docs/operations/prod-deploy-log.md:1819-1837,211,208,1373` и `feature-flags.md:94` — обновить (откат блока контролёра, удаление флага из реестра). Регистрация в `apply-prod-deploy.ts STEPS` сида `seed-admin-setting-execution-agents.ts` — пересмотреть.
- **Мульти-тенант:** не задет. Удаляемые поверхности — общие сервисы/крон/виджеты, изоляция по `tenantId` сохраняется в оставшихся memory-путях без изменений.
- **plans/tz и plans/analysis:** R19-R21 в ТЗ 2026-06-27 и матрица D2-c/D3-b в control-model — это контракты/доказательная аналитика; **не переписывать задним числом**, новое решение надстраивается отдельным ТЗ с пометкой «надстроено».

---

## 7. Следующий шаг

После одобрения развилки (§5) → **ТЗ на чистку** (скилл `tz-author`):

1. ✅ Вариант зафиксирован: **Вариант 1 (полная чистка)**; гигиена решений — обратимость остаётся атрибутом памяти, дашборд-алерт `IrreversibleDecisionsAlert` + pulse `getIrreversibleDecisions` убираются (см. §5).
2. Картография точных вызовов при ТЗ (импорты `DecisionImplementationService`/`HangingDecisionsService`, потребители удаляемых DTO-полей, ряды метрик в Grafana).
3. Фазы: (Ф1) backend operations-контролёр + 21-день + метрики + крутилки; (Ф2) dashboard hanging/team-health/KPI; (Ф3) фронт-виджеты + presets + domain + api; (Ф4) миграция схемы (drop полей); (Ф5) doc-синхронизация (second-brain + feature-flags + prod-deploy-log + 04_не-сделано); (Ф6 опц.) перенос «решений дня» в раздел «Память».
4. Снять связку с removal-доком инспектора (probe/нудж) — это смежное ТЗ, чтобы не дублировать поверхности.
