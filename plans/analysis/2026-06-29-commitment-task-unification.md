---
type: analysis
status: research-complete
feature: commitment-task-unification
date: 2026-06-29
snapshot_date: 2026-06-29
owner: Сергей (владелец продукта)
related:
  - plans/architecture/2026-06-29-commitment-task-unification.md
  - plans/analysis/2026-06-29-decisions-operational-cleanup-audit.md
  - second-brain/04_не-сделано/README.md
---
> Цель разбора: спроектировать (под ТЗ) перевод «обещания» на модель прецедента «решение↔задача» — обещание остаётся фактом памяти, весь соц-слой обещаний снимается отовсюду, задача создаётся обычным путём извлечения.
> Следующий шаг → архитектура (solution-blueprint): plans/architecture/2026-06-29-commitment-task-unification.md

# Обещание → факт памяти + задача себе: анализ под ТЗ

## 0. Решение владельца (зафиксировано) и граница scope

**Выбранная модель — «D», прецедент «решение↔задача»** (та же логика, что в чистке оперативного хвоста решений, [2026-06-29-decisions-operational-cleanup-audit.md](2026-06-29-decisions-operational-cleanup-audit.md)):

1. **Обещание ОСТАЁТСЯ фактом памяти** — `IdeaBlock signalType='commitment'` извлекается как раньше (граф знаний / поиск / клоны). Извлечение не трогаем.
2. **Весь СОЦ-СЛОЙ обещаний СНИМАЕТСЯ отовсюду** — follow-up cron + probe + эскалация, promise-cascade, promise-network (+ snapshot + виджет), commitment-reliability (+ KPI директора), страница «Мои обещания», секции обещаний в дайджестах/брифах, крутилки и метрики соц-слоя.
3. **Задача создаётся обычным путём извлечения** — «обещание = постановка задачи самому себе». ⚠️ Этот пункт **ВЫНЕСЕН из данного ТЗ** (см. §7) — он трогает задачный путь (роутинг/worker/gate/дедуп/промпт), отдельная зона. Зафиксирован в реестре не-сделанного.
4. **Связь обещание↔задача по происхождению** — через существующий `Issue.sourceBlockIds` (новой таблицы не заводить), без тяжёлой двусторонней синхронизации.
5. **Поля схемы:** дроп `commitmentStatus/commitmentAskedAt/commitmentEscalatedAt`; сохранить `commitmentDueDate/commitmentAuthorPersonId/commitmentRecipientPersonId`.
6. **Цели** (`commitment`→GOALS) — НЕ трогаем (отдельный анализ, реестр).

### Что ВХОДИТ в это ТЗ
Снятие соц-слоя обещаний (backend-механизмы + потребители + frontend + схема + крутилки + метрики) так, чтобы обещание осталось чистым фактом памяти, а сборка/typecheck/тесты были зелёными.

### Что НЕ входит (вынесено, §7)
Механизм «обещание → задача себе» (роутинг `commitment`→TASKS, worker, quality-gate, дедуп с meeting-extract, усиление промптов) и связь обещание↔цель. **Решение владельца 2026-06-29: делаем ТОЛЬКО чистку сейчас** (строгая граница «только обещания»); механизм «обещание→задача» — отдельным блюпринтом/ТЗ позже. **Временный «провал» принят осознанно:** между этапами обещание = «голый факт» (из дашбордов убрано, в задачу ещё не идёт) — видно только в памяти/поиске (см. §7 риск).

---

## 1. Почему «оставить в памяти» — обоснованное решение (а не компромисс)

Состязательный разбор рынка (snapshot 2026-06-29) подтвердил: отдельная **операционная** сущность «обещание» в self-модели не нужна (8 из ~10 meeting-AI трактуют «я сделаю X» как обычную задачу с assignee). Но «команда держит слово» / accountability — это **факт-память и репутация**, отдельный пласт (StickK, Claryti, EOS to-dos, HR-метрика reliability) `[verified]`. Прецедент «решение» в Z уже разрешил ровно эту дилемму: **решение = пассивная память, оперконтроль — на задачах** ([decision-task-link.util.ts](../../backend/src/modules/tracker/services/decision-task-link.util.ts) + чистка [2026-06-29-decisions-operational-cleanup-audit.md](2026-06-29-decisions-operational-cleanup-audit.md)). Обещание ложится на ту же модель один-в-один.

Это также снимает технический killer полного схлопывания (исполнитель Issue = `User`, автор обещания = `Person` без `User`): мы не превращаем блок-обещание в Issue, а оставляем его фактом памяти; задача создаётся обычным путём, который уже умеет «нет аккаунта → unassigned-кандидат». `[verified — код]`

---

## 2. Текущее состояние (корень боли)

Обещание и задача разведены на этапе роутинга ([router.service.ts:426-432](../../backend/src/modules/knowledge-core/services/router.service.ts#L426)): `commitment`/`plan_item`→GOALS, `action_item`→TASKS. Worker задач принимает **только** `action_item` ([specialist-3-15-tasks.worker.ts:16](../../backend/src/modules/knowledge-core/workers/specialist-3-15-tasks.worker.ts#L16)). Итог: **обещание через граф в задачу не превращается вообще**; на дашбордах живёт параллельный соц-слой (follow-up/надёжность/сеть). Это и есть то, что снимаем (соц-слой) + чинит вынесенный этап (создание задачи).

---

## 3. Инвентарь УДАЛЕНИЯ соц-слоя (implementation-grade)

Все имена полей/методов/строк сверены через Read (vexp маскирует grep). Пути от корня репо.

### 3.1. Backend-механизмы — удалить целиком (+ их `.spec.ts`)

| Файл | Действие | Регистрация (module:line) | @Cron / @OnEvent / эмиты |
|---|---|---|---|
| `operations/services/specialist-3-9-promise-keeper.service.ts` | целиком | `operations.module.ts:126`, exports `:182` | probe `commitment.followup`/`commitment.silence_escalation`; метрики asked/escalated |
| `operations/workers/commitment-followup.cron.ts` | целиком | `operations.module.ts:127` | `@Cron('0 * * * *')` |
| `operations/services/commitment-response.handler.ts` | целиком | `operations.module.ts:128` | `@OnEvent('notification.responded')` (фильтр reason `commitment.followup`); пишет `commitment_status`-блок + ребро `resolves` |
| `operations/services/promise-cascade.service.ts` | целиком | `operations.module.ts:157`, exports `:189` | — |
| `operations/workers/promise-cascade.cron.ts` | целиком | `operations.module.ts:158` | `@Cron('0 8 * * *')`; notif ruleType `promise_cascade` |
| `operations/services/promise-cascade.scoring.ts` | целиком (utility) | — | — |
| `operations/services/promise-network.service.ts` | целиком | `operations.module.ts:171`, exports `:196` | читает `promiseNetworkSnapshot` |
| `dashboard/agents/promise-network-analyzer.cron.ts` | целиком | `dashboard.module.ts:56` | `@Cron('0 5 * * 1')`; пишет `promiseNetworkSnapshot` |
| `dashboard/services/commitment-reliability.service.ts` | целиком | `dashboard.module.ts:38`, exports `:64` | KPI надёжности; ⚠️ fan-out 7 потребителей (ниже) |
| `operations/controllers/my-promises.controller.ts` | целиком | `operations.module.ts:94` | REST `/me/promises*` |

**Грабли DI (нельзя удалять «в лоб»):**
- `operations/services/commitments.service.ts` — **НЕ удалять целиком**: метод `resolveSelfPerson` инжектится в `my-customer-risk.controller.ts`, `my-daily-brief.controller.ts`, `my-weekly-per-person.controller.ts` (person-резолвер, не про обещания). Вынести `resolveSelfPerson` в отдельный тонкий сервис, остальное (`listMine/markMine/rescheduleMine/listOpenForTenant/listForPerson`) удалить.
- `dashboard/services/commitment-reliability.service.ts` — fan-out: `director-dashboard.service.ts:69`, `team-detail.service.ts:58`, `people-at-risk.service.ts:134`, `team-health.service.ts:61`, `persons/services/person-pulse.service.ts:60`; экспорт-функция `reliabilityOrLowData` импортится в `value-recap.service.ts:9` и `weekly-per-person.service.ts:7`. Все 7 чистить синхронно, иначе typecheck красный.
- `operations/utils/commitment-completeness.ts` — удалить после чистки всех 3 потребителей (`commitment-reliability`, `commitments.service`, `weekly-per-person`).
- `router.service.ts:433-453` — `case 'commitment_status'` (эмит `commitment.status_received`) становится мёртвым после удаления handler → удалить case. `case 'commitment'→GOALS` (`:426-429`) **НЕ трогать**.

### 3.2. Потребители commitment-полей — чистка (граница «факт vs соц-слой»)

Удаляются чтения `commitmentStatus`/`commitmentAskedAt`/`commitmentEscalatedAt` и весь UI/метрики надёжности. **НЕ трогать** места, читающие только `commitmentDueDate`/`Author`/`Recipient`/`count(commitment)`.

| Сервис | Что вырезать | Риск (DTO-каскад) |
|---|---|---|
| `daily-digest.service.ts` | секции `overdueCommitments`/`brokenCommits`/`keptCommits` (who-shined `commitments_kept`, whoStruggled `broken_commitment`, urgentItems `overdue_commitment`) — все по `commitmentStatus` | who-shined/whoStruggled пустеют → проверить пустое состояние; `DailyDigest*Dto.reason` правка |
| `weekly-digest.service.ts` | KPI «Надёжность обещаний» (`computeReliabilityPercent`), forecast `promises`, teamDynamics promises | KPI-грид 4→3; `WeeklyKpiDeltaDto`/`WeeklyForecastItemDto.metric` |
| `weekly-per-person.service.ts` | весь расчёт `promises*`/`reliabilityPercent`/`commitmentFactStatus` | ядро «обещания по людям»; `WeeklyPersonRowDto` каскадит в weekly-digest + 4 frontend |
| `monthly-digest.service.ts` | агрегаты `reliabilityPercent` | месячный KPI |
| `personal-daily-brief.service.ts` (+ `.synth.ts`) | секции `my_promise` и `promised_to_me` (`BriefItemKind`) | бриф остаётся на tasks+blockers; развилка «обещано мне» (см. §5) |
| `value-recap.service.ts` (+ `.scoring.ts`) | `computeReliability`/`reliabilityWindow`; **оставить `commitmentsExtracted`** (count факта) | narrative-промпт ссылается на reliability |
| `director-dashboard.service.ts` | KPI `kpiCommitmentReliability` + valueStrip `commitmentsKept`; **оставить `signalCounters.commitment`** (count факта) | главный экран 3→2 KPI; `setDashboardMainFirstScreenWidgetCount:217` скорректировать |
| `team-detail.service.ts` / `team-health.service.ts` / `people-at-risk.service.ts` / `person-pulse.service.ts` | поля `*reliabilityPercent`/`promises*14d` | каскад в frontend domain |

**НЕ трогать:** `blocker-synthesis.service.ts` (читает `commitmentAuthorPersonId` = факт; regex по словам «обещ/договор» — текстовая эвристика), `knows-who.service.ts` (`commitmentAuthorPersonId` exclude-self), `kpi.service.ts` (generic CRUD).

### 3.3. Frontend — удалить/почистить

**Удалить файлы:** `app/(authenticated)/me/promises/` (page + `MyPromisesClient.tsx`), `dashboard/operations/widgets/PromiseOverloadWidget.tsx`, `src/api/promises.api.ts`, `src/api/commitments.api.ts` (развилка §5), `src/domain/promise-network.ts` (+ spec).
**Почистить:** `me/MeTabsClient.tsx` (вкладка `promises`, 5→4), `dashboard/operations/OperationsDashboardClient.tsx` (PromiseOverloadWidget + OpenCommitmentsWidget + KPI open-commitments — проверить грид), `src/api/operations-dashboard.api.ts` (`getPromiseNetwork`), `persons/[id]/pulse/PersonPulseClient.tsx` (`PromisesCard`/`PromiseStat` — карточка «Надёжность 14д» исчезнет), `persons/[id]/PersonDetailClient.tsx` (`PersonCommitmentsSection`/`CommitmentsList`), `dashboard/widgets/ValueStripWidget.tsx` (`commitmentsKept`→`/me/promises`), domain: `director-dashboard.ts`/`weekly-per-person.ts`/`person-pulse.ts`/`value-recap.ts`/`me/daily-brief.ts`/`team-health.ts`/`team-detail.ts` + соответствующие `*.api.ts` и UI-виджеты. **Зависимость:** `CommitmentApi`/`CommitmentStatusApi` из `promises.api.ts` импортятся в `commitments.api.ts` + `PersonDetailClient.tsx` — удалять снизу вверх.

### 3.4. Схема + миграция (`prisma/schema.prisma`)

**Дроп:** поля `commitmentStatus` (`:3459`), `commitmentAskedAt` (`:3471`), `commitmentEscalatedAt` (`:3473`); индексы `:3533` и `:3536` (содержат `commitmentStatus`); модель `PromiseNetworkSnapshot` (`:7833-7844`) + back-ref `Org.promiseNetworkSnapshots` (`:2804`).
**Оставить:** `commitmentDueDate` (`:3457`), `commitmentRecipientPersonId`+relation (`:3461/3521`), `commitmentAuthorPersonId`+relation (`:3469/3523`), `Person.commitmentsToMe/commitmentsAuthored` (`:5134/5136`), индексы `:3542`/`:3544` (по author).
**Код под миграцию (иначе typecheck/runtime упадёт):** `block-ingest.worker.ts:1345-1349` (убрать запись `commitmentStatus:'open'`, оставить `commitmentDueDate`); `onboarding.service.ts:773-774` (убрать `promiseNetworkSnapshot.deleteMany`); `onboarding/demo-data/pulse-snapshots.ts:190` + `knowledge-graph.ts` (demo).
**Миграция:** `prisma:migrate --name drop-commitment-social-layer` → `DROP TABLE promise_network_snapshots` + `DROP INDEX` ×2 + `ALTER TABLE IdeaBlock DROP COLUMN` ×3. Данные `status/askedAt/escalatedAt` теряются безвозвратно — допустимо (прод ~4 юзера, [project_prod-scale-early]). Commitment-блоки не трогаются.

**Развилка enum (§8):** `SignalType.commitment_status` (`:444`) и `IdeaBlockLinkType.resolves` (`:702`) становятся осиротевшими. Дроп значения enum в Postgres хрупкий (пересоздание типа + pre-DELETE данных) → **рекомендую оставить осиротевшими**, почистить только код-потребителей промпт-словарей (`block-ingest.prompt.ts:39`, `extract-plan.prompt.ts:139`, `signal-type-label.ts:55`, `chat-v2.service.ts:321`, `env.schema.ts:367` дефолт `BITEMPORAL_FACT_SIGNAL_TYPES`).

### 3.5. Крутилки / ENV / seed / feature-flags

**Удалить:** `COMMITMENT_FOLLOWUP_ENABLED` (env.schema:643, typed:1588), `COMMITMENT_FOLLOWUP_LOCAL_HOUR` (:644/1589, registry:488, seed-llm-models-and-gray:137), `COMMITMENT_ESCALATION_DAYS` (:646/1595), `COMMITMENT_MAX_RETRIES` (:647/1596), `operations.promise_cascade.enabled` (registry:261, seed-execution-agents:155, feature-flags.md:95), `reliability.min_denominator` (registry:176, seed-execution-agents:29). Плюс env-classification.ts:496-500.
**Оставить:** `knowledge.commitmentAuthorAttributionEnabled` (атрибуция автора = факт, feature-flags.md:86), `blocker_synthesis.impact.commitment` (вес блокера, не соц-слой).
**Развилка (§8):** `COMMITMENT_FALLBACK_DUE_WORKDAYS` (:645/1594) — оставить, если оставляем due-fallback (рекомендую).
Обновить hint `apply-prod-deploy.ts:207` (убрать `reliability.min_denominator`, `promise_cascade`).

### 3.6. Метрики / probe-реестры / LLM taskType

**Метрики (`business-metrics.service.ts`):** удалить `incCommitmentsAsked/Fulfilled/Missed/Escalated/ExtractFailed` (:7788-7811) и `incPromiseCascadeAlert` (:5257) + counter `promise_cascade_alert_total` (:1938).
**Probe-реестры:** reason `commitment.followup`/`commitment.silence_escalation` осиротеют — почистить `probe/probe-reason-policy.ts:13,38,39`, `probe/probe-reason-labels.ts:47,48,106,107` (+ их spec).
**LLM:** `llm-router.service.ts` taskType `'commitment-extract-status'` (:386-389, :853) удалить; **оставить** `'commitment-extract-dates'` (срок = факт).

### 3.7. Бэкафилы + apply-prod-deploy STEPS

- `backfill-commitment-author.ts` — **оставить как есть** (автор = факт; STEPS:750).
- `backfill-commitment-due-dates.ts` — **переписать** (сейчас пишет `commitmentStatus:'open'`+due, фильтр по `commitmentStatus:null`): убрать `commitmentStatus`, фильтр на `commitmentDueDate:null` (STEPS:612). Развилка §8 (если due-fallback не нужен — удалить скрипт + STEPS).

---

## 4. Порядок удаления (снизу вверх, чтобы сборка не падала между шагами)

1. Контроллеры/cron (листья) → 2. handler/service-провайдеры → 3. строки в `operations.module.ts` (94,125-128,157-158,171,181-182,189,196) и `dashboard.module.ts` (22,38,56,64) → 4. router-case `commitment_status` → 5. probe-реестры → 6. метрики → 7. потребители (дайджесты/дашборды/frontend, синхронно с DTO) → 8. config/ENV/admin-registry/seed → 9. схема + миграция (последней, т.к. дроп колонки требует, чтобы все `select:{commitmentStatus}` уже ушли) → 10. feature-flags.md. Спеки удаляемых файлов — вместе с ними.

---

## 5. Развилки для владельца (с рекомендацией)

- **Р1 «overdueCommitments» в daily-digest:** запрос частично про `commitmentDueDate` (факт). **Рекомендую** удалить секцию целиком (она про «висящие обещания» = соц-слой), оставив только count-факт, где он используется отдельно.
- **Р2 «Обещано мне» (`promised_to_me` в personal-brief, по recipient):** соц-слой или факт? **Рекомендую** удалить (входит в «соц-слой обещаний»), т.к. без статусов «выполнено/нет» это просто список без действия.
- **Р3 `commitments.api`/`PersonCommitmentsSection` (карточка обещаний на персоне):** **Рекомендую** удалить (часть соц-слоя UI).
- **Р4 enum-drop (`commitment_status`, `resolves`):** **Рекомендую НЕ дропать** значения (оставить осиротевшими) — Postgres enum-drop хрупкий, выгода нулевая; почистить только код.
- **Р5 due-fallback (`COMMITMENT_FALLBACK_DUE_WORKDAYS` + backfill):** **Рекомендую оставить** (дешёвый fallback срока-факта, полезен для будущей связи обещание↔задача).

---

## 6. Вынесено из ТЗ (зафиксировано в реестре) — но важно для блюпринта

**«Обещание → задача себе» — отдельный механизм, НЕ часть этого ТЗ:**
- роутинг `commitment`→TASKS ([router.service.ts:430](../../backend/src/modules/knowledge-core/services/router.service.ts#L430)) + допустить `commitment` в worker ([specialist-3-15-tasks.worker.ts:16](../../backend/src/modules/knowledge-core/workers/specialist-3-15-tasks.worker.ts#L16));
- брать исполнителя из `commitmentAuthorPersonId`→`Person.userId`, срок из `commitmentDueDate`;
- снять в quality-gate требование owner‖due для обещаний ([task-quality-gate.util.ts:143](../../backend/src/modules/tracker/services/task-quality-gate.util.ts#L143));
- усилить промпты `tasks-unified.ts:173` / `task-extract.prompt.ts` (+ обновить снапшот);
- дедуп с `meeting-extract-actions` (иначе одна реплика встречи = 2 задачи — общий guard по `sourceBlockIds`);
- пробел «обещание из ЧАТА → задача» (meeting-extract только для встреч).

**⚠️ Риск «провала между этапами»:** этот ТЗ снимает соц-слой (обещания уходят из дашбордов), а вынесенный этап (обещание→задача) ещё не сделан → между ними обещание = «голый факт памяти», не видимый ни в дашбордах, ни в задачах. **Решение владельца 2026-06-29: провал принят осознанно** — делаем только чистку сейчас, механизм задачи отдельным ТЗ позже. Обещание остаётся доступным через память/поиск/граф (не исчезает совсем).

**Связь обещание↔задача** реализуется бесплатно через `Issue.sourceBlockIds` (commitment-блок уже попадает в провенанс) — новой таблицы не нужно; навигация «задача→обещание» = запрос `IdeaBlock where id in Issue.sourceBlockIds`.

---

## 7. Ограничения и непроверенное

- `[unverified]` Точное число затронутых frontend DTO-полей — оценка по grep+Read; финальный список tz-author/orchestrator уточняет компиляцией.
- `[inferred]` «who-shined/whoStruggled пустеют» — зависит от наличия recognition/red-checkin в конкретном тенанте; на проде проверить пустые состояния глазами (qa-tester) после выката.
- `[assumption]` Удаление данных `commitmentStatus` безопасно — верно при текущем масштабе (~4 юзера); если соц-слой обещаний понадобится восстановить, история статусов будет потеряна (git хранит код, не данные).
- enum-drop и связь обещание↔задача — пограничные с вынесенным этапом; в этом ТЗ их трогаем минимально (enum — не дропаем, связь — не строим, т.к. задача ещё не создаётся из обещания).

## 8. Источники (код Z, verified)

router `:426-453` · specialist-3-15-tasks.worker `:16` · operations.module `:94,125-128,157-158,171` · dashboard.module `:22,38,56,64` · commitment-reliability fan-out (director/team-detail/people-at-risk/team-health/person-pulse) · schema `:3457-3473,3533,3536,3542,3544,2804,7833-7844,444,702` · env.schema `:643-647,367` · typed-config `:1588-1596` · admin-setting-schema-registry `:176,261,488` · seed-execution-agents `:29,155` · business-metrics `:5257,7788-7811,1938` · backfill-commitment-{due-dates,author}.ts · apply-prod-deploy `:207,612,750` · tasks-unified `:173` · task-quality-gate `:143` · decision-task-link.util (прецедент). Рыночный разбор (snapshot 2026-06-29): Fellow×Linear, Claryti, Granola, EOS — см. историю этого файла (git).
