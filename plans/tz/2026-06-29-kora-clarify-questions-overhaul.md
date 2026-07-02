---
type: tz
status: ready-to-implement
feature: kora-clarify-questions-overhaul
date: 2026-06-29
owner: sergrv80@gmail.com
relates_to:
  - plans/architecture/2026-06-29-kora-clarify-questions-overhaul.md
  - plans/analysis/2026-06-29-operational-inspectors-cleanup.md
  - plans/analysis/2026-06-29-task-completion-method-capture.md
  - plans/tz/2026-06-23-meeting-tasks-assignee-probe-closure-tz.md
  - plans/analysis/2026-06-29-commitment-task-unification.md
---
> Архитектура (одобрена владельцем 2026-06-29): `plans/architecture/2026-06-29-kora-clarify-questions-overhaul.md` (status: approved) · Анализы: `operational-inspectors-cleanup.md`, `task-completion-method-capture.md` · Статус согласования развилок: закрыты владельцем 2026-06-29.

# ТЗ: пересмотр уточняющих вопросов Коры (модуль probe + proactive)

## Цель
Привести модуль уточняющих вопросов Коры к одобренному замыслу: (1) убрать вопросы-инспектор по РЕШЕНИЯМ; (2) убрать вопросы-инспектор по ОБЕЩАНИЯМ (только вопросы); (3) починить вопросы по ЗАДАЧАМ — адресат = постановщик, добавить вопрос про срок на извлечении; (4) добавить агента «расскажи, как решал» при переходе задачи в «Готово».

## Зачем (болезненное состояние)
После внедрения модели «две оси» (PR #63, `60039787`) оперативный контроль целиком на задачах. Инспекторы вопросов по решениям и обещаниям осиротели и шлют ежедневный шум (эмпирика кабинета владельца 2026-06-29: `decision_no_owner` ~17 дней подряд; вопросы про решения/обещания — заметная доля ежедневного дайджеста). Задачный инспектор шлёт вопросы владельцу Org вместо постановщика. Знание «как решалась задача» не захватывается.

## Принцип
Это узкая правка **модуля уточняющих вопросов**. Сущности (Decision, Commitment) и дашборды — НЕ трогаем (отдельные документы). Без нарративных комментариев в коде (CLAUDE.md). Все крутилки — `AdminSetting` через `getDynamic`; новые флаги — Ship-On + строка в `feature-flags.md`.

---

## REALITY-CHECK (факт на ветке `dev`, 2026-06-29)

| Проверено | Где (на момент написания — перечитать по якорю) | Вывод для ТЗ |
|---|---|---|
| **«Мостик» ответа на probe в общий pipeline УЖЕ ЕСТЬ** | `probe-response.handler.ts:152` → `ingestResponseAsRawEvent` (:1434) → `ConversationalIngestAdapter.ingestFreeNote` → `RawEvent(kind='free_note')` → block-ingest → специалисты | Ф5 (новый агент): мостик НЕ строим, а **подтверждаем**, что ответ на новый probe идёт этим же путём и что нота достаточно богата для регламент/клон-специалистов |
| Точка перехода задачи в «Готово» (любой путь) | `issues.service.ts:1136 transitionState`, `newState.category === 'completed'` (:1163, :1188); перетаскивание/обновление делегирует сюда (:1237 «делегируем в transitionState») | Триггер нового агента вешаем в `transitionState` при переходе в `completed` (рядом с `maybeMarkDecisionsImplementedForIssue` :1188) |
| Узкий вопрос закрытия `task.completion_detail_missing` сейчас только в assistant-пути | `me-tasks.service.ts:399` внутри `completeTask` (:358) | Ф5 переносит/расширяет на `transitionState→completed` и **заменяет** узкий вопрос богатым «как решал» |
| Адресат probe задачи на извлечении = **owner Org** (баг) | `specialist-3-15-tasks.service.ts:334` `resolveProbeRecipient(tenantId)` (тело :547 → первый owner, фолбэк любой member) | Ф3: заменить на резолв автора реплики |
| `authorPersonId`/`authorLabel` реплики ЕСТЬ на evidence | `specialist-3-15:382-393` (используется только для меток LLM), `IdeaBlockEvidence.authorPersonId` (миграция `20260623083858`) | Ф3: использовать его для адресата, не только для меток |
| Срок на извлечении НЕ спрашивается | `specialist-3-15` поднимает только `task.assignee_unresolved`; `task.due_date_missing` есть только в `me-tasks.service.ts:297-307` | Ф4: добавить эмит `task.due_date_missing` в specialist-3-15 |
| Мгновенность есть | `task.assignee_unresolved` окно `immediate` (`probe-reason-policy.ts:23`); `tracker.assigneeProbePriorityHint` дефолт `0.7` = порог `probe.immediatePushMinPriority` (70) | Не трогаем — пушится сразу |
| Хуки инспектора решений `checkAndEmitForDecision`/`emitCompetingVersions` — внешних вызовов НЕ найдено | grep по репо: только регистрация сервиса в `knowledge-core.module.ts:122,195`; реально шлёт `@Cron('0 5 * * *') runDailyChecks` (overdue/outcome) | Ф1: удаление сервиса + регистрации + cron = чисто; **перед удалением перечитать** call-sites (могут появиться) |
| Промис-нудж: `commitment-followup.cron` зовёт `promiseKeeper.sendFollowupForBlock`/`sendEscalationForBlock` (:75,:112) | `promise-cascade.cron.ts:145-148` шлёт `eventType:'proactive.notification'` (не probe) | Ф2: убираем followup/escalation probe; `promise-cascade` (proactive-алерт каскада) — `[ASSUMPTION: вне scope «вопросов», не трогаем; подтвердить при реализации]` |

---

## Принятые решения владельца (2026-06-29, НЕ пересматривать)

| # | Решение | Обоснование |
|---|---|---|
| Р1 | Scope = только модуль уточняющих вопросов (probe + proactive). Сущности Decision/Commitment, дашборды, мост обещание→задача — НЕ трогаем | «Ты отвечаешь за модуль уточняющих вопросов, делаешь узкую часть». Дашборд решений — отдельный одобренный блюпринт; сущность обещаний — отдельное ТЗ commitment-task-unification |
| Р2 | Решения: убрать probe-инспектор 3-3 целиком + proactive `decision_no_owner`. Decision как память + авто-задача из решения — остаются | Оперативка ушла на задачи; вопросы про решения осиротели |
| Р3 | Обещания: убрать только вопросы (followup «выполнил?» + escalation). Соц-слой/надёжность/сеть/дашборд — НЕ трогаем | Обещание-действие становится задачей → задачный инспектор ведёт; нудж дублирует |
| Р4 | Задачи, адресат: вопрос постановщику (автору реплики); владельцу — только если автор не определён; самоназначение → исполнителю | «Кто ставит задачу, того и спрашиваем, с него спрос» |
| Р5 | Задачи, срок: сначала из разговора; не прозвучал → вопрос постановщику; + ежедневный свод задач без ответственного/срока | Срок ставит постановщик |
| Р6 | Новый вопрос «как решал» — только на ЗНАЧИМЫХ/сложных задачах (порог-крутилка), ЗАМЕНЯЕТ узкий `task.completion_detail_missing`, необязательный + 1 мягкое напоминание | Иначе новый ежедневный шум; новый вопрос шире старого |
| Р7 | Триггер «как решал» — на ЛЮБОМ переходе карточки в «Готово» (авто/вручную) | «Когда карточка попала в решено» |
| Р8 | Новый агент сам НЕ пишет в клон/регламенты — только спрашивает; разносит ответ общая цепочка. «Проверка мостиков» — отдельный пункт | «Он не трогает клон/регламенты; ответ анализируется общей системой; надо проверить соединение мостиками» |

## Доказательство выбора
Полное — в одобренной архитектуре и анализах (`operational-inspectors-cleanup.md`, `task-completion-method-capture.md`). Ключевое для реализации: триггер нового агента в `transitionState` (единая точка любого перехода в completed, REALITY-CHECK); «мостик» переиспользует существующий `ingestResponseAsRawEvent` (не строим заново); адресат берётся из уже существующего `authorPersonId` на evidence.

---

## Scope

**Входит:** Ф1–Ф6 ниже.
**Не входит (отдельные ТЗ/документы):**
- Дашборд-поверхности решений (зависшие/доведение/гигиена, метрики в дайджестах) → `plans/architecture/2026-06-29-decisions-operational-cleanup.md`.
- Сущность обещаний, надёжность, `promise-network`, дашборд «Мои обещания», мост обещание→задача → `plans/analysis/2026-06-29-commitment-task-unification.md` (отдельное ТЗ).
- `promise-cascade` (proactive-алерт каскада обещаний) — `[ASSUMPTION: не трогаем]`.
- Остальные probe-инспекторы (card/insight/regulation/experiment/skill/helpfulness/attribution) — остаются.

## Граничные контракты с другими ТЗ
- Decision/Commitment как сущности и их извлечение (`specialist-3-3-decisions.service.ts`, `signalType=commitment` → задача) — **не трогаем**, только удаляем probe-хуки/вызовы.
- Задачная петля (ТЗ 2026-06-23) — надстраиваем (адресат/срок/новый триггер), её контракты не переписываем.
- Доставка probe (кабинет+Telegram, голос, диспетчер ответов) — используем как есть.

---

## Фазы

### Ф1 — Убрать probe-инспектор РЕШЕНИЙ
**Ценность.** Как владелец, перестаю получать ежедневные вопросы Коры про решения («без ответственного», «просрочено», «итог?»), за которыми мы оперативно больше не следим.
**Картография (перечитать по якорю).**
- `knowledge-core/services/specialist-3-3-probe.service.ts` (`Specialist33ProbeService`) — удалить файл целиком (cron `@Cron('0 5 * * *') runDailyChecks`, `checkAndEmitForDecision`, `emitCompetingVersions`, `checkOverdueForOrg`, `checkOutcomeUnknownForOrg`).
- `knowledge-core/knowledge-core.module.ts:122,195` — убрать из `providers`/`exports`.
- Перед удалением — grep `checkAndEmitForDecision|emitCompetingVersions|Specialist33ProbeService` по репо; если появились вызовы в `specialist-3-3-decisions.service.ts`/`.worker.ts` — удалить и их.
- `proactive/services/proactive-watcher.service.ts` — удалить `ruleDecisionNoOwner` (:165-209) + его строку в `buildEnabledRules` (:122-126); `proactive/services/proactive-message-craft.service.ts` — удалить `case 'decision_no_owner'`; `cfg.proactive.rules.decisionNoOwner` — удалить из `typed-config.service.ts` + реестра + сида.
- `probe/probe-reason-policy.ts` — удалить ключи `decision.*` из `PROBE_REASON_WINDOW`, `NUDGE_REASONS`, `PROBE_REASON_RECHECK`.
- `probe/probe-reason-labels.ts` — удалить `decision.*` из `PROBE_REASON_LABEL` и `PROBE_REASON_FALLBACK`.
- `probe/probe-response.handler.ts` — удалить ветку обработки ответов `decision.*` (`maybeApplyDecisionProbeAnswer` и её вызов) `[картография: подтвердить имя]`.
**Что НЕ входит.** Сущность `Decision`, `specialist-3-3-decisions.service.ts`/`.worker.ts` (извлечение), `specialist-3-3-card-handler.service.ts`, авто-задача из решения — остаются.
**Acceptance.**
- grep `'decision\.` по `probe/` и `proactive/` → 0 совпадений в эмиттерах/реестрах (кроме, возможно, исторических enum статусов БД — не трогаем).
- grep `decision_no_owner` по `backend/src` → 0.
- grep `Specialist33ProbeService` → 0 (файл удалён, регистрация снята).
- `bun run typecheck` (вкл. `.spec`) / `lint` / `build` зелёные; удалить/поправить `specialist-3-3-decisions.actionable.spec.ts`, `…dedup.spec.ts` и probe-policy/labels-спеки в части `decision.*`.
**Закрывает:** Р2.

### Ф2 — Убрать probe-инспектор ОБЕЩАНИЙ (только вопросы)
**Ценность.** Как владелец/сотрудник, перестаю получать «Ты обещал — выполнил?» и эскалации — обещание-действие и так ведётся как задача.
**Картография.**
- `operations/workers/commitment-followup.cron.ts` — удалить файл (cron `@Cron('0 * * * *')`, followup + escalation).
- `operations/services/specialist-3-9-promise-keeper.service.ts` — удалить методы `sendFollowupForBlock`, `sendEscalationForBlock` (и приватные, ставшие мёртвыми: `findFollowupCandidates`/`findEscalationCandidates`, если не используются больше нигде — grep перед удалением). `[картография: сервис может остаться, если его поля читает соц-слой — тогда удаляем только probe-отправку]`.
- `operations/operations.module.ts:126,182` — снять регистрацию `CommitmentFollowupCron`; `Specialist39PromiseKeeperService` — снять, только если больше не используется (grep).
- Флаги `betaOps.commitmentFollowupEnabled`, `betaOps.commitmentFollowupLocalHour` — удалить из `typed-config.service.ts` + реестр + сид + `feature-flags.md`.
- `probe/probe-reason-policy.ts` — удалить `commitment.followup`, `commitment.silence_escalation` из `PROBE_REASON_WINDOW`, `NUDGE_REASONS`; `probe-reason-labels.ts` — соответствующие ключи.
- `operations/services/commitment-response.handler.ts` — удалить обработку ответов на эти probe `[картография: что именно удалять, что оставить под соц-слой]`.
**Что НЕ входит.** Сущность `Commitment`/`IdeaBlock commitment*`, `commitment-reliability`, `promise-network*`, `my-promises.controller`, `commitments.service`, дашборд, мост обещание→задача, `promise-cascade.*` — остаются.
**Acceptance.**
- grep `commitment\.followup|commitment\.silence_escalation` по `probe/` → 0.
- grep `CommitmentFollowupCron|sendFollowupForBlock|sendEscalationForBlock` → 0.
- Соц-слой не сломан: grep `commitment-reliability|promise-network|commitmentRecipientPersonId` → присутствуют (не удалены).
- typecheck/lint/build зелёные; спеки промис-кипера/followup — удалить/поправить.
**Закрывает:** Р3.

### Ф3 — Задачи: адресат probe = автор реплики (постановщик)
**Ценность.** Как постановщик задачи, получаю уточнение я (а не владелец компании) — потому что я инициатор.
**Картография.** `specialist-3-15-tasks.service.ts:334` (вызов `resolveProbeRecipient`), тело `resolveProbeRecipient` :547-560; `authorPersonId`/evidence доступны в `block` (:382-393, `resolveEvidenceAuthorLabels` :514).
**Что входит.**
1. Новый резолвер адресата: взять `authorPersonId` ведущей evidence блока → `Person.userId` (tenant-scoped); если несколько авторов — автор реплики, породившей задачу (ведущая цитата). Фолбэк на `resolveProbeRecipient` (owner) только если автор не определён/без аккаунта.
2. Применить для `task.assignee_unresolved` (и для Ф4 `task.due_date_missing`).
3. Самоназначение («задача мне»): автор = исполнитель → адресат = исполнитель (выходит из того же резолвера).
**Что НЕ входит.** Изменение промпта извлечения, резолвер исполнителя (это ТЗ 06-23).
**Acceptance.**
- unit: блок с `evidence.authorPersonId=P` (у P есть `userId=U`) → `recipientCandidates=[U]`, НЕ owner.
- unit: автор без `userId` → фолбэк owner (как раньше).
- unit (tenant): автор из другого Org не матчится.
- grep: в `specialist-3-15` для probe-эмита больше нет прямого `resolveProbeRecipient(tenantId)` без проверки автора.
**Закрывает:** Р4.

### Ф4 — Задачи: вопрос про срок на извлечении + ежедневный свод
**Ценность.** Как постановщик, если в задаче не указан срок и я его не проговорил — Кора сразу спрашивает срок у меня.
**Картография.** `specialist-3-15-tasks.service.ts:328-356` (блок probe assignee — образец); `me-tasks.service.ts:291-308` (образец эмита `task.due_date_missing`); `tracker.dueDateClarifyEnabled` (config, ON).
**Что входит.**
1. В `specialist-3-15` после создания IntakeIssue: если `suggestedDueDate == null` И `cfg.tracker.dueDateClarifyEnabled` → эмит probe `task.due_date_missing` адресату-постановщику (Ф3), `priorityHint = tracker.assigneeProbePriorityHint` (мгновенно). Дедуп с assignee-probe: не слать оба, если уже спросили (одно уведомление за раз — `[ASSUMPTION: если нет ни исполнителя, ни срока — приоритет вопросу про исполнителя; срок добираем после; подтвердить дедупом по контенту probe]`).
2. Срок из разговора уже извлекается (`draft` → `suggestedDueDate`); если есть — probe не шлём.
3. Ежедневный свод: cron, проходящий по задачам без ответственного и/или без срока (старше N часов, не отвеченные) → probe постановщику. Переиспользовать существующий механизм rate-limit/дедуп probe. Час/порог — `AdminSetting`.
**Что НЕ входит.** Изменение извлечения срока из текста (есть).
**Acceptance.**
- unit: задача с `suggestedDueDate=null` → эмит `task.due_date_missing` адресату-постановщику; с датой → не эмитит.
- unit: ежедневный свод находит задачу без срока > порога → probe постановщику; идемпотентно (повтор не плодит).
- crontab-строка зарегистрирована; крутилки в реестре + сид.
**Закрывает:** Р5.

### Ф5 — Новый агент «расскажи, как решал» при переходе в «Готово»
**Ценность.** Как компания, при закрытии значимой задачи сохраняю знание «как именно её решали» (для памяти/инструкций/двойника); как руководитель — доказательство, что сложная задача реально доведена.
**Картография.** `issues.service.ts:1136 transitionState`, переход в `completed` (:1163, :1188 — рядом `maybeMarkDecisionsImplementedForIssue`); существующий узкий вопрос `me-tasks.service.ts:399` (`task.completion_detail_missing`) — заменяем; `task-closure-verify.prompt.ts` (оценка деталей — образец LLM-гейта); `probe.voiceInputEnabled` (ON).
**Что входит.**
1. Хук в `transitionState` при `newState.category === 'completed'` (любой путь): оценить значимость/сложность задачи (LLM или эвристика: длительность/число шагов/размер описания) против порога `AdminSetting` (`tracker.methodCaptureMinComplexity` — новая крутилка). Незначимая → не спрашиваем.
2. Если значимая → probe исполнителю, reason переименовать/расширить (`task.completion_detail_missing` → семантика «как решал»): текст «Ты закрыл «<задача>». Расскажи пошагово, как ты её решал — это важно для памяти компании. Можно текстом, а удобнее — голосом.» Окно `immediate`/digest — `[ASSUMPTION: immediate, но низкий приоритет, чтобы не конкурировать с критичными; подтвердить]`. Голос — через существующий `voiceInputEnabled`.
3. **Заменить** старый узкий вопрос: убрать эмит `task.completion_detail_missing` из `completeTask` (`me-tasks.service.ts:399`) ИЛИ свести оба пути к новому хуку в `transitionState` (избежать двойного вопроса при закрытии через помощника — тот тоже идёт в completed).
4. Необязательность + 1 напоминание: переиспользовать общий probe-механизм; одно мягкое повторное уведомление, если нет ответа за окно (`AdminSetting`).
5. Агент НЕ пишет сам в клон/регламенты — только `probe.suggest`.
**Что НЕ входит.** Запись в клон/регламенты/журнал (Ф6 — это уже существующая цепочка, проверяем).
**Acceptance.**
- unit: `transitionState` задачи (значимой) в `completed` → эмит нового probe исполнителю; незначимой → не эмитит.
- unit: закрытие через `completeTask` НЕ порождает второй probe (один вопрос на закрытие).
- grep: старый прямой эмит `task.completion_detail_missing` в `completeTask` снят/сведён к единому хуку.
- текст probe содержит предложение «текстом или голосом»; нет inline-кнопок (только текст/голос — `feedback_probe_no_buttons`).
- крутилки `tracker.methodCaptureMinComplexity` (+ окно напоминания) в реестре + сид + UI-поле.
**Закрывает:** Р6, Р7, Р8 (часть — вопрос).

### Ф6 — Проверка «мостиков»: ответ исполнителя уходит по дальней цепочке
**Ценность.** Как компания, уверена, что рассказ «как решал» не оседает в карточке, а реально питает память → инструкции/двойника.
**Картография.** `probe-response.handler.ts:152` `ingestResponseAsRawEvent` (:1434) → `ConversationalIngestAdapter.ingestFreeNote` → `RawEvent(kind='free_note')` → block-ingest → специалисты (регламенты `3-1`, клон `3-2`, журнал).
**Что входит.**
1. Подтвердить тестом, что ответ на НОВЫЙ probe (Ф5) проходит `ingestResponseAsRawEvent` (а не только записывается заметкой в карточку как `IssueActivity`). Если новый reason не попадает в ветку `ingestResponseAsRawEvent` — добавить его туда.
2. Подтвердить, что `RawEvent` из такого ответа реально доходит до регламент/клон-специалистов (нота достаточно богата; не отфильтровывается как low-value). При необходимости — пометить источник (`metadata.source='task_method_capture'`), чтобы специалисты учитывали.
3. НЕ дублировать: ответ и в карточку (доказательство, Ф9 ТЗ 06-23 — живая карточка), и в общий pipeline — оба, но без двойного ingest одного текста (идемпотентность по `sourceBlockId`/контенту).
**Что НЕ входит.** Изменение самих специалистов регламентов/клона (они подхватывают сами).
**Acceptance.**
- интеграц: ответ на новый probe → создан `RawEvent(kind='free_note')` с текстом ответа (grep по pipeline-логу/БД в тесте) → прошёл block-ingest.
- интеграц: тот же ответ виден в карточке задачи (заметка) — оба канала; повторный прогон не плодит второй RawEvent (идемпотентность).
- `[если мостик не соединён для нового reason]` — добавлен и покрыт тестом.
**Закрывает:** Р8 (проверка мостиков).

---

## Ф7 — Регламенты: снос probe-инспектора + автопривязка семейства к людям (одобрено 2026-07-02, Р9–Р13)

**Ценность.** Как владелец — перестаю получать вопросы Коры про регламенты («кто отвечает / из каких шагов / актуально ли / на кого распространяется»): свод собирается сам. Как компания — каждый регламент/инструкция/процесс/политика привязаны к людям (один ответственный + все причастные), знание видно в клонах, ни один документ не остаётся бесхозным.

**Основание.** Одобренная архитектура — раздел 11 (`plans/architecture/2026-06-29-kora-clarify-questions-overhaul.md`), решения Р9–Р13. Развилки закрыты владельцем — не пересматривать.

### ⚠️ КРИТИЧЕСКАЯ находка при картографии (2026-07-02) — план Ф7 требует коррекции ДО реализации

- **Два режима извлечения, флаг `knowledge.specialists_combined_enabled` (ENV `SPECIALISTS_COMBINED_ENABLED`), дефолт `true`** (`typed-config.service.ts:1020`, `env.schema.ts:404`). Combined ON → 9 специалистов (вкл. регламенты) идут одним проходом `specialists-combined.service.ts`; legacy-воркеры `specialist-3-1-regulations.*` для этих signalType НЕ маршрутизируются (`router.service.ts:83-86`).
- **Probe-инспектор регламентов (`specialist-3-1-probe`) вызывается ТОЛЬКО из legacy `specialist-3-1-regulations.service.ts` (:560/:822/:1082).** Значит при combined=ON (дефолт/прод) **вопросы про регламенты, скорее всего, НЕ срабатывают вовсе** — legacy-путь дремлет. → Ф7.1 из «снос живой долбёжки» превращается в **чистку дремлющего legacy-кода** (гигиена), а не устранение реальной боли. `[verify: подтвердить флаг в проде — не переопределён ли AdminSetting/ENV в false]`.
- **Инспектор делает ДВОЙНУЮ работу:** не только вопросы (`emit()`), но и **молчаливое авто-назначение владельца** через `OwnerResolverService` (лестница: parentOwner → роль→единственный держатель → **authorUserId** → пул). Удалять его целиком как Ф1/Ф2 **нельзя** — потеряем авто-привязку.
- **Author-fallback УЖЕ есть рунгом в `owner-resolver.service.ts` (ветка `authorUserId → resolved`), но в вызове передаётся `authorUserId: null` (`specialist-3-1-probe.service.ts:189`) — не подключён.** То есть желаемый Р10 частично = «подключить существующую ступень», а не строить заново.
- **Реальный owner-путь в проде (combined) = `ownerHint`→`resolvePersonByHint` (слабый: тёзки fail-closed → null), owner-resolver-лестница и author НЕ используются, probe-бэкстопа НЕТ.** → **Настоящая ценность Ф7 — author-fallback + personSubjectIds в `specialists-combined` (Ф7.2)**; Ф7.1 — вторично (legacy-чистка). Ф7.3 (process/policy через GraphService) остаётся.
- **Вывод (согласовано владельцем 2026-07-02):** переориентировать Ф7 на живой combined-путь; Ф7.1 понижена до legacy-чистки (сохранив/переиспользовав owner-resolver-лестницу, а не удаляя её). **Ф7.2 РЕАЛИЗОВАНА** по верной карте (combined-путь, `specialists-combined.service.ts`); Ф7.1 и Ф7.3 — остаются в ТЗ к реализации (см. Итог).

### REALITY-CHECK Ф7 (факт на ветке `work/2026-06-29`, номера строк — перечитать по якорю-символу перед правкой)

| Проверено | Где (якорь) | Вывод для Ф7 |
|---|---|---|
| probe-инспектор регламентов **живой**, шлёт 5 reasons | `knowledge-core/services/specialist-3-1-probe.service.ts` (emit :213/:227/:256/:271/:297/:344/:378; `emit()` :390); reasons `regulation.missing_owner` / `regulation.process_no_steps` / `regulation.scope_unclear` / `regulation.stale` / `regulation.existence_confirm` | Ф7.1 сносит файл + регистрацию + reasons (образец Ф1/Ф2) |
| reasons в policy/labels/handler/util | `probe/probe-reason-policy.ts` (`regulation.*` в `PROBE_REASON_WINDOW` :8-18, `MACHINE_FILLABLE_REASONS` :38-40, `regulationFamilyProvenance` :60 + ветки :107-111/:180-240); `probe/probe-reason-labels.ts:24-27,81-84`; `probe/probe-response.handler.ts` (ветка ответа `regulation.*`); `probe/existence-confirm.util.ts:16` (field `ownerPersonId`) | Ф7.1: снять эмиттеры/провенанс/handler; метки оставить терпимыми к чтению старых записей (фолбэк-метка), как в Ф1 |
| **Owner для Regulation/Instruction — ЕСТЬ, из `ownerHint`** | `knowledge-core/services/specialists-combined.service.ts`: `persistRegulations` (:831, owner :856), `persistInstructions` (:902, owner :925), `resolveOwnerPersonHint` (:1260 → `entities.resolvePersonByHint`; при тёзках fail-closed → null + `incRegulationOwnerUnresolved`) | Ф7.2: author-fallback при null + `personSubjectIds` union — ЗДЕСЬ |
| **Owner для Process/Policy — НЕТ вообще** | создаются в `common/graph/graph.service.ts` `upsertEntity` (case `process` :567, `policy` :611) из `knowledge-core/workers/block-ingest.worker.ts:437`; данные только `{name, contentMd/description, confidence}`, `ownerHint` не резолвится; **guard «если запись есть → `return {created:false}`, НЕ обновляет»** (:572/:599/:616) | Ф7.3: отдельная под-задача — путь R/I переиспользовать НЕЛЬЗЯ; нужен author в GraphService + смена guard на update |
| `authorPersonId` источник | `IdeaBlockEvidence.authorPersonId` (миграция `20260623083858`); в block-ingest — `authorIdentity.authorPersonId` (`block-ingest.worker.ts:332`); Ф3 уже берёт автора для адресата задач (тот же источник) | Ф7.2/7.3: единый источник автора |
| эталон накопления subjects (union, не replace) | `ideas/services/ideas.service.ts:446` `Array.from(new Set([...idea.personSubjectIds, person.entityId]))` | Ф7.2/7.3: union |
| `personSubjectIds` хранит **`Person.entityId`**, `ownerPersonId` — **`Person.id`** | schema Regulation/Instruction/Process/Policy; `ideas`/`personal-daily-brief` читают через `{ has/hasSome }` по entityId | Ф7: subjects — резолв `Person.id`→`Person.entityId`; owner — `Person.id` |
| Person→Entity резолв дыряв | функтест 2026-07-01 (`plans/analysis/2026-07-01-functional-test-FINAL-summary.md`): `Person.entityTenantId` 11/11 NULL, S-C3 коллапс клона при мерже (F-1/F-5) | Ф7 зависимость-риск: привязка к клону промахнётся без фикса — см. Pre-mortem |
| поля у всех 4 таблиц | schema: `Regulation`/`Instruction`/`Process`/`Policy` — все имеют `ownerPersonId` + `personSubjectIds`; `Process` ещё `ownerRoleId` | покрытие всех 4 (Р12); `ownerRoleId` НЕ трогаем |

### Ф7.1 — Снести probe-инспектор регламентов
**Ценность.** Как владелец — Кора больше не задаёт вопросы про регламенты; свод собирается сам.
**Картография.** `specialist-3-1-probe.service.ts` (удалить файл целиком, вкл. его `@Cron`, если есть); `knowledge-core.module.ts` (снять из `providers`/`exports`); `probe-reason-policy.ts` (убрать `regulation.*` из `PROBE_REASON_WINDOW`, `MACHINE_FILLABLE_REASONS`, ветки `regulationFamilyProvenance` и её вызовы); `probe-reason-labels.ts` (по образцу Ф1 — оставить метки терпимыми к чтению старых записей ИЛИ удалить, синхронно с тем, как сделали для `decision.*`); `probe-response.handler.ts` (удалить ветку обработки ответов `regulation.*`); `existence-confirm.util.ts` (удалить, если используется ТОЛЬКО regulation-семейством — иначе оставить).
**Перед удалением** — grep call-sites публичных методов `Specialist31ProbeService` (`checkAndEmit*`/`emit*`) по репо: удалить живые вызовы (в Ф1 у инспектора решений был 1 живой call-site — здесь перепроверить).
**Что НЕ входит.** Сам извлекатель регламентов (`specialists-combined` / `block-ingest` / `regulation-extract.prompt` / `regulation-dedupe.prompt`), сущности, дедуп, ConflictItem — не трогаем.
**Acceptance.**
- grep `Specialist31ProbeService` → 0 (файл удалён, регистрация снята).
- grep эмита `regulation\.missing_owner|regulation\.process_no_steps|regulation\.scope_unclear|regulation\.stale|regulation\.existence_confirm` в `probe/` и `knowledge-core/` (кроме `.spec` и терпимых меток-фолбэков) → 0.
- чтение исторической записи с `reason='regulation.*'` не падает (фолбэк-метка) — unit по аналогии с decision-фолбэком Ф1.
- `bun run typecheck` (вкл. `.spec`)/`lint`/`build` зелёные; probe-policy/labels/handler-спеки в части `regulation.*` — удалить/поправить.
**Закрывает:** Р9.

### Ф7.2 — Regulation/Instruction: owner author-fallback + personSubjectIds (union)
**Ценность.** Как компания — у каждого регламента/инструкции есть ответственный (кто заговорил, если роль-владелец не распознан) и список всех причастных для клонов.
**Картография.** `specialists-combined.service.ts` `persistRegulations` (:831/upsert :865, owner :856/:879/:890), `persistInstructions` (:902/upsert :933, owner :925/:947/:959); `resolveOwnerPersonHint` (:1260); pre-fetch existing по `tenantId_name` для union (`sourceBlockIds` union :861/:929 — образец).
**Что входит.**
1. **Owner-fallback.** Порядок резолва при апсерте: `ownerHint`-разрешённый (`resolveOwnerPersonHint`) → иначе existing `ownerPersonId` (не затирать при update) → иначе автор исходного блока (`authorPersonId` c evidence блока `r.sourceBlockId`, `Person.id`). То есть `update.ownerPersonId` присваиваем ТОЛЬКО когда `ownerHint` разрешился (повышение до явного владельца); если не разрешился — при create ставим author-fallback, при update не трогаем существующего (Р10).
2. **personSubjectIds (union).** Резолв авторов исходных блоков (`authorPersonId`→`Person.entityId`) → union с существующим массивом (pre-fetch как для `sourceBlockIds`), на create И на каждом update. Не replace, дедуп через `Set` (Р11).
3. Резолвер автора: helper на evidence блока (`IdeaBlockEvidence.authorPersonId`), tenant-scoped; `Person.id`→`Person.entityId` через `Person` (tenant-scoped). При отсутствии автора/entityId — owner остаётся как есть, subjects не пополняем (best-effort, без падения апсерта).
**Что НЕ входит.** Изменение `regulation-extract`/`specialists-combined` промпта; дедуп; process/policy (Ф7.3).
**Acceptance (unit).**
- `ownerHint` разрешился в Person `X` → `ownerPersonId=X` (как сейчас, не сломано).
- `ownerHint=null`, у автора блока есть `Person P` → **create**: `ownerPersonId=P`.
- **update** без разрешённого `ownerHint`, у записи уже есть `ownerPersonId=Q` → `Q` НЕ перезаписан author-fallback'ом.
- update с новым разрешённым `ownerHint=R` → `ownerPersonId` повышен до `R`.
- второй исходный блок другого автора `A2` → `personSubjectIds` содержит `entityId(A1)` И `entityId(A2)` (union, без дублей).
- tenant-изоляция: автор/Person из другого Org не матчится.
**Закрывает:** Р10, Р11 (Regulation/Instruction), Р12 (Regulation/Instruction).

### Ф7.3 — Process/Policy: owner author-fallback + personSubjectIds (через GraphService)
**Ценность.** Как компания — процесс и политика тоже привязаны к людям (ответственный + причастные), не только регламент/инструкция.
**Картография.** `common/graph/graph.service.ts` `upsertEntity` case `process` (:567), `policy` (:611) — guard раннего `return {created:false}` при существующей записи (:572/:599/:616); вызов из `block-ingest.worker.ts:437`, автор доступен как `authorIdentity.authorPersonId` (:332).
**Что входит.**
1. Прокинуть в `GraphService.upsertEntity` (или его вызов из block-ingest) автора: `authorPersonId` (`Person.id`) + `authorEntityId` (`Person.entityId`).
2. Case `process`/`policy`: при **create** — `ownerPersonId = authorFallback` (`ownerHint` в этом пути нет — owner = автор), `personSubjectIds = [authorEntityId]`. При **существующей записи** — вместо no-op: **update** — `personSubjectIds` union нового автора; `ownerPersonId` заполнить только если сейчас `null` (не перебивать). (Р10/Р11 для process/policy.)
3. **Scope guard-правки строго к `process`/`policy`.** Case `regulation` (и `tool`/`metric`) в GraphService **не менять** — владелец регламента остаётся за Ф7.2 (`specialists-combined`), иначе гонка двух путей за один `tenantId_name`. `Process.ownerRoleId` не трогать.
4. `[ASSUMPTION: block-ingest и specialists-combined — разные проходы; регламент может создаваться обоими и сходиться по `tenantId_name`; process/policy — только через GraphService. Перепроверить при реализации, что specialists-combined НЕ персистит process/policy (grep `persistProcess`/`persistPolic` → 0 на момент написания).]`
**Что НЕ входит.** `ownerHint` для process/policy (в block-ingest-пути его нет — не вводим); regulation/instruction (Ф7.2); `ownerRoleId`.
**Acceptance (unit/интеграц).**
- process/policy создан через block-ingest с автором `P` → `ownerPersonId=P`, `personSubjectIds=[entityId(P)]`.
- второй исходный блок автора `A2` по тому же `tenantId_name` → guard теперь обновляет: `personSubjectIds` union `[entityId(P), entityId(A2)]`; `ownerPersonId` НЕ перезаписан.
- запись без определённого автора → owner/subjects не проставляются, апсерт не падает.
- grep: в `upsertEntity` изменены ТОЛЬКО case `process`/`policy` (case `regulation`/`tool`/`metric` не тронуты).
- tenant-изоляция.
**Закрывает:** Р11 (Process/Policy), Р12 (Process/Policy).

---

## Граф зависимостей
- **Ф1, Ф2 — независимы** (удаления), параллельны.
- **Ф3 → Ф4** (Ф4 использует адресата из Ф3).
- **Ф5 → Ф6** (Ф6 проверяет цепочку ответа на probe из Ф5).
- Ф1/Ф2 ‖ (Ф3→Ф4) ‖ (Ф5→Ф6).
- Порядок волн: волна 1 — Ф1, Ф2, Ф3, Ф5 (могут идти параллельно разными агентами); волна 2 — Ф4 (после Ф3), Ф6 (после Ф5).
- **Ф7 (новый инкремент 2026-07-02):** Ф7.1, Ф7.2, Ф7.3 — **независимы** (разные файлы/пути: probe-реестры · `specialists-combined` · `graph.service`), параллельны разными агентами. Ф7 в целом независима от Ф1–Ф6 (те реализованы).

## Матрица покрытия
| Требование | Фаза |
|---|---|
| Р2 (убрать решения) | Ф1 |
| Р3 (убрать обещания-вопросы) | Ф2 |
| Р4 (адресат=постановщик) | Ф3 |
| Р5 (срок + свод) | Ф4 |
| Р6, Р7 (новый агент, значимые, замена, триггер) | Ф5 |
| Р8 (агент не пишет сам; проверка мостиков) | Ф5 + Ф6 |
| Р9 (снос probe-инспектора регламентов) | Ф7.1 |
| Р10 (owner author-fallback, не перебивать) | Ф7.2 + Ф7.3 |
| Р11 (personSubjectIds union, накапливать) | Ф7.2 + Ф7.3 |
| Р12 (покрыть 4 таблицы) | Ф7.2 (Regulation/Instruction) + Ф7.3 (Process/Policy) |
| Р13 (дедуп/варианты/конфликты не трогаем; per-person не заводим) | Ф7 (граница scope — не входит) |

## Pre-mortem / Риски (для strict-production-review-gate)
- `[risk, Med]` Удаление probe-reason `decision.*`/`commitment.*` при живых строках в БД (`probe_events.reason`, `notification.eventType`) — это исторические данные, не enum схемы; чтение старых записей не должно падать. Митигация: не удалять записи, только эмиттеры/реестры; UI/чтение — терпимо к неизвестному reason (фолбэк-метка).
- `[risk, Med]` Ф3: tenant-утечка при резолве автора → `userId`. Митигация: tenant-scoped запрос Person, unit на изоляцию.
- `[risk, Med]` Ф5: двойной вопрос при закрытии через помощника (completeTask тоже → completed). Митигация: единый хук в `transitionState`, снять прямой эмит в completeTask; unit на «один вопрос».
- `[risk, Low]` Ф4: задача без исполнителя И без срока → два probe сразу (шум). Митигация: одно уведомление за раз, второй вопрос после ответа на первый.
- `[risk, Low]` Ф6: один и тот же ответ дважды в pipeline. Митигация: идемпотентность по контенту/sourceBlockId.
- `[наблюдаемость]` Метрики probe по `reason=decision.*/commitment.*` обнулятся — нормально. Новый reason «как решал» — добавить в существующие probe-метрики.
- `[risk, High]` Ф7.2/7.3: привязка к клону через `personSubjectIds` (хранит `Person.entityId`) промахнётся при дырявом Person→Entity резолве — функтест 2026-07-01: `Person.entityTenantId` 11/11 NULL, S-C3 коллапс клона при мерже (F-1/F-5). Митигация: Ф7 best-effort (нет entityId → subjects не пополняем, апсерт не падает); **фикс person-entity — вне Ф7, но блокирует пользу** (пометить в `04_не-сделано`, увязать с блокерами доверия функтеста).
- `[risk, Med]` Ф7.3: гонка двух путей за один `regulation` `tenantId_name` (GraphService node vs specialists-combined rich upsert). Митигация: GraphService-правки строго к `process`/`policy`; `regulation`/`tool`/`metric` case не трогаем — владелец регламента только за Ф7.2.
- `[risk, Med]` Ф7.3: смена guard раннего `return` в `upsertEntity` на update может задеть путь создания process/policy (лишние записи/перетирание). Митигация: обновлять только `personSubjectIds` (union) + `ownerPersonId` если null; grep-проверка, что изменены ТОЛЬКО case `process`/`policy`.
- `[risk, Med]` Ф7.1: удаление probe-reason `regulation.*` при живых строках в БД (историческое) — как в Ф1: не удалять записи, чтение терпимо к неизвестному reason (фолбэк-метка); unit.
- `[risk, Low]` Ф7.2: author-fallback перетирает существующего владельца при update. Митигация: `update.ownerPersonId` присваивать ТОЛЬКО при разрешённом `ownerHint`; unit «Q не перезаписан».

## Прод-операции (prod-deploy-log.md)
- Удаление флагов `proactive.rules.decisionNoOwner`, `betaOps.commitmentFollowupEnabled`/`commitmentFollowupLocalHour` → Шаг 1 + `feature-flags.md` (убрать строки).
- Новые AdminSetting (`tracker.methodCaptureMinComplexity`, окно напоминания, час/порог ежедневного свода Ф4) → Шаг 1/7 (сид) + UI-поле + реестр.
- Новый/изменённый probe-reason + изменённый cron-набор (минус decision-cron, минус commitment-followup-cron, плюс ежедневный свод Ф4) → Шаг 12 (smoke grep очередей/cron/Swagger).
- Миграций схемы НЕ требуется (сущности не трогаем). Если Ф5 добавит поле-флаг «probe уже задан» на Issue — аддитивная миграция `prisma:push` локально + файл; иначе хранить дедуп в Redis (предпочтительно, как у probe).
- **Ф7:** удаляемый probe-инспектор регламентов (`specialist-3-1-probe`, его `@Cron` если есть) + reasons `regulation.*` → Шаг 12 (smoke grep cron/очередей). Миграций схемы НЕ требуется — `ownerPersonId`/`personSubjectIds` уже в моделях Regulation/Instruction/Process/Policy. Новых AdminSetting-крутилок Ф7 не вводит (если у `specialist-3-1-probe` был свой флаг — удалить из реестра/сида/`feature-flags.md`, Шаг 1). Person→Entity фикс (зависимость Ф7) — отдельная строка в `04_не-сделано`, не в этом ТЗ.

## DoD
typecheck (вкл. `.spec`)/lint/build зелёные; vitest по затронутым + Acceptance каждой фазы; `second-brain/01_projects/probe-agent.md` + `…/tracker.md` (новый агент, адресат, удалённые инспекторы) + `01_projects/ai-jobs.md`/`workers-queues.md` (минус кроны решений/обещаний, плюс свод Ф4) обновлены; `feature-flags.md` + `prod-deploy-log.md`; `04_не-сделано` — закрыть строки про шум инспекторов, если были; рефлексия в `05_история/`.

## Итог
**Ф1–Ф6 — реализовано целиком (ветка `work/2026-06-29`).** Все 6 фаз + hardening по strict-review. **Ф7 (Р9–Р13) — новый инкремент (2026-07-02), к реализации** (см. таблицу ниже).

| Ф7 под-фаза | Статус | Коммит |
|---|---|---|
| Ф7.2 — Regulation/Instruction: owner author-fallback + personSubjectIds union (живой combined-путь) | [x] реализовано | `922df7f5` |
| Ф7.1 — legacy-чистка probe-инспектора регламентов (сохранить owner-resolver-лестницу) | [ ] к реализации | — |
| Ф7.3 — Process/Policy: owner author-fallback + personSubjectIds (пост-привязка в block-ingest, без правки guard GraphService) | [ ] к реализации | — |

**Ф7.2 реализовано (2026-07-02):** helper `resolveBlockAuthor` (evidence→`authorPersonId`→Person `id`+`entityId`); в `persistRegulations`/`persistInstructions` — owner-цепочка `ownerHint` → existing (не перебивать) → author-fallback (create + backfill при `ownerPersonId=null` на update), `personSubjectIds` union автора (create + update). Verify: typecheck зелёный, spec `specialists-combined.service.spec.ts` — 30 passed. Убраны narrative-комментарии Б57 в редактируемых блоках (CLAUDE.md). Юнит-тесты на новую логику (acceptance Ф7.2) — **добрать** (строка в `04_не-сделано`). Ф7.3 обновлён: пост-привязка в block-ingest (после `graph.upsertEntity`), guard `upsertEntity` НЕ трогаем — накопление subjects идёт вторым update'ом.


| Фаза | Коммит | Статус |
|---|---|---|
| Ф1 — снос инспектора решений | `750e0df5` | [x] |
| Ф2 — снос инспектора обещаний | `d9a6fbdf` | [x] |
| Ф3 — адресат = постановщик | `910900fe` | [x] |
| Ф4 — срок на извлечении + свод | `67b5e8d3` | [x] |
| Ф5 — агент «как решал» | `f01a4172` | [x] |
| Ф6 — мостик ответа | `d19f6126` | [x] |
| hardening (update()-путь Р7) | `c10095ae` | [x] |
| docs (каталог/реестры) | `e466f83f` | [x] |

**Верификация:** `build` EXIT 0; vitest по всем затронутым модулям — 1480 passed; strict-review — критичных/HIGH нет.

**REALITY-CHECK уточнения (важно для будущих ТЗ):**
- Хук-call-site решений (`checkAndEmitForDecision`) был **один живой** — `specialist-3-3-decisions.service.ts:516`; `emitCompetingVersions` внешних вызовов не имел. Удаление чистое.
- `promise-cascade.*` — НЕ трогали (подтверждено вне scope «вопросов»; соц-слой обещаний цел — 88 ссылок).
- **Мостик создаёт `RawEvent(kind='notification_response')`, а не `free_note`** (ТЗ Ф6 указывал free_note). Мостик уже универсален/reason-агностичен — Ф6 свелась к `signalTypeHint:'reasoning'` + тест.
- **`completeTask` НЕ зовёт `transitionState`** (создаёт `TaskClosureCandidate(pending)`); закрытие через помощника доходит до completed отдельно → хук Ф5 покрывает.
- **`issues.update()` (PATCH stateId) ставит `completedAt` МИНУЯ `transitionState`** — ТЗ-предположение «обновление делегирует в transitionState» оказалось неполным; strict-review вскрыл, hardening-коммит `c10095ae` добавил хук и в `update()` (Р7 «любой путь»).

**Отложено (осознанно):** общий бюджет/батч прохода `runClarifySweep` (N+1 при росте числа Org) — строка в `second-brain/04_не-сделано/README.md`.
