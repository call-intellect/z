# ТЗ · Автономизация Коры — убрать ручные подтверждения (фазы W0–W4)

> **Тип:** ТЗ на реализацию (`plans/tz/`). **Дата:** 2026-06-11. **Ветка:** svdev.
> **Источник / политика:** [plans/analysis/2026-06-11-manual-confirmation-autonomy-audit.md](../analysis/2026-06-11-manual-confirmation-autonomy-audit.md) — каталог точек подтверждения (§1–§5) и **политика автономии** (§9: уровни AUTO/HYBRID/HUMAN/NUDGE + «лестница владельца»). Рамка: [[feedback_no_human_in_loop_for_clone_learning]] + Ship-On (CLAUDE.md §8). Связано с [[project_probe_system_research_done]].
> **Зачем:** Telegram-бот KORA шлёт «🔔 Ждёт вашего подтверждения: 32» (Решения/карточки 5, Конфликты 9, Задачи 3, Вопросы 15) + «…не назначен ответственный. Назначить?». Система не автономна — слишком много ручных согласований, воспринимается как мусор. Цель — большинство решений перевести в AUTO/HYBRID, человека оставить только для необратимого / денег-доступа / подлинно неоднозначного.
> **Прагматика (важно):** этот документ — контракт на **код-почву**. Тексты промптов (арбитра, судьи, специалистов, probe-formulate, триажа) **дошлифовываем отдельным шагом «улучшаем промпты» вместе** — в фазах они идут первой редакцией. Метод: реализуем→выкат→наблюдаем прод ([[feedback_no_golden_ship_and_observe_prod]]); golden/eval не блокирует.
> **Порядок фаз = порядок реализации:** Ф0 (доставка) → Ф1 (конфликты) → Ф2 (вопросы) → Ф3 (карточки) → Ф4 (задачи). Каждая фаза оставляет систему в рабочем состоянии.

---

## Общая картина кода (REALITY-CHECK)

Все «32 ждёт подтверждения» собирает один агрегатор `PendingActionsService` ([backend/src/modules/pending-actions/services/pending-actions.service.ts](../../backend/src/modules/pending-actions/services/pending-actions.service.ts)) из 4 источников. Решение «дёрнуть человека» принимается **выше — в агентах-источниках**, поэтому чиним гейты, а не витрину:

- **curation** — `CurationItem(pending)`; гейт `CurationService.triage()` ([curation.service.ts:218](../../backend/src/modules/curation/services/curation.service.ts)); пороги admin-editable ([typed-config.service.ts:1491](../../backend/src/common/config/typed-config.service.ts)).
- **conflict** — `ConflictItem(open)`; **гейта авторазрешения НЕТ** (TODO [conflict.service.ts:62](../../backend/src/modules/curation/services/conflict.service.ts)).
- **intake** — `IntakeIssue(pending)`; авто-триаж принимает сам **только `source==='meeting'`** ([intake-auto-triage.worker.ts:329](../../backend/src/modules/tracker/workers/intake-auto-triage.worker.ts)).
- **probe** — `Notification(probe.question, pending)`; единый вход `ProbeService.suggest()` ([probe.service.ts:55](../../backend/src/modules/probe/probe.service.ts)) **без гейта ценности**, cold-start сломан ([probe.service.ts:278](../../backend/src/modules/probe/probe.service.ts) `?false:false`).
- Усилитель спама: `PendingActionsReminderCron` ([pending-actions-reminder.cron.ts](../../backend/src/modules/pending-actions/workers/pending-actions-reminder.cron.ts)) — до **5 пингов/день** (слоты из `cfg.pendingActions`, дефолт 9/21/3).
- Готовая инфраструктура дебатов: `MultiAgentDebateService.judge()` ([multi-agent-debate.service.ts](../../backend/src/modules/ai/services/multi-agent-debate.service.ts)) — семейства `decision-supersede`, `curation-verify`; +новое семейство = +2 записи в карты + новые taskType-роуты.

---

## Развилки для владельца (сквозные)

- **Р1 — флаги ON+kill-switch, не OFF.** Новые арбитры (Ф1) выкатываем **включёнными** с kill-switch, а не «OFF→понаблюдаем». Прецедент в коде `goalTaskLinkEnabled=false` ([typed-config.service.ts:1629](../../backend/src/common/config/typed-config.service.ts)) — но это нарушает Ship-On и плодит «склад выключенного». Безопасность даёт **гейт уверенности** (split/uncertain → человек) + обратимость версий, а не флаг-OFF. *Рекомендация: ON.*
- **Р2 — что остаётся за человеком.** «Решения владельца» (деньги/доступ/необратимое, CLAUDE.md §8б) НЕ автономизируем. Все 4 источника скриншота — знаниевые, автономизируем.
- **Р3 — каденция доставки (Ф0).** *Рекомендация: 1 сводка/день (09:00) + немедленный пинг только для urgent.* Доказательство: батч-дайджест — стандарт против notification-fatigue; срочное всё равно прорывается.
- Развилки уровня фазы — внутри фаз ниже.

---

## Фаза 0 (W0) — гасим спам доставки `[x]`

**Цель:** убрать ощущение мусора частотой, независимо от числа pending. Палиатив, не автономия.

- **Ф0.1** Каденция reminder-cron: в `seed-admin-settings.ts` дефолт `pendingActions.reminderStepHours` 3→12 (или `reminderWindowEndHour` 21→9 = один слот). Синхронно code-default в [typed-config.service.ts:1584](../../backend/src/common/config/typed-config.service.ts). Текст: «сводка раз в день; срочное приходит сразу».
- **Ф0.2** Гейт немедленного probe-пинга: в `probe-dispatcher.worker.ts` слать мгновенно только если `ProbeEvent.priority ≥ cfg.probe.immediatePushMinPriority` (новая крутилка, дефолт ~70 = urgent); иначе probe виден в `/actions` и войдёт в дневную сводку, без отдельного пинга. *Предположение (проверить): `priority` уже = severity_weight×100 в suggest.*
- **Ф0.3 (опц., не без подтверждения)** Не плодить дайджест-каналы: единый блок «ждёт подтверждения» уже даёт `buildReminderBody`; объединять с COO `daily-digest` — только по согласованию (разная аудитория).

**Минимально:** Prisma не трогается; только дефолты крутилок + один порог.

---

## Фаза 1 (W1) — LLM-арбитр конфликтов `[x]`

**Цель:** перевести конфликты из «всегда HUMAN» в HYBRID (авто-резолв при уверенности). Закрывает крупнейший пул.

**Развилки фазы:** Р1.1 порог авто-резолва — *рекомендация: consensus (unanimous/majority) + avg-confidence победителей ≥ 0.7* (крутилка `conflictArbiterMinConfidence`), симметрично provisional. Р1.2 системный актор резолюции — *владелец Org* (`reasoning='[Кора-арбитр] …'`), как `intake.autoAccept` берёт `project.ownerId`.

- **Ф1.1** Новое debate-семейство `conflict-arbiter` в `multi-agent-debate.service.ts`: `DebateTaskFamily += 'conflict-arbiter'`; `STANCE_TASK_TYPES_BY_FAMILY` += `{critic:'debate-conflict-arbiter-critic', supporter:'…-supporter', neutral:'…-neutral'}`; `STANCE_SYSTEM_PROMPTS_BY_FAMILY` += первая редакция (verdict `keep_old|accept_new|merge|evolving|escalate`, cache-friendly: стабильный SYSTEM, данные в user). **Тексты — шаг «улучшаем промпты».**
- **Ф1.2** Регистрация taskType: в union `LlmTaskType` (llm-router.service.ts) + `ALL_LLM_TASK_TYPES` 4 типа (зонтичный `debate-conflict-arbiter` + 3 stance), иначе DEFAULT-цепочка ([[project_llm_tasktypes_missing_from_registry]]). Сидинг `LlmTaskRoute` по образцу `debate-curation-verify-*` (диверсные провайдеры; сверить [llm-providers-verified.md](../../second-brain/01_projects/llm-providers-verified.md), Anthropic нельзя).
- **Ф1.3** `ConflictArbiterCron` (`backend/src/modules/curation/workers/conflict-arbiter.cron.ts`, паттерн `curation-autotune.cron`): `@Cron` gated на `cfg.curation.conflictArbiterEnabled` (kill-switch ON). Sweep `ConflictItem(open)` (лимит/проход), подгрузка payload'ов обеих карточек (последняя `CardVersion`) + evidence/relationType → `debate.judge({taskFamily:'conflict-arbiter', taskType:'debate-conflict-arbiter', …})`. Авто-резолв ТОЛЬКО при consensus + verdict≠escalate + `fallbackUsed===null` + порог (Р1.1) → `ConflictService.resolve()` от владельца Org. Для `evolving` нужен `existingValidUntil`/`newValidFrom` — арбитр предлагает; не смог → escalate→HUMAN. split/escalate/fallback → оставить open.
- **Ф1.4 (HYBRID-аудит)** Post-hoc не блокирующее `system.message` владельцу о факте авто-резолва (можно открыть/откатить). Опц. `conflictArbiterAuditRate` — % авто-резолвов помечать для человеческой пере-проверки.
- Маппинг verdict→`ConflictResolutionDto`: сверить точный Prisma-enum `ConflictResolution` при реализации. Метрики `z_conflict_arbiter_total{verdict,outcome}` + `incCurationConflict`.

---

## Фаза 2 (W2) — probe: гейт ценности + «лестница владельца» + NUDGE→дайджест `[x]`

**Цель:** самый массовый пул (вопросы). Три рычага. Прямо закрывает скриншотный «не назначен ответственный».

**Развилки фазы:** Р2.1 порог гейта — *дропать probe с `priority < cfg.probe.minValuePriority` (дефолт ~30), писать `ProbeEvent(status='dropped_low_value')` для аудита*. Р2.2 где спрашивать owner — *только на шаге 4 лестницы (≥2 кандидата), вопросом-выбором «Иванов или Петров?», а не «Назначить?»*. Р2.3 исторические/merge-вопросы разрешает арбитр Ф1, не probe.

- **Ф2.1** Гейт ценности + реклассификация NUDGE в `ProbeService.suggest()`: если `reason ∈ NUDGE_REASONS` → не `probe.question`, а доставка дайджестом + `ProbeEvent(status='routed_to_digest')` (выпадает из счётчика автоматически, т.к. `probe.provider` считает только `probe.question`); если `priority < minValuePriority` → `dropped_low_value`. `NUDGE_REASONS` (из политики §9.2): `decision.overdue`, `decision.outcome_unknown`, `goal.kr_checkpoint_suggested`, `commitment.followup`, `commitment.silence_escalation`, `goal_alignment_low`. Новые статусы enum `ProbeEvent.status` (миграция). **Починить cold-start** ([probe.service.ts:278](../../backend/src/modules/probe/probe.service.ts)).
- **Ф2.2** `OwnerResolver` (shared) — `resolve({tenantId, parentOwnerId?, role?, authorUserId?, candidatePool?})` → `{userId}|{candidates}|null` по «лестнице владельца» (§9.3: владелец родителя → единственный держатель роли → автор → ambiguous → null). Применить в `process-template-probe.service.ts` для `step_without_owner`: `{userId}` → назначить (AUTO) + лента «что сделала Кора», без probe; `{candidates>1}` → probe-выбор; `null` → NUDGE. *Предположение: у процесса/шага есть ownerId/роль/автор — проверить схему.*
- **Ф2.3** Раскатка лестницы на `regulation.missing_owner`, `card.missing_owner`, `decision.missing_decider`, `experiment.no_owner` (AUTO-first); `*.missing_deadline`/`no_deadline_critical` — вывод из каденции/похожих, нет сигнала → NUDGE. (~6 специалистов по одному образцу — чиним класс, [[feedback_fix_the_whole_class_not_the_case]].)
- **Ф2.4** Авто-черновик для HYBRID: `regulation.process_no_steps`, `experiment.result_without_lesson` → набросать черновик из контекста + post-hoc «проверьте», не блокируя. `knowledge.new_expertise_detected`, `skill.profile_starved`, `skill.contradicting_traits` → AUTO (тихо записать/judge), probe убрать.
- **НЕ автономизируем** (остаются HUMAN): `regulation.scope_unclear`, `insight.*` (mitigation/escalation/recurring) — нужна управленческая оценка.
- Probe без кнопок сохраняется ([[feedback_probe_no_buttons_text_voice_only]]) — выбор текстом. Метрики `z_probe_event_total{status}`, `z_owner_autoresolved_total` vs `_escalated_total`.

---

## Фаза 3 (W3) — curation: пороги, аудит-выборка, AI-судья `[x]`

**Цель:** убрать аудит-шум + перевести «критич.→человек» в «критич.→provisional».

**Развилки фазы:** Р3.1 `auditSampleRate` 0.05→**0.01** (баланс шум/сигнал; не 0 — нужен сигнал для autotune/kill-switch). Р3.2 состав `criticalTypes` — *оставить, тюнить `provisionalThreshold`, а не убирать тип (убрать = потерять AI-проверку)*. Р3.3 `deepReviewThreshold` 0.6 — *не трогать, чинить калибровку промптами*.

- **Ф3.1** Крутилки: `seed-admin-settings.ts` `knowledge.curationAuditSampleRate` 0.05→0.01; убедиться `curationAutotuneEnabled=true`; синхронизировать code-default. Без кода-логики.
- **Ф3.2 (промпты, шаг «улучшаем промпты»)** `curation-verify` stance-промпты — уверенный accept на очевидно-корректных критических карточках; промпты специалистов Слоя 3 — честная, не заниженная `confidence` через `withConfidenceCalibration` (F16; enum-промпты skill-trait/clone/helpfulness НЕ трогать). Правка code-fallback SYSTEM → `_V2` (F10), не на месте.
- **Ф3.3** Наблюдаемость: доля auto/provisional/deep/light по типам; `getProvisionalAuditStats` + `KILL_SWITCH_PROVISIONAL_THRESHOLD` уже есть. Цель — рост auto+provisional при стабильном wrongRate.
- Schema не трогается.

---

## Фаза 4 (W4) — intake: авто-приём задач из всех каналов `[x]`

**Цель:** убрать класс «задачи из Telegram/in-app всегда к человеку».

**Развилки фазы:** Р4.1 при невыводимой атрибуции — *создавать Issue в дефолт-проект «Входящие» на автора (AUTO), не мариновать в pending* (задача обратима). Р4.2 порог `autoAcceptConfidenceThreshold` — *оставить 0.75, не занижать* (внешние каналы шумнее; страхует дефолт-маршрут). Р4.3 injection-guard — оставить включённым.

- **Ф4.1** В `canAutoAccept` убрать `intake.source === 'meeting'`; оставить `confidence ≥ порог && assignee && project`. Для не-meeting: `resolveAssigneeUserId` (substring), при `null` исполнителе → автор задачи. *Предположение: в `IntakeIssue` есть автор внешнего канала — проверить; нет → owner Org + метка «уточнить».*
- **Ф4.2** При `suggestedProjectId===null` — резолв/создание дефолт-проекта «Входящие» per-tenant, затем `autoAccept`. Гард дубля `createdIssueId` уже есть ([:414](../../backend/src/modules/tracker/workers/intake-auto-triage.worker.ts)) — сохранить.
- **Ф4.3 (промпт, шаг «улучшаем промпты»)** `INTAKE_AUTO_TRIAGE_SYSTEM` — лучше извлекать проект/исполнителя/цель из контекста внешнего канала (меньше null), `_V2` (F10).
- **Ф4.4** Метрики `incAiIntakeAutoAccepted`/`incAiIntakeSuggested{status}` += разрез по `source` и «через дефолт-проект».

---

## Совместимость / риски (сквозные)

- **Ship-On:** все фичи выкатываем включёнными; пороги/доли/каденция — admin-editable крутилки ([[feedback_admin_settings_not_env_or_code]]); единственный флаг — kill-switch `conflictArbiterEnabled` (ON). Никаких OFF-флагов. Каждый новый флаг/крутилка → строка в [docs/operations/feature-flags.md](../../docs/operations/feature-flags.md).
- **Prompt-caching:** все новые/правленые промпты — стабильный SYSTEM, данные в конце user ([[feedback_llm_prompts_cache_friendly]]); правки code-fallback — версией `_V2` (F10).
- **Обратимость:** авто-резолв конфликтов и авто-создание задач обратимы (версии карточек / переназначение задач) — поэтому AUTO/HYBRID безопасны; необратимое и owner-решения остаются HUMAN.
- **Schema (Prisma):** возможны мелкие миграции — enum `ProbeEvent.status` (+`dropped_low_value`,`routed_to_digest`), провенанс авто-резолва конфликта, автор intake. Любое изменение БД = **файл миграции** ([[prisma-db-push-rules]]) + Шаг 4 prod-deploy-log.
- **LLM-каналы:** новые роуты сверять с verified-картой; Anthropic не использовать (z-ai-agent-rules §0).

## Верификация

- `cd backend && bunx tsc --noEmit` + `bun run build` (фронт не затрагивается).
- Unit: `pending-actions-reminder.cron.spec.ts` (новые слоты); `conflict-arbiter.cron.spec.ts` (consensus→авто / split→open / evolving-без-меты→escalate); `probe.service` (NUDGE→routed_to_digest, low-value→dropped) + `OwnerResolver` (5 ветвей) + `process-template-probe`; `curation.service.thresholds`/`curation-autotune.cron` (новые дефолты); `intake-auto-triage.worker.spec.ts` (telegram→auto / неполная атрибуция→Входящие).
- Прод-наблюдение: падение счётчиков `curation/conflict/intake/probe` в `/actions`; `z_conflict_arbiter_total{outcome}`, `z_owner_autoresolved_total`, `z_probe_event_total{status}`, `z_ai_intake_auto_accepted_total{source}`, `z_pending_reminder_sent_total`.

## Прод-операции (diff к [docs/operations/prod-deploy-log.md](../../docs/operations/prod-deploy-log.md))

- **Шаг 1 / feature-flags:** `probe.immediatePushMinPriority`, `probe.minValuePriority`, `curation.conflictArbiterEnabled` (kill-switch ON), `conflictArbiterMinConfidence`, `conflictArbiterAuditRate`, расписание ConflictArbiterCron.
- **Шаг 4 (схема):** миграции под enum `ProbeEvent.status` / провенанс конфликта / автор intake (если вводятся).
- **Шаг 7 (seed):** `seed-admin-settings.ts` (дефолты `pendingActions.*`, `knowledge.curation*`) + `LlmTaskRoute` для `debate-conflict-arbiter-*`. Зарегистрировать новые seed/route в `apply-prod-deploy.ts` STEPS.
- **Шаг 12 (smoke):** новый `@Cron` ConflictArbiterCron, новый зонтичный taskType в llm-routes/Swagger, `OwnerResolver` подключён, `probe.provider` не считает NUDGE.

## Итог

**Реализовано ЦЕЛИКОМ (W0–W4), 2026-06-12, ветка `feature/assistant-channels-and-autonomy`** (вперемешку с фазами assistant-channels-ТЗ):

- **W0** — `a7a80feb` — каденция reminder 5/день→1/день 09:00 (`pendingActions.reminderWindowEndHour=9`, `reminderStepHours=12`) + гейт немедленного probe-пинга `probe.immediatePushMinPriority=70` (ниже → дайджест).
- **W1** — `5b791d1c` — debate-семейство `conflict-arbiter` (4 taskType, seed `seed-llm-task-routes-conflict-arbiter.ts` в STEPS) + `ConflictArbiterCron` (02:00): авто-резолв `keep_old`/`accept_new`/`merge` при consensus + confidence ≥ 0.7, актор — владелец Org, post-hoc `system.message`; kill-switch `knowledge.curationConflictArbiterEnabled` (ON); метрика `z_conflict_arbiter_total`.
- **W2** — `200a7cf8` — enum `ProbeStatus` += `dropped_low_value`/`routed_to_digest` (миграция `20260612090000_probe_status_w2_autonomy`) + гейт ценности `probe.minValuePriority=30` + `NUDGE_REASONS`(7)→дайджест + cold-start ПОЧИНЕН (включён, 24ч) + `OwnerResolver` (лестница: родитель → единственный держатель роли → автор → кандидаты → none; метрика `z_owner_resolution_total`) + `expiresAt` у digest-статусов.
- **W3** — `5a4ef4cb` — `knowledge.curationAuditSampleRate` 0.05→0.01, `curationAutotuneEnabled` seed→true + seed-крутилки W2.
- **W4** — `90f02a6e` — intake авто-приём из ВСЕХ каналов (порог 0.75 сохранён, null-исполнитель → владелец Org с пометкой «уточнить», дефолт-проект «Входящие», метрики разрез source/via_default_project).

**Отклонения от контракта (осознанные):**
- `evolving`/`escalate` НЕ авто-резолвятся (по контракту Ф1.3 — остаются HUMAN; арбитр их только помечает).
- **Ф2.4 (авто-черновики probe) → ТЗ-заглушка** `plans/tz/2026-06-12-probe-auto-drafts-phase24.md` (blocked-on-owner: зависит от шага «улучшаем промпты»).
- **Ф0.3 не делали** — опциональная, требовала отдельного подтверждения (объединение с COO daily-digest).
- **Ф3.2 / Ф4.3 (тексты промптов)** — первая редакция в коде; дошлифовка → шаг «улучшаем промпты» вместе с владельцем (см. реестр не-сделано).
- cold-start: дропы НЕ теряются — уходят в дайджест (`routed_to_digest`), статус `dropped_cold_start` остаётся в enum как история.

**OwnerResolver — границы AUTO:** только прямые поля Regulation/Process/Policy/Experiment; `Card` и шаги процессов — только probe-выбор (без тихого авто-назначения).

Документация: `feature-flags.md` (kill-switch + 6 крутилок), `prod-deploy-log.md` (блок 2026-06-12: миграция + 2 seed), `workers-queues.md`, `ai-jobs.md`, `data-model.md` (ProbeStatus), реестр не-сделано (M-4, L-5, «улучшаем промпты»).
