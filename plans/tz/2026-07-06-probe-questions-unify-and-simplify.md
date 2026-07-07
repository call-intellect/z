---
type: tz
status: ready-to-implement
feature: probe-questions-unify-and-simplify
date: 2026-07-06
owner: sergrv80@gmail.com
relates_to:
  - plans/architecture/2026-07-06-probe-questions-unify-and-simplify.md
  - plans/analysis/2026-07-06-probe-prod-reality-vs-stand.md
  - plans/tz/2026-06-29-kora-clarify-questions-overhaul.md
supersedes: plans/tz/2026-07-04-probe-ownership-ladder-autofill.md
---
> Архитектура (одобрена владельцем 2026-07-06): `plans/architecture/2026-07-06-probe-questions-unify-and-simplify.md` (status: approved) · Прод-замер: `plans/analysis/2026-07-06-probe-prod-reality-vs-stand.md` · Предшественник (реализован): `plans/tz/2026-06-29-kora-clarify-questions-overhaul.md`.

# ТЗ: Кора спрашивает меньше и по делу — снятие оставшегося шума + деплой батча

## Принцип
Кора спрашивает человека **только в двух местах**: (1) уточнение по задаче «ты сказал — непонятно кому/к сроку»; (2) недельное напоминание собственнику про профиль компании. **Всё остальное молчит**: структурные дырки дозревают сами; сущности (эксперимент, сигнал, клиент) остаются видимыми на своих страницах/в графе — их **показываем, а не спрашиваем**. Шум = **push-вопросы**; снимаем именно push, пассивные поверхности не трогаем. Без комментариев в коде (CLAUDE.md). Крутилки — `AdminSetting`. Ship-On.

## Цель
Снять оставшийся шум уточняющих вопросов, который **не покрыт** уже реализованным (на ветке) ТЗ `kora-clarify-questions-overhaul`, и выкатить в прод весь накопленный батч. Конкретно: снести инспектор порядка; снять push-вопросы attribution/experiment/insight (оставив пассивные поверхности); сохранить живым task-clarify; убедиться, что профиль остаётся недельным; собрать прод-инструкцию на деплой батча.

## Зачем (болезненное состояние)
Прод-замер за 7 дней (~660 вопросов/нед): инспектор порядка `consistency_violation.R1/R2/R3/R6` = **~498** (шаги без ответственного/результата, документы-сироты, дубль профиля); `attribution.unresolved_at_ingest` = 91; `experiment.no_owner` = 29; `insight.no_mitigation_plan` = 21 (реально доходит — 20 push). Люди завалены, доверие падает. Ценное (task-clarify, «как решал») тонет.

---

## REALITY-CHECK (факт на ветке `work/2026-07-02`, 2026-07-06 — номера строк перечитать по якорю-символу перед правкой)

### Уже сделано (ТЗ `kora-clarify-questions-overhaul`, Ф1–Ф7 = `[x]`, НЕ выкачено в прод)
| Сделано | Коммит | Значит для этого ТЗ |
|---|---|---|
| Снос инспектора РЕШЕНИЙ (`decision.*`) | `750e0df5` | не трогаем — только деплой |
| Снос инспектора ОБЕЩАНИЙ (`commitment.followup`/escalation) | `d9a6fbdf` | не трогаем — только деплой |
| Снос вопросов РЕГЛАМЕНТОВ + авто-назначение владельца сохранено | `7091e316` | не трогаем — только деплой |
| Авто-привязка Regulation/Instruction к автору (owner + причастные) | `922df7f5` | автопривязка «есть» — деплой |
| Авто-привязка Process/Policy к автору | `4bdb9655` | автопривязка процессов «есть» — деплой |
| Задачи: адресат = постановщик (автор реплики) | `910900fe` | task-clarify идёт правильному человеку |
| Задачи: срок на извлечении + ежедневный свод | `67b5e8d3` | task.due_date_missing живёт |
| Агент «расскажи, как решал» | `f01a4172` | не трогаем |

### Что осталось живым (эмиттеры — карта, снято grep-ом 2026-07-06)
| Пункт | Эмиттер (файл:якорь) | Провенанс/recheck уже есть? |
|---|---|---|
| A. Инспектор порядка | `curation/workers/consistency-checker.cron.ts` (`ConsistencyCheckerService.emitProbe` :382, `reason='consistency_violation.${rule}'` :386); cron `@Cron('0 */4 * * *')` :428; регистрация `curation/curation.module.ts:16-19,36-37` | recheck НЕТ; provenance для `process_template` в `probe-reason-policy.ts` есть, но R-правила его не используют |
| B. attribution | `knowledge-core/workers/block-ingest.worker.ts:1765 emitAttributionProbe` (только `customer`/`vendor` + `isEntityUnattributed`), recipients :1809 | recheck ЕСТЬ (`probe-reason-policy.ts:223-251` — снимает, если атрибутировали до отправки); авто-резолва НЕТ |
| C. experiment | `knowledge-core/services/specialist-3-9-experiment-probe.service.ts` (`checkNoOwnerForOrg` :69 → `experiment.no_owner` :97; также `result_without_lesson` :53, `running_too_long` :237) | авто-владелец УЖЕ есть — `tryResolveOwner` :112 (owner-resolver-лестница), emit только при `ambiguous`/`none` |
| D. insight | `knowledge-core/services/specialist-3-5-probe.service.ts` (`checkNoMitigationPlanForOrg` :106 → `insight.no_mitigation_plan` :129; также `escalation_suggested` :72, `recurring_after_mitigation` :91, `linked_decision_question` :48); proactive-дубль insight-правила в `proactive/services/proactive-watcher.service.ts` | поверхность `/insights/${id}` есть (actionUrl :162) |
| E. task-clarify (сохранить!) | итерация-1 (uncommitted) добавила `task.assignee_unresolved`/`task.due_date_missing` в `MACHINE_FILLABLE_REASONS` → провенанс-гейт (`probe.service.ts`) заглушил бы их | на HEAD этих ключей в MACHINE_FILLABLE НЕТ (провенанс = стаб `'unknown'`) |

**Иттерация-1 (uncommitted, 4 файла):** `probe-reason-policy.ts` (+task.* в MACHINE_FILLABLE, +impl `resolveProbeProvenance`), `probe-reason-policy.spec.ts`, `consistency-checker.cron.ts` (R3-фильтр наследования — станет moot после сноса), `probe-stand/stand.ts`. **Целила в task-шум — неверная мишень (прод: задачи ≈ мелочь). Откатываем полностью** (Ф2).

---

## Принятые решения владельца (2026-07-06, НЕ пересматривать)
| # | Решение | Обоснование |
|---|---|---|
| Р1 | Инспектор порядка (consistency-checker R1–R6) — **снести в коде + деплоем**, НЕ рубильником | «нормально этого инспектора в принципе убирать»; данные дозревают сами агентами |
| Р2 | attribution-вопрос «к чему отнести X» — **убрать push**; попытаться дожать по контексту, не вышло → молчим (сущность в графе) | «дожимать контекст»; человека не пытаем |
| Р3 | experiment `no_owner` (и прочие experiment push-вопросы) — **убрать**; сущность `Experiment`, страница `/experiments`, авто-владелец — **оставить** | «эксперимент = задача»; вопрос-инспектор дублирует задачную петлю (как обещания в Ф2) |
| Р4 | insight `no_mitigation_plan` (и прочие insight push-вопросы) — **убрать push**; сигнал остаётся видимым на `/insights` (дашборд/риск) | «сигнал/риск → задача или дашборд, не отдельный вопрос» |
| Р5 | task-clarify (`task.assignee_unresolved`/`due_date_missing`) — **оставить живым**, откатить итерацию-1 | это ровно одно из двух, что Кора ДОЛЖНА спрашивать |
| Р6 | Профиль компании — **оставить недельное** напоминание собственнику; дубль R6 уходит с инспектором (Р1) | одно из двух разрешённых мест вопроса |
| Р7 | Финал — **деплой всего батча** (overhaul Ф1–Ф7 + это ТЗ) в прод, только по явному «да» владельца | прод отстал от ветки; половина шума снимается именно деплоем |

## Развилки владельца (safe-default применяю, глубже — vNext по решению)
| Развилка | Safe-default (реализую сейчас) | Глубже (vNext, нужно «да») | Рекомендация |
|---|---|---|---|
| Судьба сущности `Experiment` | Оставить сущность + `/experiments` + авто-владельца; снять только push-вопросы | Полный мост «эксперимент → Issue» (эксперимент становится задачей) | **Оставить** сейчас (как обещания в Ф2); мост — отдельное ТЗ |
| Глубина авто-attribution (B) | Best-effort авто-привязка по со-упоминаниям в том же блоке; не вышло → молчим | LLM/граф-резолвер атрибуции | Best-effort сейчас; если дорого — просто снять push (сущность в графе), авто — vNext |
| insight → авто-задача (D) | Снять push; сигнал виден на `/insights` | Авто-создание Issue из high/critical insight | **Дашборд** сейчас (авто-задача рискует новым спамом); авто-задача — по явному решению |
| Прочие insight-вопросы (escalation/recurring/linked_decision) | Снять как push (в дайджест/убрать), не в поле правильности | — | Убрать push, оставить эскалацию видимой на `/insights` |

---

## Scope
**Входит:** Ф1–Ф7 ниже.
**Не входит (отдельные ТЗ / vNext):**
- Полный мост «эксперимент → задача» и депрекация сущности `Experiment` (развилка выше) → vNext.
- Авто-создание задач из insight; LLM-резолвер attribution → vNext.
- Соц-слой обещаний / мост обещание→задача → `commitment-task-unification` (не трогаем).
- Фикс Person→Entity резолва (точность привязки к клону) → строка `04_не-сделано`, не блокирует.
- Правки `docs/testing/probe-field-rules.md` — только владелец (ТЗ предлагает, где).

## Граничные контракты
- overhaul-ТЗ Ф1–Ф7 — **реализовано, не трогаем**; здесь только выкатываем.
- Пассивные поверхности (`/experiments`, `/insights`, граф) — используем как есть; не строим новые экраны.
- Доставка probe, дайджест, диспетчер ответов — как есть.

---

## Фазы

### Ф1 — Снести инспектор порядка (consistency-checker R1–R6)
**Ценность.** Как владелец — перестаю получать утренние «у шага X нет ответственного / шаг без результата / документ без процесса» (498/нед): структурные дырки дозревают сами.
**Картография (перечитать по якорю).**
- `curation/workers/consistency-checker.cron.ts` — **удалить файл целиком** (`ConsistencyCheckerService` + `ConsistencyCheckerCron`, cron `@Cron('0 */4 * * *')`, все R1–R6, `emitProbe`, метрики-вызовы).
- `curation/curation.module.ts` — убрать import (:16-19) и провайдеры `ConsistencyCheckerService`, `ConsistencyCheckerCron` (:36-37). (В `exports` их нет.)
- `probe/probe-reason-policy.ts` — убрать `consistency_violation.R1..R6` из `PROBE_REASON_WINDOW` (:9-14). Ветку `process_template` в `resolveProbeProvenance` не трогаем (Ф2 её откатит к стабу — согласовать порядок).
- `probe/probe-reason-labels.ts` — метки `consistency_violation.*` оставить **терпимыми к чтению истории** (fallback-метка), как сделали для `decision.*` в Ф1 overhaul; либо удалить синхронно с тем, как там. Чтение старой строки `probe_events.reason='consistency_violation.*'` не должно падать.
- `common/metrics/business-metrics.service.ts` — `incConsistencyViolation`, `observeConsistencyCheckerDuration`: удалить методы + их регистрации (Counter/Histogram), если после сноса на них нет ссылок (grep). Если проще — оставить определения (мёртвые метрики безвредны); **решение при реализации по grep-у ссылок**.
- `admin/settings/admin-setting-schema-registry.ts` — удалить строки `curation.consistencyCheckerEnabled`, `curation.consistencyCheckerDedupTtlSeconds`; сид (`seed-admin-settings.ts`) — убрать соответствующие сиды; ENV (`env.schema.ts` `CONSISTENCY_CHECKER_ENABLED`/`CONSISTENCY_CHECKER_DEDUP_TTL_SECONDS`) + `typed-config` — убрать, если больше нигде.
- Тест `consistency-checker.cron.spec.ts` — удалить.
- Фронт `/curation` (actionUrl вёл туда) — **не трогаем** (страница остаётся для прочего).
**Что НЕ входит.** Остальные curation-воркеры (`CompletenessScanner`, `ConflictArbiter`, `CardStaleDetector`, `CurationItemLifecycle`, `CurationAutotune`) — остаются.
**Acceptance.**
- `grep -rn "ConsistencyChecker" backend/src --include=*.ts` → 0 (файл, регистрация, спека удалены).
- `grep -rn "consistency_violation" backend/src` вне терпимых меток-фолбэков и исторических данных → 0 в эмиттерах/реестрах/WINDOW.
- `grep -rn "consistencyChecker" backend/src` (флаги) → 0.
- чтение историч. `reason='consistency_violation.R3'` не падает (unit по образцу decision-фолбэка Ф1).
- `bun run typecheck` (вкл. `.spec`) / `lint` / `build` зелёные.
**Закрывает:** Р1.

### Ф2 — Откатить итерацию-1 (сохранить task-clarify живым)
**Ценность.** Как постановщик — Кора продолжает спрашивать меня «кому поручить / к какому сроку», когда я поставил задачу и это непонятно (это разрешённый вопрос №1).
**Что входит.** `git checkout HEAD -- backend/src/modules/probe/probe-reason-policy.ts backend/src/modules/probe/probe-reason-policy.spec.ts backend/scripts/probe-stand/stand.ts` (полный откат итерации-1 к HEAD). `consistency-checker.cron.ts` — не через checkout, а удаляется в Ф1. После отката: `resolveProbeProvenance` = стаб `'unknown'` (HEAD), `MACHINE_FILLABLE_REASONS` БЕЗ `task.*` → провенанс-гейт task-clarify не глушит.
**Порядок.** Ф2 (откат) выполнить **до** правок `probe-reason-policy.ts` в Ф1 (иначе checkout затрёт Ф1-правку WINDOW). Практически: Ф2 первым, затем Ф1 правит уже откатанный файл.
**Acceptance.**
- `grep -n "task.assignee_unresolved" backend/src/modules/probe/probe-reason-policy.ts` → присутствует ТОЛЬКО в `PROBE_REASON_WINDOW` и `PROBE_REASON_RECHECK`, НЕ в `MACHINE_FILLABLE_REASONS`.
- `git diff HEAD -- backend/src/modules/probe/probe-reason-policy.spec.ts` → пусто (откатан).
- typecheck/lint/build зелёные.
**Закрывает:** Р5.

### Ф3 — attribution: снять push-вопрос + best-effort авто-привязка
**Ценность.** Как владелец — не получаю «к чему отнести „Логистик Плюс“?»; Кора привязывает сама, а если не смогла — молчит (клиент остаётся в графе).
**Картография.** `block-ingest.worker.ts:1765 emitAttributionProbe` (вызов эмита найти по grep `emitAttributionProbe(`), `resolveAttributionRecipients` :1809, `isEntityUnattributed` (из `probe-reason-policy.ts`).
**Что входит.**
1. **Best-effort авто-привязка** перед эмитом: для нового `customer`/`vendor` без привязки — попытаться связать с со-упомянутыми в том же блоке `department`/`project`/`customer` через существующий граф (`EntityLink` типов `belongs_to`/`part_of`/`member_of`/`owned_by`). Если однозначный кандидат — создать `EntityLink` (best-effort, tenant-scoped, без падения ingest) и **не эмитить** probe.
2. **Убрать push-вопрос:** если авто-привязка не удалась — `emitAttributionProbe` **не вызывать** (удалить вызов / заменить на no-op с метрикой `attribution_unresolved_silent`). Сущность остаётся в графе, дозревает.
3. Реестры: `attribution.unresolved_at_ingest` в `probe-reason-policy.ts` (WINDOW/RECHECK) и labels — оставить терпимыми к истории; из активных эмиттеров убрать.
**Что НЕ входит.** LLM-резолвер атрибуции (vNext).
**Acceptance.**
- unit: `customer` со-упомянут с `department D` (есть кандидат-связь) → создан `EntityLink customer→D`, probe НЕ эмитится.
- unit: нет кандидата → НИ `EntityLink`, НИ probe (тихо); метрика `attribution_unresolved_silent` инкрементнулась.
- `grep -rn "attribution.unresolved_at_ingest" backend/src` вне терпимых меток → 0 живых эмиттеров.
- tenant-изоляция авто-привязки (unit).
- typecheck/lint/build зелёные.
**Закрывает:** Р2.

### Ф4 — experiment: снять push-вопросы, сохранить сущность + авто-владельца
**Ценность.** Как владелец — не получаю «кто ведёт эксперимент?»; эксперимент виден на `/experiments`, ответственный назначается сам.
**Картография.** `specialist-3-9-experiment-probe.service.ts`: `emit` :293 (probe.suggest :306); методы-триггеры `checkNoOwnerForOrg` :69, `emitResultWithoutLesson` :39, `checkRunningTooLongForOrg` :212; **сохранить** `tryResolveOwner` :112 + `publishAutoAssignFeed` :185 (авто-владелец). Найти cron/вызовы этих методов (grep `checkNoOwnerForOrg|emitResultWithoutLesson|checkRunningTooLongForOrg`).
**Что входит.**
1. Убрать **эмиссию probe** из трёх триггеров (`experiment.no_owner`, `experiment.result_without_lesson`, `experiment.running_too_long`): `checkNoOwnerForOrg` оставить как **авто-резолвер владельца без probe** (вызвать `tryResolveOwner`, при `ambiguous`/`none` — метрика, НЕ emit); два других метода + их cron-вызовы — снять.
2. Реестры probe (`probe-reason-policy.ts`, `probe-reason-labels.ts`): `experiment.*` из активных WINDOW/MACHINE_FILLABLE/labels — убрать (labels терпимы к истории). `experiment.no_owner` сейчас в `MACHINE_FILLABLE_REASONS` — удалить оттуда.
3. **Сохранить:** сущность `Experiment`, `/experiments`, `tryResolveOwner`, `publishAutoAssignFeed`, метрики owner-resolution.
**Что НЕ входит.** Мост «эксперимент → Issue», депрекация сущности (vNext-развилка).
**Acceptance.**
- unit: эксперимент без владельца, лестница `resolved` → `ownerEntityId` проставлен, **probe НЕ эмитится**.
- unit: лестница `ambiguous`/`none` → метрика, **probe НЕ эмитится** (раньше эмитился).
- `grep -rn "experiment\\.\\(no_owner\\|result_without_lesson\\|running_too_long\\)" backend/src` в `probe.suggest`-путях → 0.
- `grep -n "experiment.no_owner" backend/src/modules/probe/probe-reason-policy.ts` → нет в `MACHINE_FILLABLE_REASONS`.
- сущность/страница/авто-владелец целы: `grep -rn "tryResolveOwner|publishAutoAssignFeed" ` → присутствуют.
- typecheck/lint/build зелёные.
**Закрывает:** Р3.

### Ф5 — insight: снять push-вопросы, оставить видимым на `/insights`
**Ценность.** Как владелец — не получаю push «что планируете с риском?»; риск виден на `/insights`, разбираю когда смотрю.
**Картография.** `specialist-3-5-probe.service.ts`: `emit` :154 (probe.suggest :165); триггеры `checkNoMitigationPlanForOrg` :106, `emitEscalationSuggested` :72, `emitRecurringAfterMitigation` :91, `emitLinkedDecisionQuestion` :48, `checkAndEmitForInsight` :28. Проактив-дубль: `proactive-watcher.service.ts` (insight-правило) + `proactive-message-craft.service.ts` (шаблон). Поверхность `/insights` (actionUrl :162).
**Что входит.**
1. Снять **push-эмиссию** insight-вопросов (все reason `insight.*` из этого сервиса): методы-триггеры перестают звать `emit`/`probe.suggest`; при отсутствии другой логики — методы/их cron-вызовы удалить.
2. Проактив-правило insight (`proactive-watcher`/`message-craft`) — снять, если дублирует (grep-подтвердить).
3. Реестры: `insight.*` из активных WINDOW/labels — убрать (labels терпимы к истории).
4. **Verify-поверхность:** убедиться, что `/insights` показывает активные `high`/`critical` без `mitigationPlan` (то, о чём был вопрос) — если фильтра/колонки нет, добавить минимальный признак «нет плана» в существующий список (без нового экрана). `[research: осмотреть insights-контроллер/фронт; если уже видно — только подтвердить тестом]`.
**Что НЕ входит.** Авто-создание Issue из insight (vNext-развилка).
**Acceptance.**
- unit: high/critical insight без плана старше 7д → **push НЕ эмитится** (раньше эмитился).
- `grep -rn "insight\\.\\(no_mitigation_plan\\|escalation_suggested\\|recurring_after_mitigation\\|linked_decision_question\\)" backend/src` в `probe.suggest`/proactive-путях → 0 живых.
- `/insights` API отдаёт активные high/critical без плана (integration/e2e или ручная qa-проверка на стенде) — риск не «пропал».
- typecheck/lint/build зелёные.
**Закрывает:** Р4.

### Ф6 — Профиль: подтвердить недельное, дубль R6 ушёл
**Ценность.** Как собственник — про миссию/видение/стратегию меня напоминает **один** агент (профиля), раз в неделю; дубля от инспектора больше нет.
**Что входит.** Verify-only: (1) агент профиля компании (`companyprofile.missing_mission/vision/strategy`) не тронут и остаётся недельным; (2) после Ф1 (снос R6) дубля нет. Кода не добавляем, если verify зелёный.
**Acceptance.**
- `grep -rn "companyprofile.missing_" backend/src` → эмиттер профиля цел (не задет Ф1).
- `grep -rn "R6\\|CompanyProfileMissingMVS" backend/src` → 0 (ушло с инспектором).
- на стенде: профиль без MVS → приходит вопрос профиля, НЕ приходит `consistency_violation.R6`.
**Закрывает:** Р6.

### Ф7 — Деплой батча в прод (после стенд-верификации)
**Ценность.** Как владелец — в проде наконец тихо: и уже сделанное (overhaul), и это ТЗ.
**Что входит.**
1. Стенд-прогон (см. «Верификация на стенде» ниже) — разные ситуации, до/после.
2. Обновить `docs/operations/prod-deploy-log.md`: снятые кроны (consistency-checker; ранее — decision-cron, commitment-followup), снятые флаги (`curation.consistencyChecker*` + overhaul-флаги), изменённые probe-реестры → Шаг 1/12; миграций схемы нет.
3. Прод-инструкция в чат — **diff** (что нового к выкату), ссылка на `prod-deploy-log.md`.
4. **Деплой только по явному «да» владельца** (прод-доступ сейчас read-only; деплой = отдельная санкция).
**Acceptance.** `prod-deploy-log.md` обновлён; в чат выдан diff; получено явное «да» перед `docker compose up -d --build`.
**Закрывает:** Р7.

---

## Граф зависимостей
- **Ф2 → Ф1** (откат `probe-reason-policy.ts` до правок WINDOW).
- **Ф1, Ф3, Ф4, Ф5 — независимы** (разные модули), после Ф2 параллельны.
- **Ф6** — verify после Ф1.
- **Ф7** — последний, после стенд-верификации всех.
- Порядок: Ф2 → (Ф1 ‖ Ф3 ‖ Ф4 ‖ Ф5) → Ф6 → стенд → Ф7.

## Верификация на стенде (разные ситуации, до/после)
Прогнать `backend/scripts/probe-stand/stand.ts` (тенант Стрела) до и после:
- инспектор: структурные дырки (шаг без ответственного/результата, документ-сирота) → **0** `consistency_violation.*` (было — поток).
- эксперимент без владельца, лестница `none` → **0** `experiment.no_owner` (было — вопрос); авто-владелец при `resolved` работает.
- insight high/critical без плана → **0** push; виден на `/insights`.
- attribution customer/vendor → авто-привязка при со-упоминании, иначе тихо, **0** вопросов.
- **task-clarify жив:** задача без исполнителя/срока → вопрос постановщику приходит (регресс-контроль Ф2).
- профиль без MVS → вопрос профиля есть, R6 нет.
Плюс `bun run typecheck` (вкл. `.spec`) / `lint` / `build` / `bunx vitest run` по затронутым модулям.

## Pre-mortem / Риски (для strict-production-review-gate)
- `[risk, Med]` Удаление probe-reason при живых историч. строках `probe_events.reason` — чтение не должно падать. Митигация: эмиттеры/реестры убрать, метки терпимы (fallback), записи не трогаем; unit.
- `[risk, Med]` Ф2-порядок: checkout `probe-reason-policy.ts` затрёт Ф1-правку WINDOW, если Ф1 раньше. Митигация: Ф2 строго до Ф1; Ф1 правит уже откатанный файл.
- `[risk, Med]` Ф3 авто-привязка создаёт неверный `EntityLink` (ложное со-упоминание). Митигация: привязывать только при **однозначном** кандидате; best-effort, tenant-scoped; иначе молчать (не привязывать наугад).
- `[risk, Low]` Ф4: снял probe, но забыл сохранить авто-владельца. Митигация: unit «resolved → ownerEntityId проставлен, probe НЕ эмитится».
- `[risk, Med]` Ф5: снял push, а риск нигде не виден (потеря сигнала). Митигация: verify `/insights` показывает high/critical без плана до снятия push; если нет — добавить признак в существующий список.
- `[risk, High]` Ф7: деплой большого батча (overhaul + это) разом. Митигация: сначала полный стенд-прогон + typecheck/lint/build/тесты; прод — по явному «да»; `prod-deploy-log` как чек-лист; миграций схемы нет (риск ниже).
- `[наблюдаемость]` Метрики probe по снятым reason обнулятся — норма. Добавить `attribution_unresolved_silent` (Ф3) в метрики.

## Прод-операции (prod-deploy-log.md)
- Шаг 1: удалить флаги `curation.consistencyCheckerEnabled`, `curation.consistencyCheckerDedupTtlSeconds` (+ overhaul-флаги `proactive.rules.decisionNoOwner`, `betaOps.commitmentFollowup*`, если ещё не сняты в проде) из реестра/сида/`feature-flags.md`.
- Шаг 12 (smoke): изменённый cron-набор (минус consistency-checker; минус decision/commitment из overhaul), probe-реестры без снятых reason. Миграций схемы **нет** (сущности не трогаем).
- Агрегатор `apply-prod-deploy.ts`: новых seed/patch/backfill/migrate этот ТЗ не вводит.

## DoD
typecheck (вкл. `.spec`)/lint/build зелёные; vitest по затронутым + Acceptance каждой фазы; стенд-прогон до/после; `second-brain/01_projects/probe-agent.md` (снятые инспекторы), `…/ai-jobs.md`/`workers-queues.md` (минус consistency-cron), `04_не-сделано` (закрыть строку про инспектор-шум; строка про Person→Entity как зависимость), `feature-flags.md` + `prod-deploy-log.md`; рефлексия в `05_история/`.

## Итог
**Реализовано целиком (ветка `work/2026-07-02`, 2026-07-06), кроме деплоя (ждёт «да» владельца).**
- [x] Ф2 — откат итерации-1 (task-clarify живой, подтверждён стендом: `runClarifySweep`→probe)
- [x] Ф1 — снос инспектора порядка (cron+модуль+флаги+ENV+реестры удалены; метки истории терпимы)
- [x] Ф3 — attribution: push снят (граф-процессинг дожимает сам; probeService-зависимость block-ingest убрана)
- [x] Ф4 — experiment: 3 push-повода сняты, сущность/`/experiments`/авто-владелец сохранены
- [x] Ф5 — insight: push-поводы сняты (весь `Specialist35ProbeService` снесён), `/insights` остаётся
- [x] Ф6 — профиль verify (агент недельного напоминания цел, R6-дубль ушёл с инспектором)
- [ ] Ф7 — деплой батча (overhaul Ф1–Ф7 + это) — по явному «да»

**Verify:** typecheck BE+FE EXIT 0, lint 0 ошибок, build EXIT 0 (8 ГБ heap), 494 таргет-теста passed (все падения в зоне захода починены). Стенд: AppModule бутится чисто, task-clarify PASS. 24 чужих предсущ. падения вынесены в `plans/analysis/2026-07-06-preexisting-test-failures-triage.md`.
