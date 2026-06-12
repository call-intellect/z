# Аудит ручных подтверждений Коры → план автономизации

> **Тип:** анализ (`plans/analysis/`). Подготовка почвы под пошаговую правку промптов.
> **Дата:** 2026-06-11. **Ветка:** svdev.
> **Триггер:** владелец прислал скриншот Telegram-бота KORA: «🔔 Ждёт вашего подтверждения: 32. Решения/карточки — 5, Конфликты — 9, Задачи — 3, Вопросы — 15» + probe «...не назначен ответственный. Назначить?». Ощущение: система не автономна, слишком много ручных согласований → воспринимается как мусор.
> **Цель документа:** найти ВСЕ точки ручного подтверждения, какой агент/код их порождает, какой гейт решает «спросить человека vs решить самому», и разложить, что чинится **кодом** и что — **промптами**. Дальше владелец и ассистент идут по этому списку шаг за шагом.
> **Принципиальная рамка:** [[feedback_no_human_in_loop_for_clone_learning]] — в Org 30 человек, они будут «соглашаться и соглашаться» не вникая; знаниевые решения должны приниматься агентами автоматически, human-gate допустим только как kill-switch, не как regular approval. Ship-On (CLAUDE.md §8): человек-в-петле как «дефолтный режим работы» — это и есть склад забытого. Связано с уже открытым [[project_probe_system_research_done]].

---

## 1. Как устроено «Ждёт подтверждения» (единый агрегатор)

Бейдж/колокольчик/Telegram-напоминание/CEO-дашборд кормятся из **одного агрегатора** — `PendingActionsService` ([backend/src/modules/pending-actions/services/pending-actions.service.ts](../../backend/src/modules/pending-actions/services/pending-actions.service.ts)). Он опрашивает **4 провайдера** (порядок фиксирован):

| `source` | Что считается «ждущим» | Read-model | Кому показывается |
|---|---|---|---|
| `curation` | `CurationItem.status='pending'` (карточка знаний на проверке) | [curation.provider.ts](../../backend/src/modules/pending-actions/providers/curation.provider.ts) | кандидату-куратору / assignee + **owner/admin видят всё** |
| `conflict` | `ConflictItem.status='open'` (конфликт карточек) | [conflict.provider.ts](../../backend/src/modules/pending-actions/providers/conflict.provider.ts) | **только owner/admin** |
| `intake` | `IntakeIssue.status='pending'` (входящая задача на триаже) | [intake.provider.ts](../../backend/src/modules/pending-actions/providers/intake.provider.ts) | **только owner/admin** |
| `probe` | `Notification eventType='probe.question', responseStatus='pending'` (уточняющий вопрос) | [probe.provider.ts](../../backend/src/modules/pending-actions/providers/probe.provider.ts) | получателю вопроса (любая роль) |

**Важно:** провайдеры — это только витрина (read-model). Решение «дёрнуть человека» принимается **выше по потоку** — там, где агент создаёт `CurationItem` / `ConflictItem` / `IntakeIssue` / зовёт `ProbeService.suggest()`. Чтобы убрать ручное подтверждение, чинить надо **гейты-источники**, а не провайдеры.

### 1.1. Усилитель ощущения «спама» (доставка)

Само число 32 — не вся проблема; проблема в частоте напоминаний:

- **`PendingActionsReminderCron`** ([pending-actions-reminder.cron.ts](../../backend/src/modules/pending-actions/workers/pending-actions-reminder.cron.ts)) — ежечасный тик, шлёт «🔔 Ждёт вашего подтверждения: N» в Telegram в **слотах 9/12/15/18/21** (admin-editable `pendingActions.reminderWindowStart/End/Step`). То есть до **5 раз в день**, пока счётчик > 0. Текст детерминированный (без LLM), `buildReminderBody`.
- **`daily-digest`** ([operations/services/daily-digest.service.ts](../../backend/src/modules/operations/services/daily-digest.service.ts)) — отдельный утренний дайджест.
- **Per-event probe** — каждый вопрос ещё и приходит отдельным сообщением через `probe-dispatcher`.

Вывод: даже если уменьшить число pending, ежечасный cron будет добивать. Доставка — отдельный рычаг (Раздел 5, Волна 0).

---

## 2. СТОЛП 1 — Curation (Решения/карточки)

**Кто создаёт:** специалисты Слоя 3 зовут `CurationService.triage()` ([curation.service.ts:218](../../backend/src/modules/curation/services/curation.service.ts)) на каждую извлечённую карточку (decision/process/regulation/fact/skill/…).

**Гейт «человек vs авто»** (triage), по `effectiveConfidence` (калиброванная, иначе сырая):

1. **auto-canonical** (без человека): не критический тип + нет конфликта + `confidence ≥ autoThreshold` (**деф. 0.85**).
2. **provisional** (без человека): критический тип + не hard-конфликт + `aiVerifierEnabled` + `confidence ≥ provisionalThreshold` (**деф. 0.8**) + AI-судья (3-голосовый debate `curation-verify`) дал accept-консенсус.
3. **deep** (к человеку): критический тип ИЛИ hard-конфликт ИЛИ `confidence < deepReviewThreshold` (**деф. 0.6**).
4. **light** (к человеку, one-tap approve): всё остальное между deep и auto.
5. **audit-выборка**: с вероятностью `auditSampleRate` (**деф. 0.05**) даже auto/provisional-решение создаёт **лёгкий аудит-`CurationItem` (pending)** — и он **тоже попадает в «Ждёт подтверждения»**, хотя карточка уже канонизирована.

**Дефолты** ([typed-config.service.ts:1491+](../../backend/src/common/config/typed-config.service.ts)): `autoThreshold=0.85`, `deepReviewThreshold=0.6`, `provisionalThreshold=0.8`, `criticalTypes=['regulation','process','decision']`, `aiVerifierEnabled=true`, `auditSampleRate=0.05`. Все admin-editable (крутилки A0/A1/A2 + автоподстройка `autotuneEnabled`). Доставку probe-уведомления делает `dispatchProbe` ([curation.service.ts:1469](../../backend/src/modules/curation/services/curation.service.ts)).

**Почему висит у человека (вероятные причины 5 карточек):**
- Низкая `confidence` специалистов → ниже 0.6 → deep. ← **промпт-рычаг** (калибровка уверенности).
- Тип в `criticalTypes` + AI-судья не дал accept (reject/split/недоступен) → deep. ← промпт-рычаг (промпт `curation-verify` debate) + конфиг.
- audit-выборка 5% от авто-решений. ← **конфиг-рычаг** (снизить/обнулить).

**Рычаги автономизации:**
- **Код/конфиг:** снизить `auditSampleRate` (например 0.05→0.01 или 0); пересмотреть `criticalTypes` (нужен ли `process` всегда у человека); включить/настроить `autotune`; пер-типовые пороги `autoThresholdByType`.
- **Промпт:** (1) промпты специалистов — честная, но не заниженная `confidence`; (2) промпт AI-судьи `debate-curation-verify` — чтобы чаще давал уверенный accept на очевидно корректных карточках.

---

## 3. СТОЛП 2 — Conflict (Конфликты) 🔴 главный разрыв автономии

**Кто создаёт:** `ConflictService.report()` ([conflict.service.ts:78](../../backend/src/modules/curation/services/conflict.service.ts)) — зовут воркер block-linker и специалисты, когда две карточки конфликтуют (soft/hard).

**Гейт авторазрешения:** **ОТСУТСТВУЕТ.** Каждый зарепорченный конфликт создаёт `ConflictItem(status='open')`, который **всегда** ждёт ручной резолюции owner/admin. В коде прямой TODO: *«LLM-арбитр curation-conflict-suggest-resolution — подсказывает accept_new/keep_old/merge/evolving + reasoning»* ([conflict.service.ts:62-63](../../backend/src/modules/curation/services/conflict.service.ts)) — так и не построен.

Это объясняет, почему **конфликтов больше всего (9)** — у них автономии ноль, накапливаются линейно.

**Рычаги автономизации:**
- **Код (новый агент):** LLM-арбитр конфликтов. По evidence/relationType предлагает резолюцию (`accept_new` / `keep_old` / `merge` / `evolving`) + confidence. Симметрично curation: высокая уверенность → авто-резолюция (`resolve()` от системного пользователя), низкая/неоднозначная → к человеку. Можно переиспользовать `MultiAgentDebateService` (как AI-судья в curation).
- **Промпт:** новый промпт `curation-conflict-suggest-resolution` (или debate-семейство). Это ровно то, что добавим на шаге работы с промптами.
- **Особый случай `evolving`:** требует `existingValidUntil`/`newValidFrom` (bitemporal) — арбитр должен уметь их предложить.

---

## 4. СТОЛП 3 — Intake (Задачи)

**Кто создаёт:** `IntakeIssue` из (а) извлечения действий встречи, (б) задач из Telegram, (в) in-app. Авто-триаж — `IntakeAutoTriageWorker` ([intake-auto-triage.worker.ts](../../backend/src/modules/tracker/workers/intake-auto-triage.worker.ts)).

**Гейт авто-создания Issue (без человека)** ([intake-auto-triage.worker.ts:329](../../backend/src/modules/tracker/workers/intake-auto-triage.worker.ts)):
```
canAutoAccept = confidence ≥ tracker.autoAcceptConfidenceThreshold (деф. 0.75)
              && intake.source === 'meeting'      ← жёсткий гейт
              && suggestedAssigneeId !== null
              && suggestedProjectId !== null
```

**Ключевой разрыв:** задачи из **Telegram/in-app НИКОГДА не авто-принимаются** — условие `source==='meeting'` их режет, они всегда «pending» → к человеку. Промпт `INTAKE_AUTO_TRIAGE_SYSTEM` сам говорит модели: «Confidence ≥ 0.75 ставь только если ВСЕ ключевые поля найдены». Если не нашлись проект/исполнитель — задача застревает.

**Рычаги автономизации:**
- **Код:** расширить `canAutoAccept` на `telegram`/`in_app` (с страховкой); либо дефолт-проект «Входящие» + дефолт-исполнитель = автор задачи, чтобы гейт `assignee/project != null` проходил без человека.
- **Промпт:** `INTAKE_AUTO_TRIAGE_SYSTEM` — лучше извлекать проект/исполнителя/цель из контекста, меньше null.

---

## 5. СТОЛП 4 — Probe (Вопросы) — самый массовый источник

**Единый вход:** `ProbeService.suggest()` ([probe.service.ts:55](../../backend/src/modules/probe/probe.service.ts)). Внутри ТОЛЬКО: дедуп (Redis по content-hash), rate-limit per recipient (`probe.rateLimitPerHour/PerDay`), cold-start (**фактически выключен** — баг `return ... ? false : false` на [probe.service.ts:278](../../backend/src/modules/probe/probe.service.ts)), расчёт priority, запись `ProbeEvent` + enqueue dispatcher.

**🔴 Чего НЕТ:** «гейта ценности» — проверки «а стоит ли вообще спрашивать человека / могу ли я ответить сам из графа?». Каждый специалист сам решает спросить; центр только дедупит и режет по частоте. Это совпадает с выводом research ([[project_probe_system_research_done]]): корень «вопросы не понравились» = **нет политики инициирования**, а не текст вопроса.

### 5.1. Каталог probe-эмиттеров (что именно спрашивают)

| Сервис (`emittedByService`) | `reason` (что спрашивает) | Файл |
|---|---|---|
| `3-1-regulations` | `regulation.missing_owner`, `regulation.process_no_steps`, `regulation.stale`, `regulation.scope_unclear` | [specialist-3-1-probe.service.ts](../../backend/src/modules/knowledge-core/services/specialist-3-1-probe.service.ts) |
| `3-2` | `knowledge.new_expertise_detected` | [specialist-3-2-probe.service.ts](../../backend/src/modules/knowledge-core/services/specialist-3-2-probe.service.ts) |
| `3-3-decisions` | `decision.competing_versions`, `decision.missing_decider`, `decision.no_deadline_critical`, `decision.overdue`, `decision.outcome_unknown` | [specialist-3-3-probe.service.ts](../../backend/src/modules/knowledge-core/services/specialist-3-3-probe.service.ts) |
| `3-4` | `card.missing_owner`, `card.missing_deadline`, `card.merge_suggestion`, `card.outdated_summary` | [specialist-3-4-probe.service.ts](../../backend/src/modules/knowledge-core/services/specialist-3-4-probe.service.ts) |
| `3-5` | `insight.linked_decision_question`, `insight.escalation_suggested`, `insight.recurring_after_mitigation`, `insight.no_mitigation_plan` | [specialist-3-5-probe.service.ts](../../backend/src/modules/knowledge-core/services/specialist-3-5-probe.service.ts) |
| `3-6` | `idea.support_request`, `idea.status_unclear` | [specialist-3-6-probe.service.ts](../../backend/src/modules/knowledge-core/services/specialist-3-6-probe.service.ts) |
| `3-7-skill` | `skill.contradicting_traits`, `skill.profile_starved` | [specialist-3-7-skill-probe.service.ts](../../backend/src/modules/knowledge-core/services/specialist-3-7-skill-probe.service.ts) |
| `3-9-experiments` | `experiment.result_without_lesson`, `experiment.no_owner`, `experiment.running_too_long` | [specialist-3-9-experiment-probe.service.ts](../../backend/src/modules/knowledge-core/services/specialist-3-9-experiment-probe.service.ts) |
| `3-14-goals` | `goal.kr_checkpoint_suggested` | [goals-checkpoint-probe.handler.ts](../../backend/src/modules/knowledge-core/services/goals-checkpoint-probe.handler.ts) |
| `temporal-probe` | `temporal.fact_stale_contradiction` (+ `.escalated`) | [temporal-probe.service.ts](../../backend/src/modules/knowledge-core/services/temporal-probe.service.ts) |
| `process-template-probe` | `process_template.missing_input_artifact`, `…missing_output_artifact`, **`process_template.step_without_owner`** ← скриншот | [process-template-probe.service.ts](../../backend/src/modules/processes/services/process-template-probe.service.ts) |
| `3-9-promise-keeper` | `commitment.followup`, `commitment.silence_escalation` | [specialist-3-9-promise-keeper.service.ts](../../backend/src/modules/operations/services/specialist-3-9-promise-keeper.service.ts) |
| `tracker.goal_alignment_low` | `goal_alignment_low` | [goal-alignment-low.cron.ts](../../backend/src/modules/tracker/workers/goal-alignment-low.cron.ts) |
| `curation.consistency_checker` | (несогласованность карточек) | [consistency-checker.cron.ts](../../backend/src/modules/curation/workers/consistency-checker.cron.ts) |
| `maturity-scorer` | (пробелы профиля компании) | [maturity-scorer.service.ts](../../backend/src/modules/company-foundation/services/maturity-scorer.service.ts) |

≈14 эмиттеров, ≈30 типов вопросов. Текст формулирует промпт `probe-formulate` ([knowledge-core/prompts/probe-formulate.prompt.ts](../../backend/src/modules/knowledge-core/prompts/probe-formulate.prompt.ts)).

**Наблюдение по скриншоту:** «у N шага(ов) не назначен ответственный. Назначить?» ([process-template-probe.service.ts:84-85](../../backend/src/modules/processes/services/process-template-probe.service.ts)) — классический пример вопроса, который агент **должен решать сам** (назначить ответственного по роли/владельцу процесса), а не спрашивать. То же для `*.missing_owner`, `*.no_owner`, `*.missing_deadline` — это «дырки данных», которые часто заполняются из графа без человека.

**Рычаги автономизации:**
- **Код (центральный гейт):** в `ProbeService.suggest()` добавить **гейт ценности** — единый порог `priorityHint` + проверка «решаемо ли из графа». Низкая ценность / решаемо самим → не спрашивать (или авто-применить дефолт). Это «политика инициирования» из research.
- **Код (per-specialist auto-resolve):** для `*.missing_owner` / `step_without_owner` / `*.no_owner` — сначала попытаться назначить автоматически (владелец процесса/роль/автор), probe только если кандидат не выводится.
- **Промпт:** `probe-formulate` + per-specialist «спрашивать только если правда нельзя решить самому» (это и есть пошаговая правка промптов, которую планирует владелец). Связано с уже написанным ТЗ [plans/tz/2026-06-11-probe-system-upgrade-phase1.md](../tz/2026-06-11-probe-system-upgrade-phase1.md).
- **Починить cold-start-баг** ([probe.service.ts:278](../../backend/src/modules/probe/probe.service.ts)) — сейчас не глушит probe-шторм после деплоя.

---

## 6. План автономизации (последовательность)

Принцип: **сначала включить уже готовые рычаги (код/конфиг) — это быстро снимает 80% шума, — потом точечно усиливать промпты, чтобы агент решал сам.**

| Волна | Что | Тип | Эффект |
|---|---|---|---|
| **W0. Глушим доставку-спам** | Снизить частоту `PendingActionsReminderCron` (слоты 9/12/15/18/21 → 1×/день), сворачивать probe в дайджест, не дублировать каждый вопрос отдельным сообщением | конфиг/код | мгновенно убирает ощущение «мусора», не трогая логику |
| **W1. Конфликты — LLM-арбитр** | Построить `curation-conflict-suggest-resolution`: уверенно → авто-резолв, иначе → человек | код + **промпт** | закрывает самый большой пул (9) |
| **W2. Probe — гейт ценности + auto-resolve дырок** | Центральный гейт ценности в `suggest()`; для `*owner/deadline*` — авто-заполнение из графа | код + **промпт** | бьёт по 15 вопросам |
| **W3. Curation — пороги/аудит/судья** | audit 0.05→0.01; ревизия `criticalTypes`; усилить промпт AI-судьи и калибровку специалистов | конфиг + **промпт** | снимает «provisional → человек» и аудит-шум |
| **W4. Intake — авто-приём из всех каналов** | Снять гейт `source==='meeting'`; дефолт-проект/исполнитель; усилить промпт триажа | код + **промпт** | закрывает задачи (3) |

**Что чисто промпты (шаг за шагом с владельцем):**
1. `probe-formulate` + политика инициирования каждого из ≈14 специалистов («спрашивай, только если нельзя решить самому»).
2. `debate-curation-verify` (AI-судья) — увереннее канонизировать очевидно-верное.
3. `INTAKE_AUTO_TRIAGE_SYSTEM` — меньше null в атрибуции.
4. (новый) `curation-conflict-suggest-resolution` — арбитр конфликтов.

**Что чисто код/конфиг (готовлю почву):**
- Центральный гейт ценности в `ProbeService.suggest()`.
- LLM-арбитр конфликтов (скелет агента + резолв системным пользователем).
- Расширение `canAutoAccept` в intake.
- Снижение `auditSampleRate`, ревизия `criticalTypes`, частота reminder-cron.
- Фикс cold-start-бага.

---

## 7. Развилки для владельца

- **Р-1. Глубина автономии.** Дойти ли до «авто-резолв всего, человек только kill-switch» (рекомендация — да, согласно [[feedback_no_human_in_loop_for_clone_learning]] и Ship-On), или оставить ручное подтверждение для критических типов (`regulation/decision`)? Рекомендация: авто + выборочный аудит вместо блокирующего подтверждения.
- **Р-2. Что осознанно остаётся за человеком.** Решения владельца (CLAUDE.md §8б) — деньги/доступ/необратимое — НЕ автономизируем. Все 4 столпа из скриншота — знаниевые, их автономизируем.
- **Р-3. Порядок.** Рекомендация — W0→W1→W2→W3→W4 (доставка → конфликты → вопросы → карточки → задачи).

---

## 8. Граница аудита (честно)

Покрыты 4 источника агрегатора `PendingActionsService` + усилители доставки — это ровно то, что в скриншоте. **Не проверялись в этом проходе** (отдельная Волна-2, если нужно): согласования вне `pending-actions` — обучение клонов / автоподстройка промптов (по памяти спроектированы как авто, но стоит верифицировать кодом — [[feedback_processes_catalog_verify_with_code]]), изменения RBAC/матрицы доступа, биллинговые лимиты. По методологии «статусы только по коду» — при работе над каждой волной перепроверять реальный код, а не ТЗ.

---

## 9. Политика автономии — где человек, где агент сам (классификация)

Это keystone-раздел: на него ссылаются все ТЗ (W0–W4). Принцип: **спрашивать человека дорого** (интеррапт + воспринимается как мусор), поэтому вопрос оправдан только когда выполнено хотя бы одно: (а) решение **необратимо** или дорого откатить; (б) затрагивает **деньги / доступ / внешний мир** (= «решение владельца», CLAUDE.md §8б); (в) **подлинно неоднозначно** — агент не может вывести ответ из графа/контекста с приемлемой уверенностью. Если ни одного — агент **решает сам**.

### 9.1. Четыре уровня (вместо бинарного «спросить / не спросить»)

| Уровень | Что делает агент | Видимость человеку | Когда применять |
|---|---|---|---|
| **AUTO** | Решает и применяет молча | Лента «что Кора сделала» (не подтверждение) | Обратимо + выводимо из графа/роли/контекста |
| **HYBRID** | Применяет сам + пишет post-hoc уведомление и/или попадает в выборочный аудит | Не блокирующее уведомление + 1–5% аудит | Среднериск; нужна возможность пост-факт отката |
| **HUMAN** | НЕ применяет, ждёт решения | Подтверждение (как сейчас) | Необратимо / деньги-доступ / подлинная неоднозначность |
| **NUDGE** | Это не «подтверждение», а напоминание о чужой задаче | Только в дневном дайджесте, не в счётчике «ждёт подтверждения» | overdue / checkpoint / follow-up |

**Ключевое отличие от «спросить».** Сейчас почти всё = HUMAN. Цель — большинство перевести в AUTO/HYBRID, а «напоминалки» (NUDGE) убрать из счётчика подтверждений вовсе. HUMAN остаётся **только** для подлинно неоднозначного и необратимого.

### 9.2. Классификация всех источников

**Curation (карточки):**
| Случай | Уровень | Почему |
|---|---|---|
| Некритический тип, высокая уверенность | AUTO (уже) | Обратимо, версионируется |
| Критический тип, AI-судья accept | HYBRID (уже, provisional) | Можно откатить версией, есть аудит |
| audit-выборка поверх авто | HYBRID → но **снизить долю** | 5% слишком много шума |
| Критический тип, судья split/reject | HUMAN | Подлинная неоднозначность |

**Conflict (конфликты):** сейчас всё HUMAN. Должно стать:
| Случай | Уровень | Почему |
|---|---|---|
| Арбитр уверен (`keep_old`/`accept_new`/`merge`/`evolving`, consensus) | HYBRID — авто-резолв + post-hoc лог | Версии карточек обратимы; bitemporal хранит историю |
| Арбитр split/uncertain или hard-конфликт по критическому типу | HUMAN | Подлинная неоднозначность |

**Intake (задачи):**
| Случай | Уровень | Почему |
|---|---|---|
| Уверенность ≥ порог + исполнитель/проект выводятся (любой канал) | AUTO — создать Issue | Задачу легко переназначить/закрыть (обратимо) |
| Не выводится проект/исполнитель | HUMAN-light (триаж) ИЛИ AUTO в проект «Входящие» на автора | Лучше создать на дефолте, чем мариновать |

**Probe (вопросы) — по reason'ам:**
| reason | Уровень | Как решить без человека |
|---|---|---|
| `process_template.step_without_owner` ← **скриншот** | **AUTO** (ask только при неоднозначности) | Назначить **владельца процесса**; нет — единственного держателя роли; нет — автора; **несколько равных кандидатов → HUMAN** |
| `*.missing_owner` / `*.no_owner` (regulation/card/decision/experiment) | **AUTO**-first | Та же лестница: процесс-owner → роль → автор → (ambiguous) HUMAN |
| `*.missing_deadline` / `no_deadline_critical` | AUTO-first | Вывести из каденции процесса/похожих карточек; нет сигнала → NUDGE владельцу, не блок |
| `card.outdated_summary` | AUTO | Перегенерировать summary — чистая деривация |
| `card.merge_suggestion` / `decision.competing_versions` / `temporal.fact_stale_contradiction` / `consistency_checker` | HYBRID (через арбитр W1) | Слияние/supersede обратимы; split → HUMAN |
| `knowledge.new_expertise_detected` / `skill.profile_starved` / `skill.contradicting_traits` | AUTO (тихо записать/разрешить) | Профиль навыков — фон, не повод дёргать |
| `regulation.process_no_steps` / `experiment.result_without_lesson` | HYBRID — авто-черновик из транскрипта/контекста, уведомить | Черновик лучше пустого вопроса |
| `regulation.scope_unclear` / `insight.*` (mitigation/escalation/recurring) | HUMAN | Нужна управленческая оценка/суждение |
| `decision.overdue` / `decision.outcome_unknown` / `goal.kr_checkpoint_suggested` / `commitment.followup` / `commitment.silence_escalation` / `goal_alignment_low` | **NUDGE** | Это напоминания о чужих задачах, а не «подтверждение знания» → в дайджест, вне счётчика |

### 9.3. «Лестница владельца» — единый алгоритм для всех `*owner*`-вопросов

Эта лестница — переиспользуемый контракт (ТЗ W2), убирающий бОльшую часть вопросов вроде «не назначен ответственный»:
1. **Владелец процесса/карточки** (если есть `ownerId` у родителя) → назначить, AUTO.
2. **Единственный держатель роли** (по `Person.role` / отделу) → назначить, AUTO.
3. **Автор/инициатор** (кто внёс факт/решение на встрече, через IDENTITY участников) → назначить, AUTO.
4. **Несколько равновероятных кандидатов** → только тогда HUMAN (но вопрос с конкретным коротким списком, не «назначить?»).
5. **Ни одного кандидата** → NUDGE владельцу Org в дайджест, не блокирующий вопрос.

Доказательство «почему так лучше»: 80% «дырок владельца» в реальной Org разрешаются шагами 1–3 детерминированно (данные уже в графе), а текущий код их все гонит в HUMAN. Перевод 1–3 в AUTO снимает основную массу «Вопросов (15)», оставляя человеку только настоящую неоднозначность (шаг 4) — это и есть «где человек реально нужен».
