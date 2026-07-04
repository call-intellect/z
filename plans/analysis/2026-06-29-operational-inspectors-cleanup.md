---
type: analysis
status: decided
feature: operational-inspectors-cleanup
date: 2026-06-29
snapshot_date: 2026-06-29
owner: sergrv80@gmail.com
related:
  - plans/tz/2026-06-27-task-decision-execution-unified-tz.md
  - plans/tz/2026-06-23-meeting-tasks-assignee-probe-closure-tz.md
  - plans/analysis/2026-06-27-task-decision-dashboard-control-model.md
---
> Контекст: после внедрения модели «две оси» (память × исполнение) оперативный контроль целиком на ЗАДАЧАХ. Решение и обещание остаются записями в памяти, но как контролируемые единицы больше не существуют → их инспекторы (генераторы вопросов) осиротели и продолжают слать вопросы/нуджи в Telegram. Эмпирика 2026-06-29 (кабинет владельца): `decision_no_owner` капал ~17 дней подряд; вопросы `decision.*` и обещания — заметная доля ежедневного шума.
> Решения владельца (2026-06-29): **решения — убрать инспектор; обещания — убрать ВСЁ (вкл. дашборд); задачи — оставить и починить A+B.**
> Основание: модель внедрена PR #63 (`60039787` «actionable-решение авто-заводит задачу») и ТЗ [2026-06-27](../tz/2026-06-27-task-decision-execution-unified-tz.md); задачная петля — ТЗ [2026-06-23](../tz/2026-06-23-meeting-tasks-assignee-probe-closure-tz.md).

# Чистка оперативных инспекторов после модели «две оси»

## 1. Инспектор РЕШЕНИЙ — убрать (вопросы)

**Решение владельца:** Кора перестаёт задавать вопросы про решения. Сущность `Decision` и её извлечение — остаются; авто-заведение задачи из actionable-решения — остаётся.

**Поверхность удаления:**
- `knowledge-core/services/specialist-3-3-probe.service.ts` (`Specialist33ProbeService`) целиком + регистрация в `knowledge-core.module.ts` + cron `@Cron('0 5 * * *')` + on-ingest хуки `checkAndEmitForDecision`/`emitCompetingVersions` (удалить вызовы в `specialist-3-3-decisions.service.ts`/`.worker.ts` — `[картография при ТЗ]`).
- proactive-правило `decision_no_owner`: `proactive-watcher.service.ts` (`ruleDecisionNoOwner` + строка в `buildEnabledRules`) + флаг `proactive.rules.decisionNoOwner` + шаблон в `proactive-message-craft.service.ts`.
- реестры probe: вычистить `decision.*` из `probe-reason-policy.ts` (`PROBE_REASON_WINDOW`, `NUDGE_REASONS`, `PROBE_REASON_RECHECK`), `probe-reason-labels.ts`, ветки в `probe-response.handler.ts`.

**Поводы, исчезающие:** `decision.missing_decider`, `decision.no_deadline_critical`, `decision.overdue`, `decision.outcome_unknown`, `decision.competing_versions`, `decision.confirm_status` + proactive `decision_no_owner`.

**Открытый вопрос (НЕ решён):** дашборд-поверхности решений (`hanging-decisions.service`, `decision-implementation.service` + крон 21 день, `decision-hygiene-scorer`, решения в дайджестах). Владелец подтвердил снос ИНСПЕКТОРА; судьба дашборд-контроля решений — отдельно (для обещаний выбран полный снос — см. §2; для консистентности, вероятно, и здесь тоже, но прямого «да» нет).

## 2. Инспектор ОБЕЩАНИЙ — убрать ТОЛЬКО вопросы (узкий scope этого модуля)

**Уточнение владельца (2026-06-29):** этот документ отвечает за **модуль уточняющих вопросов**. По обещаниям убираем **только инспектор, который задаёт вопросы** — он не нужен. Сущность «обещание» (соц-слой: надёжность, сеть обещаний, «кому обещано», мост обещание→задача) и её дашборд — **НЕ трогаем**, это отдельное ТЗ ([commitment-task-unification](2026-06-29-commitment-task-unification.md), вариант B «связь, не слияние»).

**Почему вопросы-инспектор не нужен:** обещание-действие становится задачей с ответственным/сроком → её ведёт задачный инспектор. Нудж «Ты обещал, выполнил?» = повторный контроль той же работы → шум.

**Поверхность удаления (только генераторы вопросов):**
- `operations/workers/commitment-followup.cron.ts` (followup + escalation) + флаги `betaOps.commitmentFollowupEnabled` / `commitmentFollowupLocalHour`;
- в `operations/services/specialist-3-9-promise-keeper.service.ts` — методы, отправляющие probe (`sendFollowupForBlock` / `sendEscalationForBlock`); `promise-cascade.cron` — часть, шлющая вопросы `[картография при ТЗ]`;
- поводы probe `commitment.followup`, `commitment.silence_escalation` — из `probe-reason-policy.ts` (`PROBE_REASON_WINDOW`, `NUDGE_REASONS`) + `probe-reason-labels.ts`;
- `operations/services/commitment-response.handler.ts` — часть обработки ответов на эти probe `[картография при ТЗ]`.

**ВНЕ scope (отдельное ТЗ commitment-task-unification):** сущность `Commitment` / `IdeaBlock commitment*`, надёжность (`commitment-reliability`), сеть обещаний (`promise-network`), дашборд/страница «Мои обещания», мост обещание→задача. Не трогаем — это дифференциатор «держит слово».

## 3. Инспектор ЗАДАЧ — оставить, починить A+B

**Статус:** нужен и в основном построен ТЗ [2026-06-23](../tz/2026-06-23-meeting-tasks-assignee-probe-closure-tz.md) (4 поля; probe при нехватке; двухканально; ответом назначить/срок/удалить/распиши; gate закрытия; уведомление постановщику; живая карточка). Сверка с живым кодом 2026-06-29 выявила 2 расхождения с постановкой владельца.

**Находка A — адресат probe = владелец, а не автор реплики.** В основном пути извлечения `specialist-3-15-tasks.service.ts` получатель = `resolveProbeRecipient(tenantId)` → первый **owner Org** (фолбэк — любой участник). `authorPersonId` реплики собирается на evidence (Ф1 ТЗ 06-23) и отдаётся LLM для само-назначения «мне», но **для выбора адресата вопроса не используется**. Маршрут «автору реплики» (Ф5 ТЗ 06-23) в живом extraction-пути не реализован — похоже, утрачен при унификации извлечения. `meeting-extract-actions.service.ts` probe больше не эмитит (встречи идут через `specialist-3-15`). Симптом: owner получает «Кто отвечает за задачу…» по чужим задачам.

**Находка B — на извлечении спрашивается только исполнитель, не срок.** `specialist-3-15` поднимает только `task.assignee_unresolved`. `task.due_date_missing` живёт только в пути помощника (`me-tasks.service.ts`), хотя крутилка `tracker.dueDateClarifyEnabled` = ON. Задача из разговора без срока (но с исполнителем) мгновенного вопроса не получает.

**Находка C (мелочь):** «описание» отдельного мгновенного probe не имеет — закрывается общим `task.poorly_specified` в пути качества/закрытия.

**✓ Подтверждено:** мгновенность есть — `task.assignee_unresolved` окно `immediate` + дефолт `tracker.assigneeProbePriorityHint=0.7` (= порог `probe.immediatePushMinPriority=70`) → пушится сразу, не в дайджест.

**Терминологическая правка (важно):** «владелец» в находке A = **owner Org** (текущий `resolveProbeRecipient` → первый owner, у тестового кабинета это Сергей). Это и есть баг. Правило владельца: **вопрос задаётся ТОМУ, ЧЬЯ РЕПЛИКА — то есть постановщику/инициатору задачи** («Петя сказал Насте „ставлю задачу“» → спрашиваем Петю, он инициатор, с него спрос). Если человек поставил задачу САМ СЕБЕ («задача мне») — автор = исполнитель, спрашиваем его же. То есть единое правило «адресат = автор реплики (постановщик)» покрывает оба случая.

**Решение владельца — починить A + B:**
- **A.** Адресат probe на извлечении (`specialist-3-15`) = **автор реплики (постановщик)**: резолв `authorPersonId` evidence → `Person.userId`; фолбэк на owner только если автор не идентифицирован. `[картография при ТЗ: как взять authorPersonId блока/evidence в точке эмита]`.
- **B (срок).** Срок ставит постановщик. Приоритет — **достать срок из разговора** (если в реплике прозвучало «сделаю к пятнице» — забираем, вопроса нет). Если срок не прозвучал → мгновенный probe `task.due_date_missing` **постановщику** (в `specialist-3-15` при `suggestedDueDate == null`, под `tracker.dueDateClarifyEnabled`, по образцу блока assignee).
- **Ежедневный свод:** инспектор периодически проходит по всем задачам; задачи без ответственного и/или без срока → уточняющий вопрос постановщику (тому, чья реплика породила задачу).
- Сверить, что встречи реально идут через `specialist-3-15` (а не через мёртвый `meeting-extract-actions`), и что фикс покрывает все каналы извлечения.

## 4. Следующий шаг

ТЗ (`plans/tz/`): один контракт «чистка инспекторов решений+обещаний + фикс задачного A/B» либо два (удаление | фикс). Картография точных call-site, чистка реестров probe, удаление proactive-правила/кронов/флагов, правка тестов, прод-реестры (удаление флагов, smoke probe-reason). Делать через скилл tz-author.
