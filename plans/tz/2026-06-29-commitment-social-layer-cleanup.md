---
type: tz
status: ready-to-implement
feature: commitment-social-layer-cleanup
date: 2026-06-29
owner: Сергей (владелец продукта)
relates_to:
  - plans/architecture/2026-06-29-commitment-task-unification.md
  - plans/analysis/2026-06-29-commitment-task-unification.md
  - plans/analysis/2026-06-29-decisions-operational-cleanup-audit.md
  - second-brain/04_не-сделано/README.md
---
> Архитектура (одобрена владельцем): `plans/architecture/2026-06-29-commitment-task-unification.md` (status: approved, 2026-06-29) · Анализ + полный инвентарь: `plans/analysis/2026-06-29-commitment-task-unification.md` · Статус согласования: 2026-06-29

# ТЗ — Чистка соц-слоя обещаний (обещание = факт памяти)

## Принцип
Обещание (`IdeaBlock signalType='commitment'`) остаётся **фактом памяти в полном объёме** — извлечение из всех источников и поля «кто/кому/что/срок» НЕ урезаются. Удаляется только **надзорный слой** вокруг обещаний (напоминания, эскалации, дашборды надёжности, сеть обещаний, страница «Мои обещания», секции обещаний в письмах). Модель — прецедент «решение↔задача» ([[2026-06-29-decisions-operational-cleanup-audit]]): сущность в памяти, оперконтроль снят.

## Вне scope / отложено владельцем
- **Механизм «обещание→задача»** (роутинг `commitment`→TASKS, worker, quality-gate, дедуп с meeting-extract, усиление промптов `tasks-unified`/`task-extract`) — отдельное ТЗ. Реестр: [04_не-сделано](../../second-brain/04_не-сделано/README.md).
- **Связь обещание↔цель** (маршрут `commitment`/`plan_item`→GOALS) — НЕ трогать; отдельный анализ. Реестр: там же.
- **Дроп enum-значений** `SignalType.commitment_status`, `IdeaBlockLinkType.resolves` — НЕ делать (оставить осиротевшими; Postgres enum-drop хрупкий, выгоды нет).

## Цель + Зачем
Сейчас обещание живёт двумя жизнями: запись в памяти + отдельный «надзиратель» (cron-напоминания «ты обещал — выполнил?», эскалации, KPI «надёжность обещаний», карта «перегруза», страница «Мои обещания», секции в письмах). Этот надзиратель — параллельный «продукт внутри продукта», дублирующий то, что должно быть задачей, и путающий сотрудника и руководителя. **Зачем:** свести обещание к спокойной памяти (как решение), убрать дублирующий надзорный шум; сделать это дешёвым этапом до будущего «обещание→задача».

## REALITY-CHECK (по факту кода, сверено через Read в анализе §2–§3)
- Обещание и задача разведены на роутинге: `router.service.ts` `case 'commitment'/'plan_item'`→GOALS, `case 'action_item'`→TASKS. Worker задач принимает только `action_item`. **Обещание через граф в задачу НЕ превращается** — поэтому удаление надзора НЕ ломает создание задач (его и нет на этом пути).
- Соц-слой обещаний = ~10 файлов-механизмов + ~10 потребителей-чтений (дайджесты/дашборды) + frontend. Полный инвентарь с `path:line` — анализ §3. ⚠️ Соц-слой уже работает в проде (ON) — это удаление работающего, не мёртвого кода.
- DI-грабли (подтверждены): `commitments.service.resolveSelfPerson` используют 3 контроллера (НЕ про обещания); `commitment-reliability.service` тянет 7 потребителей; `reliabilityOrLowData`/`completeCommitmentWhere` — экспорт-функции с внешними потребителями.
- Прод почти пуст (~4 юзера, [[project_prod-scale-early]]) → дроп колонок/таблицы дёшев; потеря данных `commitmentStatus/asked/escalated` допустима.

## Принятые решения владельца (не пересматривать)
| # | Решение | Обоснование |
|---|---|---|
| В1 | Память обещаний — в полном объёме: извлечение из всех источников + `commitmentDueDate/Author/Recipient` сохраняются | 2026-06-29: обещание = факт памяти, как решение |
| В2 | Снять весь соц-слой обещаний отовсюду, без исключений (вкл. «Обещано мне», «висящие к сроку») | 2026-06-29: «убрать отовсюду»; половинчатость возвращает параллельный мир |
| В3 | «Статус выполнения» (`commitmentStatus`/`asked`/`escalated`) — удалить | 2026-06-29: отметка надзирателя, без напоминалок не обновляется; не извлечённый факт |
| В4 | enum `commitment_status`/`resolves` — НЕ дропать (осиротевшими) | 2026-06-29: Postgres enum-drop хрупкий, нулевая выгода |
| В5 | due-fallback оставить (`COMMITMENT_FALLBACK_DUE_WORKDAYS` + переписанный backfill) | 2026-06-29: дешёвый fallback срока-факта, полезен будущему «обещание→задача» |
| В6 | Только чистка сейчас; «обещание→задача» — позже (временный «провал» принят) | 2026-06-29: строгая граница «только обещания» |
| В7 | Пустые блоки писем — показывать с подписью «сегодня без выделенных» | 2026-06-29: стабильная структура письма привычнее |
| В8 | Пустые места дашбордов — схлопывать (грид ужимается), ничем не заменять | 2026-06-29: честнее меньше, чем выдумка |

## Доказательство выбора
Состязательный разбор (анализ §7–§8 + red-team): полное схлопывание обещания в задачу отвергнуто (killer-конфликт `Person.userId` vs `IssueAssignee.userId` + потеря дифференциатора); рынок продуктов с обоими слоями (Fellow/Claryti) держит память отдельно от трекера. Прецедент «решение» в Z уже разрешил ту же дилемму. Порядок удаления «снизу вверх» (листья→провайдеры→module→роутер→метрики→потребители→config→схема последней) — анализ §4: схему дропаем последней, т.к. дроп колонки `commitmentStatus` уронит компиляцию всех `select:{commitmentStatus}`, пока читатели не убраны.

## Что НЕ трогать (граница факта — критично)
`commitmentDueDate`, `commitmentAuthorPersonId`, `commitmentRecipientPersonId` + relations `commitmentRecipient/commitmentAuthor` + back-refs `Person.commitmentsToMe/commitmentsAuthored` + индексы `:3542/:3544`; `signalCounters.commitment` (director-dashboard); `commitmentsExtracted` (value-recap); `blocker-synthesis.service` (читает `commitmentAuthorPersonId` + regex по словам); `knows-who.service` (exclude-self по author); `kpi.service`; крутилки `knowledge.commitmentAuthorAttributionEnabled`, `blocker_synthesis.impact.commitment`, `COMMITMENT_FALLBACK_DUE_WORKDAYS`; `backfill-commitment-author.ts`; извлечение commitment в `block-ingest` (кроме строки записи `commitmentStatus`). LLM taskType `commitment-extract-dates` — оставить.

---

## Фазы

> Порядок строго последовательный: Ф1–Ф5 трогают общие `operations.module.ts`/`dashboard.module.ts` (конфликт при параллели). **Ф6 (схема) — последней.** После КАЖДОЙ фазы `bun run typecheck && bun run lint && bun run build` зелёные (фаза удаляет механизм вместе со всеми его следами). Спеки удаляемых файлов удалять вместе с файлами. Полные `path:line` и регистрации (`module:line`) — анализ §3; ниже якоря-символы (надёжнее номеров строк — перед правкой перечитать).

### Ф1 — Удалить follow-up / эскалацию обещаний
**Ценность:** как сотрудник и руководитель, перестаю получать напоминания «ты обещал — выполнил?» и эскалации про обещания — параллельный надзор уходит.
**Удалить целиком (+ .spec):** `operations/services/specialist-3-9-promise-keeper.service.ts`, `operations/workers/commitment-followup.cron.ts`, `operations/services/commitment-response.handler.ts`.
**Почистить:**
- `operations.module.ts` — убрать 3 провайдера + exports `Specialist39PromiseKeeperService` (регистрации — анализ §3.1).
- `knowledge-core/services/router.service.ts` — удалить `case 'commitment_status'` (эмит `commitment.status_received` осиротеет; единственный слушатель — удаляемый handler). `case 'commitment'`→GOALS НЕ трогать.
- `probe/probe-reason-policy.ts` + `probe/probe-reason-labels.ts` (+ их .spec) — убрать reason `commitment.followup`, `commitment.silence_escalation`.
- `common/metrics/business-metrics.service.ts` — удалить `incCommitmentsAsked/Fulfilled/Missed/Escalated/ExtractFailed` + их counter-определения.
- `ai/services/llm-router.service.ts` — удалить taskType `'commitment-extract-status'` (union + массив). Оставить `'commitment-extract-dates'`.
- Крутилки/ENV: `env.schema.ts` `COMMITMENT_FOLLOWUP_ENABLED`/`COMMITMENT_FOLLOWUP_LOCAL_HOUR`/`COMMITMENT_ESCALATION_DAYS`/`COMMITMENT_MAX_RETRIES`; `typed-config.service.ts` `betaOps.commitmentFollowupEnabled/commitmentFollowupLocalHour/commitmentEscalationDays/commitmentMaxRetries`; `env-classification.ts` соответствующие строки; `admin-setting-schema-registry.ts` `betaOps.commitmentFollowupLocalHour`; seed `seed-admin-setting-llm-models-and-gray.ts` строку follow-up-hour. **Оставить** `COMMITMENT_FALLBACK_DUE_WORKDAYS`/`commitmentFallbackDueWorkdays`.
**Acceptance:** `rg "Specialist39PromiseKeeper|CommitmentResponseHandler|CommitmentFollowupCron|commitment\.followup|commitment\.status_received|commitment-extract-status|incCommitmentsAsked|COMMITMENT_FOLLOWUP_ENABLED" backend/src` → 0 совпадений; `bun run typecheck && bun run lint && bun run build` зелёные; `bunx vitest run` зелёный.
**Закрывает:** R1, R8 (часть), R9 (часть).

### Ф2 — Удалить promise-cascade (каскад срыва)
**Ценность:** как руководитель, перестаю получать алерты «твоё обещание держит коллегу» — отдельный надзор уходит.
**Удалить целиком (+ .spec):** `operations/services/promise-cascade.service.ts`, `operations/workers/promise-cascade.cron.ts`, `operations/services/promise-cascade.scoring.ts`.
**Почистить:** `operations.module.ts` (2 провайдера + export); `business-metrics.service.ts` `incPromiseCascadeAlert` + counter `promise_cascade_alert_total`; крутилка `operations.promise_cascade.enabled` в `admin-setting-schema-registry.ts` + seed `seed-admin-setting-execution-agents.ts` + строка в `docs/operations/feature-flags.md`; обновить hint `apply-prod-deploy.ts` (убрать `promise_cascade`).
**Acceptance:** `rg "PromiseCascade|promise_cascade|incPromiseCascadeAlert" backend/src` → 0; сборка+тесты зелёные.
**Закрывает:** R2.

### Ф3 — Удалить promise-network (сеть/перегруз обещаний), кроме модели БД
**Ценность:** как руководитель, на операционном дашборде больше нет виджета «Перегруз ответственностью» (грид сжат).
**Удалить целиком (+ .spec):** `operations/services/promise-network.service.ts`, `dashboard/agents/promise-network-analyzer.cron.ts`, `operations/dto/promise-network.dto.ts`.
**Почистить:** `operations.module.ts` (провайдер+export `PromiseNetworkService`); `dashboard.module.ts` (провайдер analyzer); `operations-dashboard.controller.ts` — удалить inject `promiseNetwork` + endpoint `GET promise-network`.
**Frontend:** удалить `dashboard/operations/widgets/PromiseOverloadWidget.tsx`, `src/domain/promise-network.ts` (+ spec); почистить `OperationsDashboardClient.tsx` (mount PromiseOverloadWidget — грид сжать, В8), `src/api/operations-dashboard.api.ts` (`getPromiseNetwork` + типы).
**НЕ трогать здесь:** модель `PromiseNetworkSnapshot` в schema — дроп в Ф6 (после удаления всех читателей/писателей). `onboarding.service.ts`/`demo-data/pulse-snapshots.ts` (обращения к snapshot) — правятся в Ф6 вместе с дропом модели.
**Acceptance:** `rg "PromiseNetworkService|PromiseNetworkAnalyzer|PromiseOverloadWidget|getPromiseNetwork|promise-network" backend/src frontend/src frontend/app` → 0 (кроме `prisma.promiseNetworkSnapshot` в onboarding/demo — это Ф6); сборка back+front зелёная.
**Закрывает:** R3 (часть).

### Ф4 — Удалить commitment-reliability (надёжность обещаний) + 7 потребителей
**Ценность:** как руководитель, на дашборде директора больше нет KPI «Надёжность обещаний» (3→2 KPI); на странице человека нет карточки надёжности.
**Удалить целиком (+ .spec):** `dashboard/services/commitment-reliability.service.ts`.
**Почистить backend (7 потребителей, граница факта — вырезать только reliability/status, НЕ count/due/author):**
- `dashboard/services/director-dashboard.service.ts` — `kpiCommitmentReliability` + DI + DTO; `fetchValueStrip` `commitmentsKept`; **оставить** `signalCounters.commitment`; скорректировать `setDashboardMainFirstScreenWidgetCount` (3→2 KPI, В8).
- `dashboard/services/team-detail.service.ts` (`commitmentReliabilityPercent`), `people-at-risk.service.ts`, `team-health.service.ts`, `persons/services/person-pulse.service.ts` (`promises*14d`/`promisesReliabilityPercent`).
- `operations/services/value-recap.service.ts` + `value-recap.scoring.ts` — `computeReliability`/`reliabilityWindow`/reliability* поля; **оставить** `commitmentsExtracted`; убрать импорт `reliabilityOrLowData`.
- `operations/services/weekly-per-person.service.ts` — расчёт `promises*`/`reliabilityPercent`/`commitmentFactStatus`; убрать импорт `reliabilityOrLowData`.
- Крутилка `reliability.min_denominator` (`admin-setting-schema-registry.ts` + seed `seed-admin-setting-execution-agents.ts`); обновить hint `apply-prod-deploy.ts` (убрать `reliability.min_denominator`).
**Frontend:** почистить `dashboard/widgets/ValueStripWidget.tsx` (`commitmentsKept`→`/me/promises`), `persons/[id]/pulse/PersonPulseClient.tsx` (`PromisesCard`/`PromiseStat` — карточка исчезает), domain `director-dashboard.ts`/`person-pulse.ts`/`value-recap.ts`/`team-health.ts`/`team-detail.ts`/`weekly-per-person.ts` + соответствующие `*.api.ts` и виджеты (`WeeklyPerPersonWidget`, `MyWeeklyPlanFactWidget`).
**Acceptance:** `rg "CommitmentReliability|reliabilityOrLowData|kpiCommitmentReliability|commitmentReliabilityPercent|promisesReliabilityPercent" backend/src frontend/src frontend/app` → 0; `rg "commitmentsExtracted|signalCounters" backend/src` → сохранены; сборка back+front зелёная.
**Закрывает:** R4, R9 (часть).

### Ф5 — Удалить «Мои обещания» + секции обещаний в письмах/брифах
**Ценность:** как сотрудник, в кабинете `/me` больше нет вкладки «Мои обещания» (5→4); в письмах нет секций про обещания.
**Удалить целиком (+ .spec):** `operations/controllers/my-promises.controller.ts`.
**Backend-чистка:**
- `operations/services/commitments.service.ts` — **НЕ удалять целиком**: вынести `resolveSelfPerson` в новый тонкий `operations/services/self-person-resolver.service.ts` (его инжектят `my-customer-risk.controller`, `my-daily-brief.controller`, `my-weekly-per-person.controller`); удалить методы обещаний (`listMine/markMine/rescheduleMine/listOpenForTenant/listForPerson`); поправить инжекты `operations-dashboard.controller`/`personal-relations.controller`. Обновить `operations.module.ts` (убрать `MyPromisesController` из controllers; зарегистрировать новый resolver).
- `operations/utils/commitment-completeness.ts` — удалить (+ spec) после чистки потребителей.
- Дайджест-секции (вырезать блоки обещаний, граница факта): `daily-digest.service.ts` (who-shined `commitments_kept`, whoStruggled `broken_commitment`, urgent `overdue_commitment` + DTO reason-значения), `weekly-digest.service.ts` (KPI «Надёжность обещаний», forecast `promises`, teamDynamics promises + DTO `WeeklyKpiDeltaDto`/`WeeklyForecastItemDto.metric`), `monthly-digest.service.ts` (`reliabilityPercent`), `personal-daily-brief.service.ts` + `.synth.ts` (kind `my_promise` + `promised_to_me`, `BriefItemKind`). **Пустые блоки писем — оставлять с подписью (В7).**
**Frontend:** удалить `app/(authenticated)/me/promises/` (page + `MyPromisesClient.tsx`), `src/api/promises.api.ts`, `src/api/commitments.api.ts`, `src/domain/promises.ts`; почистить `me/MeTabsClient.tsx` (вкладка `promises`, 5→4), `persons/[id]/PersonDetailClient.tsx` (`PersonCommitmentsSection`/`CommitmentsList`), `src/domain/me/daily-brief.ts` (+ api, kinds), `weekly`-виджеты дайджеста. Удалять снизу вверх (типы `CommitmentApi`/`CommitmentStatusApi` из `promises.api.ts` импортятся в `commitments.api.ts`/`PersonDetailClient`).
**Acceptance:** `rg "MyPromisesController|MyPromisesClient|/me/promises|PersonCommitmentsSection|commitments_kept|broken_commitment|my_promise|promised_to_me|completeCommitmentWhere" backend/src frontend/src frontend/app` → 0; `rg "resolveSelfPerson" backend/src` → только новый resolver + 3 контроллера; сборка back+front + vitest зелёные.
**Закрывает:** R3 (часть), R5.

### Ф6 — Схема + миграция (последней) + код под миграцию + backfill
**Ценность:** как компонент хранения, держу память обещаний только из полей-фактов; надзорные поля и производная таблица удалены.
**Код под миграцию (до дропа полей, иначе runtime/compile):**
- `knowledge-core/workers/block-ingest.worker.ts` — убрать запись `commitmentStatus: 'open'` при создании commitment-блока; оставить `commitmentDueDate`. (Извлечение и атрибуция автора/адресата НЕ трогать — R7.)
- `onboarding/onboarding.service.ts` — убрать `tx.promiseNetworkSnapshot.deleteMany`; `onboarding/demo-data/pulse-snapshots.ts` — убрать `.create` snapshot.
- Промпт-словари (почистить `commitment_status` как извлекаемый-но-мёртвый, enum НЕ дропать — В4): `block-ingest.prompt.ts`, `dialog-layer/prompts/extract-plan.prompt.ts`, `knowledge-core/prompts/signal-type-label.ts`, `chat-v2.service.ts`; `env.schema.ts` дефолт `BITEMPORAL_FACT_SIGNAL_TYPES` (убрать `commitment_status` из списка).
**Backfill:** переписать `backend/scripts/backfill-commitment-due-dates.ts` — убрать запись `commitmentStatus:'open'`, фильтр сменить на `commitmentDueDate: null` (через `createPrismaClient()`); STEPS-запись в `apply-prod-deploy.ts` сохранить. `backfill-commitment-author.ts` — не трогать. Идемпотентность (повторный прогон = no-op) — acceptance-критерий.
**Схема (`prisma/schema.prisma`):**
- Дроп полей `IdeaBlock.commitmentStatus`, `commitmentAskedAt`, `commitmentEscalatedAt` + индексы `@@index([tenantId,signalType,commitmentStatus,commitmentDueDate])` и `@@index([tenantId,signalType,commitmentStatus])`.
- Дроп модели `PromiseNetworkSnapshot` + back-ref `Org.promiseNetworkSnapshots`.
- **Оставить** `commitmentDueDate/RecipientPersonId/AuthorPersonId` + relations + индексы по author. enum `SignalType.commitment_status` и `IdeaBlockLinkType.resolves` — **НЕ дропать** (В4).
- Миграция: `bun run prisma:migrate -- --name drop-commitment-social-layer` (генерит `DROP TABLE promise_network_snapshots` + `DROP INDEX`×2 + `ALTER TABLE IdeaBlock DROP COLUMN`×3), ревью SQL, затем `bun run prisma:generate`. На прод — авто `migrate deploy`.
**Acceptance:** `rg "commitmentStatus|commitmentAskedAt|commitmentEscalatedAt|PromiseNetworkSnapshot|promiseNetworkSnapshot" backend/src backend/prisma backend/scripts` → 0; `rg "commitmentDueDate|commitmentAuthorPersonId|commitmentRecipientPersonId" backend/prisma/schema.prisma` → сохранены; миграция применяется на чистой БД без ошибок; `bun run typecheck && bun run build` зелёные; повторный прогон backfill = no-op.
**Закрывает:** R6, R7, R8, R10.

---

## Сквозные аспекты
- **RBAC/tenant:** `[N/A]` — только удаление; новых запросов без `tenantId` не вводим.
- **Observability:** удаляем осиротевшие метрики (Ф1/Ф2); новых не добавляем.
- **Errors/идемпотентность:** backfill переписан с сохранением идемпотентности (Ф6).
- **Миграция данных:** дроп колонок/таблицы — потеря `status/asked/escalated` принята (В3, прод почти пуст).
- **Rollout/флаг:** `[N/A]` — удаление работающего функционала по решению владельца; Ship-On неприменим (нечего включать). Удаляемые kill-switch'и (`commitmentFollowupEnabled`, `promise_cascade.enabled`) уходят вместе с механизмами.
- **Тесты:** спеки удаляемых файлов удалить; у изменённых потребителей — обновить/удалить commitment-кейсы; `bunx vitest run` зелёный после каждой фазы.

## Acceptance (общий, машинный)
- R7 (память цела): после Ф6 commitment-блоки на месте, `commitmentDueDate/Author/Recipient` заполняются; извлечение обещаний из встречи/чата работает (smoke: прогон `block-ingest` создаёт commitment-блок с due/author).
- Полная чистка: `rg -i "promise|commitment" backend/src frontend/src frontend/app` оставляет только разрешённое (граница факта: `commitmentDueDate/Author/Recipient`, `signalCounters.commitment`, `commitmentsExtracted`, blocker-synthesis, knows-who, `commitmentAuthorAttributionEnabled`, `COMMITMENT_FALLBACK_DUE_WORKDAYS`, backfill-author, `commitment-extract-dates`, enum `commitment`/`commitment_status`/`resolves`).
- `bun run typecheck && bun run lint && bun run build` (backend и frontend) зелёные; `bunx vitest run` зелёный.

## Pre-mortem / Риски
- **Скрытый потребитель commitmentStatus** не найден → дроп колонки уронит compile. Митигация: Ф6 последней + grep-acceptance в Ф1–Ф5 на 0 ссылок перед схемой.
- **Пустые UI после чистки** (who-shined/whoStruggled/KPI-гриды). Митигация: В7 (подпись), В8 (сжать грид), проверить пустые состояния (qa-tester на проде после выката).
- **`resolveSelfPerson` сломает 3 контроллера** при удалении `commitments.service` целиком. Митигация: вынос в отдельный сервис (Ф5, явно).
- **DTO-каскад фронт↔бэк** (weekly-per-person, director-dashboard, daily-brief). Митигация: backend-чистка DTO и frontend-domain — в одной фазе, сборка front проверяется.

## Ревью-аспекты (для strict-production-review-gate, шаг 10)
Не удалено ли лишнее (граница факта); не осталось ли висящих импортов/DI; миграция не трогает оставляемые поля/индексы; backfill идемпотентен; second-brain и prod-deploy-log обновлены.

## Prod-deploy (по правилам проекта; детали — docs/operations/prod-deploy-log.md)
- **Шаг 1 (ENV):** удалены `COMMITMENT_FOLLOWUP_ENABLED/LOCAL_HOUR/ESCALATION_DAYS/MAX_RETRIES` — убрать из прод `.env` (необязательно, но почистить).
- **Шаг 4 (схема):** миграция `drop-commitment-social-layer` (DROP COLUMN ×3 + DROP INDEX ×2 + DROP TABLE `promise_network_snapshots`) — применяется авто через `migrate deploy` на `docker compose up -d --build`.
- **Шаг 7 (seed):** изменены `seed-admin-setting-execution-agents.ts` (убраны `promise_cascade.enabled`, `reliability.min_denominator`), `seed-admin-setting-llm-models-and-gray.ts` (убран follow-up-hour) — прогнать `apply-prod-deploy --mode update`.
- **Шаг 8 (backfill):** `backfill-commitment-due-dates.ts` переписан (без status) — в STEPS остаётся.
- **Шаг 12 (smoke):** проверить отсутствие осиротевших cron/очередей (`commitment-followup`, `promise-cascade`, `promise-network-analyzer`); Swagger без endpoint `promise-network` и `/me/promises`.

## DoD
- typecheck (вкл. `.spec`)/lint/build зелёные (back+front); `bunx vitest run` зелёный.
- second-brain обновлён по таблице производных заметок: `02_architecture/data-model.md` (дроп полей/модели), `02_architecture/module-map.md` (удалённые модули), `01_projects/ai-jobs.md` + `workers-queues.md` (удалённые cron/handlers), `01_projects/admin.md` (удалённые крутилки), `01_projects/frontend-pages.md` (удалённая страница «Мои обещания»), `01_projects/api-layer.md` (удалённые endpoint).
- `docs/operations/feature-flags.md` — удалены строки соц-слоя (`promise_cascade.enabled`, follow-up-флаги); оставлены `commitmentAuthorAttributionEnabled`, `blocker_synthesis.impact.commitment`.
- `docs/operations/prod-deploy-log.md` — обновлены Шаги 1/4/7/8/12.
- Реестр [04_не-сделано](../../second-brain/04_не-сделано/README.md): строки «обещание→цель» и «обещание→задача» актуальны (остаются открытыми).
- Рефлексия в `second-brain/05_история/`.

## Итог
Реализовано: <заполнит tz-orchestrator>. Осталось: <…>.
