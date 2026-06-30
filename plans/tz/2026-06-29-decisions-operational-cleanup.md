---
type: tz
status: ready-to-implement
feature: decisions-operational-cleanup
date: 2026-06-29
owner: sergrv80@gmail.com
relates_to:
  - plans/architecture/2026-06-29-decisions-operational-cleanup.md
  - plans/analysis/2026-06-29-decisions-operational-cleanup-audit.md
  - plans/analysis/2026-06-29-operational-inspectors-cleanup.md
  - plans/analysis/2026-06-27-task-decision-dashboard-control-model.md
  - second-brain/01_projects/decisions.md
---
> Архитектура (одобрена владельцем 2026-06-29): `plans/architecture/2026-06-29-decisions-operational-cleanup.md` (`status: approved`) · Полный инвентарь (186 пунктов / 82 файла): `plans/analysis/2026-06-29-decisions-operational-cleanup-audit.md` · Статус согласования: одобрено 2026-06-29.

# ТЗ: чистка оперативно-контрольного хвоста «решений» (Вариант 1 — полная чистка)

## Цель

Снять с продукта весь слой, который трактует **решение (`Decision`) как контролируемую оперативную единицу**, и оставить решение **пассивной сущностью памяти/графа**. Оперативный контроль целиком на задачах (модель «две оси», `plans/analysis/2026-06-27-task-decision-dashboard-control-model.md`).

Убираем: контролёр внедрения решений (крон 21-день + сервис + scoring), эндпоинты `decisions/throughput`/`decisions/stalled`, метрику «доведения» в value-recap, KPI/виджет «висящие решения», team-health по решениям, дашборд-алерт «необратимые решения» + pulse-срез, риск-айтем «решение застряло» в ленте, метрики Prometheus `decision_*`, крутилки `decision.stale_days`/`operations.decision_controller.enabled`, поля `Decision.implementationStatus`/`implementationCheckedAt`, и **все упоминания решений в оперативных отчётах** (дневной/недельный/месячный дайджест + «День/Неделя/Месяц компании», блок «Решения дня»).

Оставляем нетронутым: сущность `Decision`, раздел/карточку/граф, извлечение из встреч/чатов, `DecisionTaskLink` + авто-заведение задачи из actionable-решения, секцию решений в отчёте встречи, `decision-hygiene`-скорер (наполняет атрибут обратимости). Дополнительно (Р5): показать признак обратимости тихой пометкой на карточке решения.

## Зачем (болезненное состояние)

«Петля» старой модели (взаимоисключающий ярлык «задача ИЛИ решение») снята по сути, но в коде остался хвост надзора: крон-21 шлёт владельцу пинки про «застрявшие решения», дашборд показывает «доведение решений %», лента — «решение застряло», а Кора почти ежедневно дёргает про решения. Это надзор за единицей, за которой владелец сознательно **больше не следит** — шум без ценности. `[verified: operational-inspectors-cleanup.md §1; decision_no_owner ~17 дней подряд]`

## REALITY-CHECK (по коду 2026-06-29; полная картография — в анализе)

- **Контролёр внедрения** (`decision-implementation.{cron,service,scoring}.ts`) — единственный writer полей `Decision.implementationStatus`/`implementationCheckedAt`; READERS только: сам сервис, `cora-feed.service.ts` (select :209), `execution-agents.dto.ts` (тип `StalledDecisionDto` :57). После удаления файлов + правки `cora-feed` — DROP колонок безопасен. `[verified]`
- **value-recap** потребляет контролёр: `value-recap.service.ts` (`import`+`inject DecisionImplementationService`, `computeDecisions`/`computeTeam`), `value-recap.scoring.ts` (типы `ValueRecapTeam.decisionsThroughputPercent`, `ValueRecapDecision{status,throughputPercent}`), `value-recap-narrative.prompt.ts`, `value-recap-export.ts`. Удаление сервиса требует **синхронной** правки всех — иначе TS-каскад. `decisionsExtracted` (счётчик извлечения) — **KEEP**, не путать с `decisionsThroughput`. `[verified]`
- **Ловушка: позиционный DI.** `HangingDecisionsService` — позиционный аргумент конструктора `DirectorDashboardService` (:71-72) и `TeamHealthService` (:65-66). ВСЕ 5 `director-dashboard.*.spec.ts` + `team-health.service.spec.ts` конструируют сервис позиционно (`{} as unknown as ...`) → удаление аргумента **обязательно синхронно во всех спеках**, иначе аргументы съезжают. `[verified]`
- **decision-hygiene-скорер ОСТАЁТСЯ.** `decision-hygiene-scorer.worker.ts:165-170` пишет `Decision.reversibility`+`reversibilityAt` (schema :6480-6485). На :173-191 только лог-warn, метрики-алерта нет. Скорер/промпт/очередь `DECISION_HYGIENE`/`enqueueHygieneForBlock` — KEEP. Убираем только витрину: `getIrreversibleDecisions` (pulse) + `IrreversibleDecisionsAlert.tsx`. `[verified]`
- **Р5: карточка решения СЕЙЧАС НЕ показывает обратимость** — в `src/domain/decision.ts`/`DecisionDetail` есть только `alternatives`, поля `reversibility` нет. Поле в схеме есть, скорер его пишет → нужно **добавить** в decisions API/domain + тихий бейдж. Это новая (additive) работа, не удаление. `[verified]`
- **«День/Неделя/Месяц компании» РЕАЛИЗОВАНЫ** (`DAY_/WEEK_/MONTH_COMPANY_SYSTEM_PROMPT` + `build*CompanyUserMessage`). Блок «Решения дня» ЕСТЬ (`daily-digest.prompt.ts` :505-511 + `metrics.decisions`) → координация = **убрать блок**, не «не строить». `[verified]`
- **Monthly `metrics.decisions` = «что решить собственнику»** (forward-рекомендации LLM, пара к `nextFocus`, `MonthDecisions.tsx`) — это **НЕ** `Decision`-сущность и НЕ «что решили». **KEEP.** Спеки monthly не трогать. `[verified]`
- **Legacy-мёртвые промпты:** `buildDailyDigestUserMessage`+`DAILY_DIGEST_SYSTEM_PROMPT`, `buildWeeklyDigestUserMessage`+`WEEKLY_DIGEST_SYSTEM_PROMPT` не импортируются сервисами (заменены на `*CompanyUserMessage`); содержат блоки решений — удалить целиком. `[verified]`
- **cora-feed:** `decision.count` в `countByType` (:577) — KEEP (счётчик-навигатор «Память»); `'decision'` в `ConcreteType` union — KEEP (иначе сломается навигатор). Удаляем только `collectDecisions` risk-логику по `implementationStatus` + `implLabel`. `[verified]`
- **Не путать (НЕ трогать):** `dashboard.stuck.staleDaysThreshold`=5 и `daily-checkin.staleDaysThreshold` — стейл **задач/чек-инов**; `GoalProgressStatus 'stalled'` — **цели**. `[verified]`

## Принятые решения владельца (не пересматривать)

| # | Решение | Обоснование |
|---|---|---|
| В1 | Память решений не трогаем (сущность, раздел, карточка, граф, `DecisionTaskLink`, авто-задача из actionable-решения) | Решение = пассивная память; режем только надзор. Архитектура §3, §7 Р1 |
| В2 | Полная чистка (Вариант 1): убрать **всю** оперативку решений, включая недельную/месячную метрику доведения и крон-21 | Выбор владельца 2026-06-29; половинчатый вариант оставляет дремлющий хвост. Аудит §5 |
| В3 | Решения убрать **и из оперативных отчётов** (дневной/недельный/месячный + «День/Неделя/Месяц компании»), включая блок «Решения дня» и счётчик «решений принято» | Выбор владельца 2026-06-29; в сводках решения не упоминаем. Архитектура §3 п.2, Р4 |
| В4 | Обратимость (Bezos type-1/2) остаётся **атрибутом памяти на карточке решения**; убираем только дашборд-алерт + pulse-срез; скорер/промпт/очередь сохраняем | Это качество знания, не контроль исполнения. Архитектура §7 Р3/Р5 |
| В5 | Поля схемы `Decision.implementationStatus`/`implementationCheckedAt` — удалить (DROP колонок) | Прод почти пуст (~4 юзера); поля только у удаляемого контролёра. Аудит §6 |
| В6 | «Что решить собственнику» в месячном отчёте (`metrics.decisions`/`MonthDecisions`) — НЕ трогать | Это forward-рекомендации, не `Decision`-сущность. REALITY-CHECK |

## Доказательство выбора

Состязательные матрицы D1/D2/D3 (рынок, red-team, асимметрия обратимости) — в `plans/analysis/2026-06-27-task-decision-dashboard-control-model.md`. Scope-развилка (полная vs мягкая чистка) закрыта владельцем 2026-06-29 в пользу полной — `plans/analysis/2026-06-29-decisions-operational-cleanup-audit.md §5`. Не переоткрывать.

## Scope

**Входит:** Фазы Ф1–Ф8 ниже — удаление контролёра внедрения + 21-день + метрики + крутилки + value-recap-доведение (Ф1); dashboard «висящие решения» + pulse-алерт + forecaster + лента (Ф2); решения из оперативных отчётов (Ф3); миграция-drop полей (Ф4); фронт дашборд-поверхности (Ф5); фронт дайджест-клиенты (Ф6); Р5 пометка обратимости на карточке (Ф7); синхронизация доков/прод-реестров (Ф8).

**Не входит (свой дом):**
- **Вопросы/нуджи Коры про решения** (probe `decision.*`, проактивный `decision_no_owner`, `Specialist33ProbeService`) + фильтр `'overdue'`/дедлайны на решениях — ведутся `plans/analysis/2026-06-29-operational-inspectors-cleanup.md` (инспектор решений+обещаний). Здесь только сослаться, **не дублировать**.
- **Чистка обещаний** (включая дашборд) — там же (operational-inspectors-cleanup §2).
- **Удаление orphan-строк AdminSetting** `decision.stale_days`/`operations.decision_controller.enabled` из БД прода (останутся как мёртвые записи; сборку не ломают) — опционально one-off patch позже, в scope не входит.
- Перенос счётчика `decision.count` ленты в отдельный экран «Память» — счётчик KEEP как есть, реорганизация раздела «Память» — vNext.

## Граничные контракты с другими ТЗ

- **operational-inspectors-cleanup** (probe/нудж про решения): пересекается по файлам `daily/weekly/monthly-digest` (там убираются обещания, здесь — решения; разные секции одних файлов) и по «Кора молчит про решения». Координация: фазы этого ТЗ трогают decision-секции, инспектор-ТЗ — probe-реестры/проактив. НЕ трогать `probe-reason-policy.ts`/`proactive-watcher` в этом ТЗ.
- **«День/Неделя/Месяц компании»** (`plans/tz/2026-06-28-day-company-daily-brief.md`, week/month-аналоги): реализованы; Ф3 удаляет из их промптов/входа блок решений и letter-ключ `decisions`. Это правка действующей фичи — не ломать остальные блоки (main/done/not_done/blocked/clients/ideas/reflection/actions/delta).
- **forecaster ↔ weekly-digest:** `weekly-digest.service.ts` читает forecast-метрику `hanging_decisions` по строковому ключу (loose) — удаление из `forecaster` enum не ломает TS, но фазы Ф2/Ф3 синхронизировать (обе убирают `hanging_decisions`).

## Границы фичи

- ✅ Always: версионируемая миграция (`bun run prisma:migrate -- --name ...` → файл в `prisma/migrations/`, на проде `migrate deploy`); удаление вместе с тестами; сохранение KEEP-гардов (память/провенанс/скорер); каждая фаза оставляет свой слой (backend ИЛИ frontend) зелёным по `typecheck/lint/build`.
- ⚠️ Ask first: любое расширение scope на probe/обещания; изменение поведения KEEP-поверхностей (список решений, отчёт встречи, monthly «что решить собственнику»); новое поле Prisma сверх Р5-показа существующего `reversibility`.
- 🚫 Never: трогать `dashboard.stuck.staleDaysThreshold`/`daily-checkin.staleDaysThreshold`/`GoalProgressStatus 'stalled'`; удалять `Decision`-сущность/`DecisionTaskLink`/`impliesAction`/`actionExtractedAt`/`linkedTaskCount`/`reversibility`/`reversibilityAt`/`decisionsExtracted`; `decision.count` из `ConcreteType` union; `prisma db push` в коммит; `new PrismaClient()` в скриптах; `process.env.*` мимо `env.schema.ts`; комментарии-проза.

---

## Фаза 1 — BE: контролёр внедрения решений + 21-день + метрики + крутилки + value-recap-доведение `[x]`

**Ценность:** как владелец, перестаю получать пинки «решение застряло 21 день» и ложную метрику «доведения решений», потому что весь контролёр внедрения снят с бэкенда.

**Картография (перечитать перед правкой — номера строк на момент написания):**
- Удалить файлы: `backend/src/modules/operations/services/decision-implementation.scoring.ts` (+ `.spec.ts`), `decision-implementation.service.ts` (+ `.spec.ts`), `backend/src/modules/operations/workers/decision-implementation.cron.ts`.
- `operations.module.ts` — убрать `import`/`providers`/`exports` `DecisionImplementationService`+`DecisionImplementationCron` (:34,:62,:153,:154,:186) и комментарий-образец на :135.
- `operations-dashboard.controller.ts` — удалить `@Get('decisions/throughput')` (:371-398), `@Get('decisions/stalled')` (:400-415), `inject DecisionImplementationService` (:84,:110-111) и связанные импорты DTO (:45,:48-50).
- `operations/dto/execution-agents.dto.ts` — удалить `DecisionThroughputQuerySchema`/`DecisionThroughputQuery`/`DecisionThroughputDto`/`StalledDecisionDto`/`StalledDecisionsListDto` (:29-62); прочее (ChronicBlocker и т.п.) — KEEP.
- `common/metrics/business-metrics.service.ts` — удалить `decisionStalledTotal` (поле :279 + counter :1886 + `incDecisionStalled` :5189), `decisionThroughputPercent` (gauge :280 + :1891 + `setDecisionThroughputPercent` :5194), `decisionAutoImplementedTotal` (поле :289 + :1911 + `incDecisionAutoImplemented` :5220). Единственные инкременты — внутри удаляемого сервиса.
- `admin/settings/admin-setting-schema-registry.ts` — удалить строки `'decision.stale_days'` (:258) и `'operations.decision_controller.enabled'` (:259).
- `backend/scripts/seed-admin-setting-execution-agents.ts` — удалить блоки `decision.stale_days`=21 и `operations.decision_controller.enabled` (:136-148). Запись сида в `apply-prod-deploy.ts STEPS` (:206) — НЕ удалять (там другие крутилки).
- **value-recap (синхронно, иначе TS-каскад):**
  - `value-recap.scoring.ts` — убрать `ValueRecapTeam.decisionsTotal`/`decisionsThroughputPercent` (:18-19); удалить `ValueRecapDecision{status,throughputPercent}` и `.decisions` из `ValueRecapPayload` (:24-29,:48) ИЛИ оставить `{id,statement}` без статуса (см. «Что НЕ входит»); убрать `'throughputpercent'`/`'decisionsthroughputpercent'` из allow-list `findForbiddenMetricKeys` (:84-85). `decisionsExtracted` (:4) — KEEP.
  - `value-recap.service.ts` — убрать `import`+`inject DecisionImplementationService` (:19,:42-43); удалить `computeTeam` вызов `getDecisionThroughput` + поля (:286-290,:310-311); удалить `computeDecisions` (:317-336) и его вызов в `build` (:58-63); из `assembleValueRecapPayload` не передавать `decisions` (рекомендуется `decisions: []`).
  - `value-recap-narrative.prompt.ts` — убрать `team{decisionsThroughputPercent,decisionsTotal}` (:33-34) и строки :76,:102.
  - `value-recap-export.ts` — убрать строку summary (:38), слайд «Решения месяца» (:43-52), функцию `decisionStatusLabel` (:64).

**Что входит:** R1–R6.
**Что НЕ входит:** фронт-потребители value-recap/эндпоинтов (Ф5); поля схемы (Ф4); dashboard/cora-feed (Ф2). Развилка «оставить ли голый перечень решений месяца в value-recap» — **решено: убрать секцию (`decisions: []`)** (Вариант 1, блок D в remove); если позже понадобится перечень-память — отдельным ТЗ через `prisma.decision.findMany` без `implementationStatus`.

**Требования:**
- R1. Удалить три файла контролёра + их `.spec`; в `backend/src` не остаётся ни одного `DecisionImplementationService`/`DecisionImplementationCron`/`DEFAULT_DECISION_STALE_DAYS`/`classifyImplementationStatus` (grep пуст).
- R2. Эндпоинты `GET /operations-dashboard/decisions/throughput` и `decisions/stalled` удалены; Swagger их не содержит.
- R3. Три метрики `decision_stalled_total`/`decision_throughput_percent`/`decision_auto_implemented_total` удалены; в `business-metrics.service.ts` нет `incDecisionStalled`/`setDecisionThroughputPercent`/`incDecisionAutoImplemented`.
- R4. Крутилки `decision.stale_days` и `operations.decision_controller.enabled` удалены из реестра и сида.
- R5. value-recap собирается без полей `decisionsTotal`/`decisionsThroughputPercent`/`ValueRecapDecision.status/throughputPercent`; `decisionsExtracted` сохранён; allow-list не содержит `throughputpercent`.
- R6. value-recap-нарратив и pptx/export не упоминают «доведено до результата %».

**Acceptance:**
- `cd backend && bun run typecheck && bun run lint && bun run build` — зелёные.
- `bunx vitest run src/modules/operations/services/value-recap.service.spec.ts src/modules/operations/services/value-recap.scoring.spec.ts` — зелёные (правлены: убраны мок `DecisionImplementationService` и assert `decisionsTotal`/`decisionsThroughputPercent`/`decisions[].status`).
- Grep-негатив: `rg "DecisionImplementation|DEFAULT_DECISION_STALE_DAYS|decisionThroughputPercent|incDecisionStalled|decision.stale_days|decision_controller" backend/src backend/scripts` — пусто (кроме допустимых упоминаний в комментариях `task-reconcile`, которые тоже убираются).
- Тесты: удалить `decision-implementation.{scoring,service}.spec.ts`; поправить `value-recap.service.spec.ts`, `value-recap.scoring.spec.ts`, перепроверить `value-recap-pptx.spec.ts`.

Закрывает: R1–R6.

---

## Фаза 2 — BE: «висящие решения» + pulse-алерт обратимости + forecaster + лента `[x]`

**Ценность:** как владелец, не вижу на дашборде KPI «висящие решения», алерта «необратимые решения» и «решение застряло» в ленте — решения не маячат как контроль.

**Картография:**
- Удалить файл: `backend/src/modules/dashboard/services/hanging-decisions.service.ts` (`HangingDecisionsService`).
- `dashboard.module.ts` — убрать `import`/`providers`/`exports` `HangingDecisionsService` (:26,:41,:65).
- `director-dashboard.service.ts` — убрать `import` (:33), DI-аргумент `hangingSvc` (:71-72), распаковку `hangingRes` (:132) + `safe('hangingDecisions')` (:193-198), сборку `kpiHangingDecisions` (:233-237), sample-story (:273-277), поле в result (:314); **уменьшить `setDashboardMainFirstScreenWidgetCount({count})` 7→6** (:219).
- `dashboard/dto/director-dashboard.dto.ts` — удалить `DirectorDashboardDto.kpiHangingDecisions` (:153).
- `team-health.service.ts` — убрать DI `HangingDecisionsService` (:65-66), блок `listHangingWithAuthors`/`decisionsByDept` (:117-134), сборку `decisions`-атрибута (:177-181), поле в `teams.push` (:191), метод `toneDecisions` (:259-263), заглушку `belowCohortRow.decisions` (:310), поле `TeamHealthRowDto.decisions` (:41).
- `pulse-patterns.service.ts` — убрать `getIrreversibleDecisions` (:544-581), распаковку+вызов в `Promise.all` (:66,:74), поле в return DTO (:86), неиспользуемые `DECISIONS_TOP` (:47) и `hasNonEmptyAlternatives` (:619, проверить отсутствие др. использований).
- `dashboard/dto/pulse-patterns.dto.ts` — удалить `PulsePatternIrreversibleDecisionItemDto`/`PulsePatternIrreversibleDecisionsDto` (:106-116) и поле `PulsePatternsDto.irreversibleDecisions` (:127).
- `forecaster.cron.ts` — убрать `hanging` из деструктуризации + `decision.count` из `Promise.all` (:136,:153-161), поле `hanging_decisions` в `ForecasterTrendPoint` (:209).
- `forecaster.prompt.ts` — убрать `'hanging_decisions'` из system-prompt/`FORECASTER_JSON_SCHEMA` enum (:15,:47-48), поле интерфейса (:65), строку описания в user-msg (:79), значение из union/`parseForecasterResponse` (:91,:125).
- `activity-feed/cora-feed.service.ts` — удалить метод `collectDecisions` (:189-247, читает `implementationStatus`), ветку `case 'decision'` в `collect()` switch (:79-80), `implLabel` (:740-749). **KEEP:** `decision.count` в `countByType` (:577) и `'decision'` в `ConcreteType` union (`activity-feed.dto.ts`).

**Что входит:** R7–R12.
**Что НЕ входит:** фронт-потребители (Ф5); поля схемы (Ф4); `decision-hygiene`-скорер/промпт/очередь — KEEP (не трогать).

**Требования:**
- R7. `HangingDecisionsService` удалён; в `backend/src` нет импортов/провайдеров/`listHangingWithAuthors`.
- R8. `DirectorDashboardDto.kpiHangingDecisions` удалён; счётчик первого экрана = 6.
- R9. `TeamHealthRowDto.decisions` и вся логика per-dept висящих решений удалены; цели/настроение/прочие атрибуты team-health сохранены.
- R10. `getIrreversibleDecisions` и `PulsePatternsDto.irreversibleDecisions` удалены; `decision-hygiene-scorer.worker.ts` + поля `Decision.reversibility`/`reversibilityAt` НЕ тронуты (grep подтверждает наличие скорера).
- R11. `hanging_decisions` удалён из `forecaster` (enum/prompt/trend/parser).
- R12. `cora-feed`: `collectDecisions`/`implLabel`/`case 'decision'` в switch удалены; `decision.count` в `countByType` и `'decision'` в `ConcreteType` union сохранены.

**Acceptance:**
- `cd backend && bun run typecheck && bun run lint && bun run build` — зелёные.
- `bunx vitest run src/modules/dashboard/services/director-dashboard.goals.spec.ts src/modules/dashboard/services/director-dashboard.value-strip.spec.ts src/modules/dashboard/services/director-dashboard.requires-action.spec.ts src/modules/dashboard/services/director-dashboard.resilience.spec.ts src/modules/dashboard/services/team-health.service.spec.ts src/modules/dashboard/services/pulse-patterns.service.spec.ts src/modules/activity-feed/services/cora-feed.service.spec.ts` — зелёные.
- **Позиционный DI** (обязательно): во всех 5 `director-dashboard.*.spec.ts` и `team-health.service.spec.ts` убран импорт и позиционный аргумент `HangingDecisionsService` (иначе аргументы конструктора съезжают).
- Grep-негатив: `rg "HangingDecisionsService|kpiHangingDecisions|getIrreversibleDecisions|irreversibleDecisions|hanging_decisions|collectDecisions|implLabel" backend/src` — пусто.
- Grep-позитив (KEEP): `rg "decision-hygiene-scorer|enqueueHygieneForBlock|reversibility" backend/src` — присутствует; `rg "countByType" backend/src/modules/activity-feed` — `decision` сохранён.
- Тесты: удалить `hanging-decisions.service.spec.ts`; поправить 5 director-dashboard спеков + team-health + pulse-patterns (убрать `irreversibleDecisions`-ожидания, :85,:316-323) + `cora-feed.service.spec.ts` (удалить `decision stalled → risk` :235,:242, сохранить `decision.count` :360).

---

## Фаза 3 — BE: убрать решения из оперативных отчётов (дайджесты + «День/Неделя/Месяц компании») `[ ]`

**Ценность:** как владелец, в отчёте «День/Неделя/Месяц компании» и дайджестах больше нет блока «Решения дня» и «висящих решений» — отчёты про исполнение и людей.

**Картография:**
- `daily-digest.service.ts` — убрать: `decision.findMany` по `decidedAt` (:576-585) + `metrics.decisions` map (:638-642) + локальную `decisions` из `Promise.all` (:500); `promptInput.decisions` (:296-299); `decisionsToday` `findMany` (:906,:928-937) + `eventsToday` `kind:'decision'` (:1072-1081); `raisedDecisions` (:909,:960-970) + `urgentItems` `kind:'raised_decision'` (:1111-1120); `sources.decisionIds` (:651); `emptyMetrics.decisions` (:1334). `computeVerdictSignals` решения НЕ читает — вердикт не ломается.
- `daily-digest.dto.ts` — удалить `DailyDigestMetricsDto.decisions[]` (:37-41), `'decision'` из `EventDto.kind` (:91), `'raised_decision'` из `UrgentItemDto.kind` (:100), `Aggregates.decisions[]` (:192), `sources.decisionIds`.
- `daily-digest.prompt.ts` — убрать `DECISION_STATUS_RU`/`decisionStatusRu` (:26-38), блок «Решения за вчера» (:116-122), `## Решения` в `buildFallbackDigestMarkdown` (:193-199), блок «Решения за день» в `buildDayCompanyUserMessage` (:505-511), `'decisions'` из `LETTER_KEYS` (:232), упоминание секции `decisions` в `DAY_COMPANY_SYSTEM_PROMPT` (:254). **Удалить legacy-мёртвые** `buildDailyDigestUserMessage`+`DAILY_DIGEST_SYSTEM_PROMPT` (не импортируются).
- `weekly-digest.service.ts` — убрать весь hanging-путь: `decision.findMany` hanging (:617,:667-678), `hangingDecisions` map (:769-779), `metrics.hangingDecisions` (:800), `sources.decisionIds` (:808), `promptInput.hangingDecisions` (:286-289), `decision.count` cur/prev (:985-1002,:918-919), `buildKpi('Висящие решения')` (:1059), forecast hanging-ветки (:1071-1079,:1096-1097,:1117,:1151,:1206-1222,:1639-1664), `mapWeeklyDigestRowsToTrend.hangingDecisions` (:65), `emptyMetrics.hangingDecisions` (:1430).
- `weekly-digest.dto.ts` — удалить `WeeklyDigestMetricsDto.hangingDecisions` (:17), `'hanging_decisions'` из `WeeklyForecastItemDto.metric` union (:53, оставить `'sentiment'|'promises'`), `WeeklyDigestTrendPointDto.hangingDecisions` (:78), `sources.decisionIds`.
- `weekly-digest.prompt.ts` — убрать `WeeklyDigestAggregates.hangingDecisions` (:26), `## Висящие решения` в `buildFallbackDigestMarkdown` (:158-164), `'decisions'` из `WEEK_LETTER_KEYS` (:188) и упоминание в `WEEK_COMPANY_SYSTEM_PROMPT` (:211). **Удалить legacy-мёртвые** `buildWeeklyDigestUserMessage`+`WEEKLY_DIGEST_SYSTEM_PROMPT`.
- `monthly-digest.prompt.ts` — убрать `'decisions'` из `MONTH_LETTER_KEYS` (:22), из `MONTH_COMPANY_JSON_SCHEMA` letter-enum (:65), упоминание в system-prompt (:47). **KEEP:** `metrics.decisions` «что решить собственнику» (:268,:310,:357 + `dto:16`) — НЕ трогать.

**Что входит:** R13–R18.
**Что НЕ входит:** фронт дайджест-клиенты (Ф6); monthly «что решить собственнику» (KEEP, В6); `dashboard.stuck` overdue-логика чек-инов (это задачи).

**Требования:**
- R13. Дневной дайджест/«День компании» не собирает и не упоминает решения: нет `metrics.decisions`, `eventsToday kind 'decision'`, `urgentItems kind 'raised_decision'`, блока «Решения за день» в промпте.
- R14. Недельный дайджест/«Неделя компании» не содержит `hangingDecisions`/KPI «Висящие решения»/forecast `hanging_decisions`/letter-секции `decisions`.
- R15. Месячный: letter-ключ `decisions` убран из `MONTH_LETTER_KEYS`/JSON-schema/system-prompt; `metrics.decisions` «что решить собственнику» (В6) сохранён.
- R16. `sources.decisionIds` удалён из дневного и недельного DTO.
- R17. Legacy-мёртвые `build{Daily,Weekly}DigestUserMessage`+`*_DIGEST_SYSTEM_PROMPT` удалены.
- R18. `decisionsExtracted`-счётчик и секция решений отчёта **встречи** (`DecisionsSection`) НЕ затронуты.

**Acceptance:**
- `cd backend && bun run typecheck && bun run lint && bun run build` — зелёные.
- `bunx vitest run src/modules/operations/services/daily-digest.service.spec.ts src/modules/operations/services/daily-digest.clamp.spec.ts src/modules/operations/services/weekly-digest.service.spec.ts src/modules/operations/services/weekly-digest.trend.spec.ts src/modules/operations/services/monthly-digest.service.spec.ts src/modules/operations/prompts/monthly-digest.prompt.spec.ts` — зелёные.
- Grep-негатив: `rg "hangingDecisions|hanging_decisions|raised_decision|DECISION_STATUS_RU|buildDailyDigestUserMessage|buildWeeklyDigestUserMessage" backend/src/modules/operations` — пусто.
- Grep-позитив (KEEP, В6): `rg "decisions" backend/src/modules/operations/services/monthly-digest.service.ts` — поле «что решить собственнику» присутствует; `monthly-digest.*.spec.ts` (`Нанять PM`) не тронут.
- Тесты: поправить `daily-digest.{service,clamp}.spec.ts`, `weekly-digest.{service,trend,section-deltas}.spec.ts` (убрать decisions/hangingDecisions фикстуры/assert); monthly спеки НЕ трогать.

---

## Фаза 4 — Миграция БД: DROP полей контролёра `[ ]`

(Зависит от Ф1 — единственный writer `decision-implementation.service.ts` удалён; и Ф2 — reader `cora-feed.collectDecisions` удалён.)

**Ценность:** как компонент-схема БД, освобождаюсь от служебных полей контролёра, которые больше никто не читает и не пишет.

**Картография:**
- `backend/prisma/schema.prisma` — удалить `Decision.implementationStatus` (:6491-6493) и `Decision.implementationCheckedAt` (:6494-6496) + нарративные комментарии :6487-6496. **KEEP:** `linkedTaskCount` (:6490), `impliesAction` (:6498), `actionExtractedAt` (:6499), `reversibility`/`reversibilityAt` (:6480-6485), модель `DecisionTaskLink` (:7653).
- Миграция: `cd backend && bun run prisma:migrate -- --name drop_decision_implementation_fields` → ревью SQL (`DROP COLUMN`) → `bun run prisma:generate`. На проде применяется `migrate deploy` автоматически (`apply-prod-deploy --with-schema`).

**Что входит:** R19–R20.
**Что НЕ входит:** db push (запрещён); удаление orphan AdminSetting-строк (вне scope).

**Требования:**
- R19. В `schema.prisma` модели `Decision` нет полей `implementationStatus`/`implementationCheckedAt`; есть файл миграции `*drop_decision_implementation_fields*` с `DROP COLUMN` обоих.
- R20. `bun run prisma:generate` отрабатывает; `rg "implementationStatus|implementationCheckedAt" backend/src backend/prisma/schema.prisma` — пусто (после Ф1/Ф2).

**Acceptance:**
- `cd backend && bun run prisma:generate && bun run typecheck && bun run build` — зелёные.
- Файл миграции содержит `ALTER TABLE "Decision" DROP COLUMN "implementationStatus"` и `... "implementationCheckedAt"`.
- Идемпотентность: повторный `migrate deploy` — no-op (стандарт Prisma).

Закрывает: R19–R20.

---

## Фаза 5 — FE: дашборд-поверхности решений `[ ]`

(Пара к контрактам Ф1/Ф2. Фронт — отдельный TS-проект со своими интерфейсами; собирается независимо. Делать после Ф1/Ф2, чтобы рантайм-контракт не висел.)

**Ценность:** как владелец, на дашбордах кабинета не вижу «доведение решений», «висящие решения», алерт «необратимые решения» — поверхности убраны.

**Картография:**
- Удалить файлы: `frontend/app/(authenticated)/dashboard/operations/widgets/DecisionThroughputWidget.tsx`; `frontend/src/ui/components/dashboard/IrreversibleDecisionsAlert.tsx`; `frontend/src/domain/decision-throughput.ts` (+ `.spec.ts`); `frontend/src/ui/components/dashboard/registry/widgets/DecisionsWidget.tsx` (+ `.spec.tsx`).
- `OperationsDashboardClient.tsx` — убрать импорт+монтаж `DecisionThroughputWidget` (:57,:279) и `IrreversibleDecisionsAlert` (:68,:181-184).
- `operations-dashboard.api.ts` — удалить `DecisionThroughputApi`/`StalledDecisionApi`/`StalledDecisionsApi` (:216-234), методы `getDecisionThroughput`/`getStalledDecisions` (:376-388).
- `registry/widget-registry.ts` — удалить `import DecisionsWidget` (:10) и ключ `decisions` (:142-149); `registry/presets.ts` — убрать ВСЕ вхождения `'decisions'` (owner/coo today+week+month: :11,:27,:47,:60,:76,:96).
- `src/domain/pulse-patterns.ts` — удалить `PulsePatternIrreversibleDecision*Api` (:101-111), поле `irreversibleDecisions` в Api/Domain (:122,:152-155), маппинг (:179-187).
- `src/domain/value-recap.ts` — удалить decisions-блок: `VALUE_RECAP_DECISION_STATUS_LABELS`/`decisionStatusTone`/`decisionProgressTone` (:95-126), `ValueRecapDecision`/`ValueRecapDecisionBreakdown` (:128-143), `mapDecisions`/`decisionBreakdown` (:145-175), поля в `ValueRecapDomain` (:187-188,:223-224), `decisionsThroughputText` (:239-241), осиротевшие импорты `ValueRecapDecisionApi`/`Status` (:2-3).
- `value-recap.api.ts` — удалить `decisionsTotal`/`decisionsThroughputPercent` (:26-27), `ValueRecapDecisionStatus`/`ValueRecapDecisionApi` (:42-53), поле `decisions` (:62).
- `ValueRecapDashboardClient.tsx` — убрать `import decisionsThroughputText`/`ValueRecapDecision` (:24,:28), `<DecisionsBlock>` (:279), строку «Решения доведены» (:334), `DecisionsBlock`/`DecisionStatusChip`/`DecisionProgress` (:376-535), подзаголовок «…дисциплина решений…» (:129-130).
- `src/domain/director-dashboard.ts` — удалить `kpiHangingDecisions` (Api :250, Domain :355, mapper :537); исключить `signalCounters.decision` из категории «требует действия» (:126) — **KEEP** само поле `signalCounters.decision` как память-категорию.
- `src/domain/team-health.ts` — удалить `TeamHealthRowApi.decisions` (:32).
- `TeamHealthGrid.tsx` — удалить столбец «Решения» (:105) и ячейку `AttrChip decisions` (:163).
- `teams/TeamsListClient.tsx` — убрать `'decisions'` из `SortKey` (:34), `SortHeader` (:196-203), ячейку (:311), `OverallChip`/`keyValue` (:353,:398-405).
- `src/ui/mobile/exec/overview-zones.ts` — исключить `c.decision` из суммы `requiresYouCount` (:50) — решение пассивно, не «требует вас» (В1/В2).
- `src/lib/nav-help.ts` — убрать «доведённые решения» из текста `/month` (:17).

**Что входит:** R21–R28.
**Что НЕ входит:** дайджест-клиенты (Ф6); список/карточка решений, `DecisionsSection`, `MonthDecisions`, insights, `decisionsExtracted` (KEEP).

**Требования:**
- R21. `DecisionThroughputWidget`/`DecisionsWidget`/`IrreversibleDecisionsAlert`/`decision-throughput.ts` удалены; нет импортов/монтажа.
- R22. `operations-dashboard.api.ts` без `getDecisionThroughput`/`getStalledDecisions`/типов.
- R23. `pulse-patterns.ts` без `irreversibleDecisions` (Api/Domain/маппер).
- R24. `value-recap` (domain/api/client) без `decisions`/`decisionsThroughputPercent`/«дисциплина решений»; `decisionsExtracted` сохранён.
- R25. `kpiHangingDecisions` удалён из `director-dashboard.ts` (3 слоя).
- R26. team-health UI без столбца «Решения» (grid + teams-list); сортировки/прочие атрибуты целы.
- R27. `requiresYouCount` не учитывает `c.decision`; `signalCounters.decision` как тип сохранён.
- R28. `decisions`-виджет убран из всех пресетов owner/coo (today/week/month) и реестра.

**Acceptance:**
- `cd frontend && bun run typecheck && bun run lint && bun run build` — зелёные.
- `bun run test:unit` — зелёный; обновлены фикстуры `MobileOverviewClient.test.tsx` (:66 `kpiHangingDecisions`), `overview-zones.test.ts` (:36 + ожидания сумм :202,:229), `director-dashboard.requires-action.test.ts`.
- Grep-негатив: `rg "DecisionThroughputWidget|IrreversibleDecisionsAlert|decision-throughput|getDecisionThroughput|getStalledDecisions|decisionsThroughputPercent|kpiHangingDecisions" frontend` — пусто.
- Grep-позитив (KEEP): `rg "decisionsExtracted|DecisionsSection|MonthDecisions|signalCounters" frontend/src` — присутствует.
- Playwright (qa-tester, на проде после выката): дашборд «Аналитика» без алерта «необратимые решения» и виджета «Доведение решений»; value-recap без «Решения доведены».

---

## Фаза 6 — FE: дайджест-клиенты без решений `[ ]`

(Пара к контрактам Ф3.)

**Ценность:** как владелец, в дневном/недельном экране дайджеста не вижу карточки/событий/прогнозов про решения.

**Картография:**
- `frontend/src/api/operations-daily-digest.api.ts` — убрать `metrics.decisions` (:40-44), `'decision'` из `EventApi.kind` (:94), `'raised_decision'` из `UrgentItemApi.kind` (:103), `sources.decisionIds` (:90).
- `frontend/app/(authenticated)/dashboard/operations/daily/DailyDigestClient.tsx` — удалить `StatCard «Решения»` (:375-381), `case 'raised_decision'` в `urgentIcon` (:888-889), `case 'decision'` в `eventIcon` (:901-902).
- `frontend/src/api/weekly-digest.api.ts` — убрать `WeeklyDigestMetricsApi.hangingDecisions` (:32-36), `'hanging_decisions'` из `WeeklyForecastItemApi.metric` (:110), `WeeklyDigestTrendPointApi.hangingDecisions` (:129), `sources.decisionIds` (:87).
- `frontend/app/(authenticated)/dashboard/operations/weekly/WeeklyDigestClient.tsx` — удалить `<HangingDecisionsSection>` (:197) + компонент (:482-517), тип `HangingDecision` (:394-395), серию `hangingDecisions` в `AreaTrend` (:251,:285-288), ветку `isInverse «Висящие решения»` (:667), `case 'hanging_decisions'` в `forecastMetricLabel` (:846-847).
- `frontend/src/ui/components/dashboard/registry/widgets/WeeklyDynamicsWidget.tsx` — удалить серию `hangingDecisions` (:80,:118).

**Что входит:** R29–R31.
**Что НЕ входит:** дашборд-поверхности (Ф5); monthly «что решить собственнику» клиент (`MonthDecisions` — KEEP).

**Требования:**
- R29. Дневной дайджест-клиент без `StatCard «Решения»` и иконок `decision`/`raised_decision`.
- R30. Недельный дайджест-клиент и `WeeklyDynamicsWidget` без `HangingDecisionsSection`/серии/прогноза `hanging_decisions`.
- R31. Дайджест-api зеркалят backend-DTO Ф3 (нет `decisions`/`hangingDecisions`/`decisionIds`).

**Acceptance:**
- `cd frontend && bun run typecheck && bun run lint && bun run build` — зелёные.
- Grep-негатив: `rg "hangingDecisions|hanging_decisions|HangingDecisionsSection|raised_decision" frontend` — пусто.
- Playwright (на проде): дневной/недельный экран без секций решений.

Закрывает: R29–R31.

---

## Фаза 7 — Р5: тихая пометка «необратимое» на карточке решения (память) `[ ]`

(Additive, независима от Ф1–Ф6; скорной `decision-hygiene` уже пишет `Decision.reversibility`.)

**Ценность:** как пользователь раздела «Решения», вижу на карточке необратимого решения тихую пометку «необратимое» — это качество памяти (Bezos «дверь в одну сторону»), без всякого надзора.

**Картография:**
- Backend: `modules/decisions/dto/decisions.dto.ts` + `services/decisions.service.ts` — добавить `reversibility` (и при наличии `reversibilityAt`) в выдачу карточки/детали решения (поле уже в схеме `Decision`, наполняется скорером; нужно лишь отдать во фронт через существующий маппинг).
- Frontend: `src/api/decisions.api.ts` + `src/domain/decision.ts` — добавить `reversibility` в `ApiDto→DomainModel`; `decisions/[id]` / `DecisionsListClient.tsx` — отрисовать **неброский** бейдж «необратимое» только для `reversibility === 'type-1'` (нейтральный токен `bg-{color}`+`text-{color}-fg`, без алёрт-окраски).

**Что входит:** R32–R33.
**Что НЕ входит:** дашборд-алерт/pulse (удалены в Ф2/Ф5); новые Prisma-поля (используем существующее `reversibility`).

**Требования:**
- R32. Карточка/деталь решения отдаёт `reversibility` через API (ApiDto→Domain), без новых полей схемы.
- R33. В UI решения с `reversibility==='type-1'` показывается тихий бейдж «необратимое» (русский текст, парный цветовой токен); решения без значения — без бейджа.

**Acceptance:**
- `cd backend && bun run typecheck && bun run build` + `cd frontend && bun run typecheck && bun run lint && bun run build` — зелёные.
- `bunx vitest run` decisions-спека (если есть) + `frontend bun run test:unit` — зелёные; добавить юнит на маппер `reversibility`.
- Playwright (на проде): на решении type-1 виден тихий бейдж; алерта на дашборде нет.

Закрывает: R32–R33.

---

## Фаза 8 — Синхронизация second-brain + прод-реестры `[ ]`

(Последняя — после снятия кода.)

**Ценность:** как будущий разработчик/владелец, читаю second-brain и реестры, и они описывают фактическое состояние без снятого надзора за решениями.

**Картография:**
- `second-brain/01_projects/director-dashboard.md` (:129,:138,:183-190), `decisions.md` (:50,:52,:170-175,:201), `02_architecture/data-model.md` (:434), `01_projects/workers-queues.md` (:115), `02_architecture/module-map.md` (:2487,:2489) — убрать описания throughput/stalled/контролёра/висящих решений; сохранить `impliesAction`/`DecisionTaskLink`/память/`reversibility`.
- `docs/operations/feature-flags.md` (:94) — удалить строку `operations.decision_controller.enabled`.
- `docs/operations/prod-deploy-log.md` — убрать блок выката контролёра (~:1819-1854) + smoke `decisions/stalled`+`throughput` (~:1373/:1391); в Шаг 4 добавить миграцию `drop_decision_implementation_fields`; убрать строки Ф4 DecisionsWidget/throughput (~:208-211).
- `second-brain/04_не-сделано/README.md` — закрыть строку «Чистка оперативно-контрольного хвоста решений» (перенести в «Закрытые» с датой+коммитом); скорректировать :65,:67,:133,:235 (бэкфилл `impliesAction` остаётся; orphan-контролёр/auto-implement — снять как неактуальные).

**Что входит:** R34–R37.
**Что НЕ входит:** код (Ф1–Ф7); рефлексия (DoD-триггер отдельно).

**Требования:**
- R34. second-brain не описывает throughput/stalled/контролёр/висящие решения как действующие; память/провенанс/`reversibility` описаны корректно.
- R35. `feature-flags.md` без `operations.decision_controller.enabled`.
- R36. `prod-deploy-log.md`: блок контролёра убран, миграция-drop добавлена в Шаг 4, smoke decisions/* убран.
- R37. `04_не-сделано/README.md`: строка чистки перенесена в «Закрытые».

**Acceptance:**
- Grep-негатив: `rg -i "decision_controller|decisions/stalled|decisions/throughput|DecisionThroughputWidget" docs second-brain` — пусто (или только в исторических рефлексиях `05_история`, которые не правим).
- Markdown-ссылки валидны (нет битых якорей на удалённые разделы).

Закрывает: R34–R37.

---

## Граф зависимостей фаз

- **Ф1, Ф2, Ф3** — backend, независимы между собой (разные файлы; связь forecaster↔weekly `hanging_decisions` — loose, без compile-break; синхронизировать смысл). Можно параллельно.
- **Ф4** (миграция) — строго после **Ф1** (writer удалён) и **Ф2** (reader `cora-feed` удалён).
- **Ф5** — после **Ф1+Ф2** (контракты эндпоинтов/pulse/value-recap/director-kpi).
- **Ф6** — после **Ф3** (контракты дайджест-DTO).
- **Ф7** (Р5) — независима (additive); можно параллельно с любой фазой.
- **Ф8** — последняя, после Ф1–Ф7.

Рекомендуемый порядок волн: (Ф1‖Ф2‖Ф3‖Ф7) → (Ф4‖Ф5‖Ф6) → Ф8.

## Сквозные аспекты

- **RBAC/tenant:** `[N/A: фича только удаляет поверхности; оставшиеся memory-пути сохраняют `tenantId`-изоляцию без изменений]`.
- **Observability:** удаляем 3 метрики `decision_*` (R3) — проверить, что дашборды Grafana их не читают (Pre-mortem). Новых метрик нет.
- **Errors/идемпотентность:** миграция-drop идемпотентна (Prisma); удаление кода не вводит новых путей ошибок.
- **Миграция данных:** drop колонок (Ф4); backfill не нужен (данные надзора отбрасываются осознанно, прод почти пуст).
- **Rollout/флаг:** Ship-On — выкат единой веткой; флагов не вводим, удаляем существующий `operations.decision_controller.enabled` (был kill-switch контролёра).
- **Тесты:** удаляемые `.spec` — вместе с кодом; правимые — в той же фазе (списки в Acceptance каждой фазы).

## Pre-mortem / Риски (для strict-production-review-gate)

- **Позиционный DI `HangingDecisionsService`** — забыть аргумент в одном из 6 спеков → съезд конструктора, красные тесты. High. Ревью: grep по всем `director-dashboard.*.spec`/`team-health.service.spec`.
- **value-recap TS-каскад** — порядок правки типов (scoring → service → narrative → export → spec). Med. Ревью: `bun run typecheck` после фазы.
- **Случайно удалить KEEP** (`decisionsExtracted`, `decision.count`, `'decision'` union, monthly «что решить собственнику», `reversibility`-скорер, `DecisionTaskLink`/`impliesAction`). High. Ревью: grep-позитив в Acceptance каждой фазы.
- **DROP колонок до удаления reader/writer** — Ф4 строго после Ф1+Ф2. High. Ревью: `rg implementationStatus backend/src` пусто перед миграцией.
- **Омонимы** (`dashboard.stuck.staleDays`, `daily-checkin.staleDays`, `GoalProgressStatus 'stalled'`) — не зацепить. Med. Ревью: точечные grep с контекстом.
- **Метрики Grafana** — снятие `decision_stalled_total`/`decision_throughput_percent` может оставить пустые панели. Low-Med. Ревью: проверить дашборды Prometheus/Grafana.
- **Координация с inspector-removal** — не трогать probe/proactive здесь; дайджесты правит каждый своё (решения тут, обещания там). Med.

## Идемпотентность / флаги / прод-деплой

- Миграция `drop_decision_implementation_fields` (Ф4) → `prod-deploy-log` Шаг 4; авто-применение `migrate deploy`.
- Удаление флага `operations.decision_controller.enabled` → `docs/operations/feature-flags.md` (Ф8).
- Сид `seed-admin-setting-execution-agents.ts` остаётся в `apply-prod-deploy.ts STEPS` (другие крутилки); из сида убраны 2 блока. Orphan AdminSetting-строки на проде — вне scope (не ломают).
- Прод-смоук: после выката — дашборд «Аналитика» без алерта/виджета решений; `GET decisions/throughput`/`stalled` → 404; крон `decision-implementation` не в расписании.

## DoD

- back+front `typecheck` (вкл. `.spec`)/`lint`/`build` зелёные; vitest по затронутым спекам зелёный.
- Все grep-негативы/позитивы из Acceptance проходят; KEEP-гарды целы.
- second-brain + `feature-flags.md` + `prod-deploy-log.md` + `04_не-сделано` обновлены (Ф8); рефлексия записана в `05_история`.
- Инварианты Z не нарушены (версионируемая миграция, AdminSetting вместо ENV/хардкода, Ship-On, без комментариев-прозы, multi-tenancy не задет).

## Итог

(заполняет tz-orchestrator: реализовано целиком / что осталось.)
