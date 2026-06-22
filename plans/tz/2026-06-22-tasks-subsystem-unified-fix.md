---
type: tz
status: ready-to-implement
feature: tasks-subsystem-unified-fix
date: 2026-06-22
owner: Сергей (владелец продукта Кора)
relates_to:
  - plans/analysis/2026-06-22-tasks-lifecycle-deep-audit.md
  - plans/tz/2026-06-21-learned-clarifications-memory.md
  - plans/tz/2026-06-22-task-resolution-loop-and-cross-channel-completion.md
  - plans/tz/2026-06-21-daily-reminders-delivery-fix-and-work-calendar.md
---

# ТЗ: Задачная подсистема Коры — единый фикс (все находки аудита)

Статус: **ready-to-implement**
Источник: [2026-06-22-tasks-lifecycle-deep-audit.md](../analysis/2026-06-22-tasks-lifecycle-deep-audit.md) (15 находок) + живой тест на проде (Playwright) + чтение кода.

> Единый контракт на всю задачную подсистему. Внутри — блоки A–D (каждый = тематический кластер находок) с фазами для управляемой приёмки. В работу берётся весь объём; деление — только для приёмки. Порядок реализации в §5.

---

## 0. Проблемы владельца (дословно)
1. «Задача Сергею вернула 404 — но она должна была **создаться в любом случае**, а потом уточняющий вопрос „на кого повесить".»
2. «Если задача **без срока** — обязательно спросить „Установите срок задачи".»
3. «„Отдел дизайна сделать дизайн" не работает. Для этого была **система обучения**: Кора спрашивает „Для кого эта задача?", отвечаем „Анна" — и **запоминает**, дальше сама.»
4. «Сотрудник хочет **видеть с утра свои задачи** и **пинок, что не сделал**; руководитель — видеть это в дашборде (что/зачем/почему).»
5. «Любой входящий канал должен анализироваться: задача из любого источника не должна теряться.»

---

## 1. Карта (контекст, кратко)
- **Две системы задач:** `Issue` (трекер; из встреч/помощника) и `Task` (отдельная таблица; из чатов, суточный крон в полночь). Не связаны.
- **Два резолвера исполнителя:** `tracker/AssigneeResolverService` (строгий, 404) и `knowledge-core/TaskAssigneeResolverService` (мягкий, null).
- **Готовая, но не подведённая «система обучения»:** `SubjectMemory` (выученные дизамбигуации; обучение и подавление переспроса уже срабатывают на любой probe).

Полная карта — §1–§8 анализа.

---

## 2. Доказательная база и якоря (по коду на 2026-06-22; вернуть перед правкой)
| F | Находка | Якорь |
|---|---|---|
| F1 | 404/409 до создания → задача не создаётся | [me-tasks.service.ts:100-119](../../backend/src/modules/tracker/services/me-tasks.service.ts#L100-L119) |
| F3 | quality-gate тихо выбрасывает задачу встречи без owner+срока | [meeting-extract-actions.service.ts:340-354](../../backend/src/modules/tracker/services/meeting-extract-actions.service.ts#L340); [task-quality-gate.util.ts:141-149](../../backend/src/modules/tracker/services/task-quality-gate.util.ts#L141) |
| F4 | probe не знает про неразрешённого исполнителя | [probe-reason-labels.ts](../../backend/src/modules/probe/probe-reason-labels.ts) |
| F5 | задачи без срока не попадают в утреннюю сводку | [personal-daily-brief.service.ts:155](../../backend/src/modules/operations/services/personal-daily-brief.service.ts#L155) |
| F6 | просрочка не доходит до исполнителя (только граф) | [tracker-emitter.service.ts:144](../../backend/src/modules/tracker/services/tracker-emitter.service.ts#L144); [issue-overdue-detector.cron.ts:19](../../backend/src/modules/tracker/workers/issue-overdue-detector.cron.ts#L19) |
| F7 | нет вечерней сверки «план→факт по сегодняшней задаче» | [proactive-watcher.service.ts:481-552](../../backend/src/modules/proactive/services/proactive-watcher.service.ts#L481) |
| F8 | резолвер не отличает человека от отдела/роли | [assignee-resolver.service.ts:18-58](../../backend/src/modules/tracker/services/assignee-resolver.service.ts#L18); [concierge-respond.prompt.ts:47-48](../../backend/src/modules/concierge/prompts/concierge-respond.prompt.ts#L47) |
| F10 | две несвязанные системы задач (Issue/Task) | [cross-source-task-dedupe.service.ts:228](../../backend/src/modules/chatbox/cross-source-task-dedupe.service.ts#L228) vs [meeting-extract-actions.service.ts:360](../../backend/src/modules/tracker/services/meeting-extract-actions.service.ts#L360) |
| F11 | ответ на probe не исполняется (образец — existence_confirm) | [probe-response.handler.ts:133-148](../../backend/src/modules/probe/probe-response.handler.ts#L133) |
| F12 | решение не замыкается на задачу (`implemented` мёртв) | [decision-task-link.util.ts](../../backend/src/modules/tracker/services/decision-task-link.util.ts); [pending-actions.service.ts:539](../../backend/src/modules/pending-actions/services/pending-actions.service.ts#L539) |
| F13 | объяснимость вклада посчитана, но не показана; нет кросс-проектного «зависшие» | [execution-dashboard.service.ts:160-180](../../backend/src/modules/dashboard/services/execution-dashboard.service.ts#L160); [sprint-analyst.service.ts:239-260](../../backend/src/modules/tracker/services/sprint-analyst.service.ts#L239) |
| F14 | кроны по UTC (+3ч МСК), расписания захардкожены | [app.module.ts:142](../../backend/src/app.module.ts#L142) |
| F15 | напоминания только в Telegram, не в кабинет | [pending-actions-reminder.cron.ts:61](../../backend/src/modules/pending-actions/workers/pending-actions-reminder.cron.ts#L61) |

**Уже закрыто (НЕ переделывать):** F2 (склонения, `beb39c85`) и F9 (видимость закрытия исполнителю, Ф4 петли) — влиты в `origin/dev`, на проде.

**Готовая инфра обучения (переиспользовать, не строить заново):** `probe-response.handler` уже дерайвит `SubjectMemory` на любой отвеченный probe и уже диспетчеризует действие по reason ([:110-148](../../backend/src/modules/probe/probe-response.handler.ts#L110)); `SubjectMemory.findApplicableRule`/`gate()` уже подавляют переспрос. Нужны лишь: вход (probe в точке назначения) и выход (исполнить ответ).

---

## 3. Решения владельца (не переоткрывать)
- **Р1.** Задача создаётся **ВСЕГДА** (неназначенная, в «Входящих»), даже без исполнителя/срока. Потеря задачи запрещена (включая путь встречи — отменяет drop quality-gate как «выброс»).
- **Р2.** Недостающее (исполнитель/срок) дозапрашивается **структурным probe** (текст/голос, без inline-кнопок), а не угадыванием.
- **Р3.** Ответ probe **исполняется** (проставляет исполнителя/срок) и **запоминается** (`SubjectMemory.disambiguation`).
- **Р4.** Отдел/роль = **подобрать человека + спросить** (выбор владельца 2026-06-22); адресацию задачи на отдел как сущность в v1 **не вводим** (только спросить «для кого» + skill-подсказка).
- **Р5.** Утром сотрудник видит **свои задачи** (вкл. без срока); вечером — **пинок по незакрытым сегодня**; просрочка доходит до исполнителя. Каналы: кабинет всегда + Telegram, не только Telegram.
- **Р6.** Авто-закрытие задачи без человека запрещено (наследие R13). Закрывает/подтверждает человек.

---

## 4. Состав работ (блоки A–D)

### БЛОК A — Задача создаётся всегда + дозапрос исполнителя/срока с обучением (F1, F4, F8, F11, срок)
Главный блок (ядро мысли владельца). Точка-сборка — резолвер (единая для всех каналов), не промпт помощника.

**Контракт результата резолвера:**
```ts
export type AssigneeResolution =
  | { kind:'resolved'; userId:string; name:string; via:'name'|'memory' }
  | { kind:'not_found' }
  | { kind:'ambiguous'; candidates:{userId:string;name:string}[] }
  | { kind:'collective'; label:string; departmentId?:string; roleId?:string };
```
**Поток:** `assignTask` → резолвер. `resolved` → назначаем. `not_found|ambiguous|collective` → **создать Issue в «Входящих» с пустым исполнителем** + `probe.suggest({reason:'task.assignee_unresolved', recipientCandidates:[actor], payload:{issueId,taskTitle,hintCandidates}})`, вернуть `201 needs_assignee` (НЕ 404). Пустой `dueDate` → `probe.suggest({reason:'task.due_date_missing'})`. `hintCandidates` = `skillRouting.suggestAssignee` (подсказка, не выбор).
**Исполнение ответа** (по образцу `regulation.existence_confirm`): в `probe-response.handler` диспетчер `task.assignee_unresolved` → резолв имени из ответа → `IssueAssignee`; `task.due_date_missing` → парс даты → `Issue.dueDate`. Дерайв `SubjectMemory` уже автоматический.
**Retrieve-before-ask в резолвере:** перед `not_found/collective` — `subjectMemory.findApplicableRule` (kind `disambiguation`); правило «дизайн→userId» → `resolved via:'memory'`, probe не поднимается.

| Фаза | Содержание | Acceptance |
|---|---|---|
| A1 | 2 probe-reason (`task.assignee_unresolved`, `task.due_date_missing`) в `probe-reason-labels.ts`+`probe-reason-policy.ts` (окно immediate, recheck «поле всё ещё пусто»); 3 крутилки `tracker.assigneeClarifyEnabled`/`dueDateClarifyEnabled`/`assigneeProbePriorityHint` в registry+сид; метрика `task_assignee_clarify_total{outcome}` | grep reason; unit окна/recheck; сид идемпотентен |
| A2 | `assignTask`/`createSelfTask`: создать unassigned + поднять probe (assignee/due) вместо 404; ответ `needs_assignee`+кандидаты; концирж-описание `assign_task`+`concierge-respond.prompt` — «адресат не конкретный человек → всё равно зови assign_task, Кора уточнит сама; не угадывай молча» | интеграц: неизвестное имя → Issue без исполнителя + probe + 201 (не 404); пустой срок → due-probe; известное имя — как раньше; spec обновлён |
| A3 | `probe-response.handler`: `maybeAssignFromAnswer`/`maybeSetDueFromAnswer` (образец existence_confirm); `questionText` несёт предметный контекст задачи (для полезного правила) | unit: ответ «Анна»→assignee проставлен (idempotent); «до пятницы»→dueDate; невалид→fail-open; дерайв SubjectMemory сработал |
| A4 | резолвер: `findApplicableRule` (retrieve-before-ask) + детект `collective` через `departments.service`/role-словарь; DI `@Optional` SubjectMemory/Departments | unit: правило «дизайн→Анна»→`resolved via:memory` без probe; «отдел дизайна» без правила→`collective`; per-tenant изоляция |
| A5 | тот же контур из встреч: `meeting-extract-actions` при `assigneeUserId=null` поднимает probe адресату=инициатор/owner (best-effort) | интеграц: автозадача без исполнителя→probe; не валит обработку встречи |

### БЛОК B — Не терять задачу + единый трекер (F3, F10)
| Фаза | Содержание | Acceptance |
|---|---|---|
| B1 | F3: для AI-источника встречи `shouldMaterializeTask` НЕ дропать — всегда создавать `IntakeIssue(pending)` с `suggestedAssigneeId=null` и пометкой `lowQuality` (gate→пометка/приоритет, не drop). Прогнать автозадачи встречи через `TaskDedupService` перед `intakeIssue.create` (сейчас минует — [meeting-extract-actions.service.ts:360](../../backend/src/modules/tracker/services/meeting-extract-actions.service.ts#L360)) | интеграц: поручение без owner+срока → IntakeIssue создан (не skipped); дубль помечается suggestedDuplicateOfIssueId |
| B2 | F10 (решение владельца внутри фазы): единая лента «задача из любого источника». Вариант по умолчанию — **промоут `Task`(chatbox)→`IntakeIssue`/`Issue`** + кросс-дедуп против открытых Issue (а не только Task). Если владелец предпочтёт оставить `Task` пред-слоем — задокументировать и дать кнопку «в трекер» | интеграц: задача из чата видна в общей ленте/триаже; одна и та же задача из встречи и чата не задваивается |
| B3 | F3-смежное: `chatbox-analyze.worker` — если у Org нет owner, не терять молча: fallback (admin/первый membership) + видимый сигнал ([chatbox-analyze.worker.ts:262](../../backend/src/modules/chatbox/chatbox-analyze.worker.ts#L262)) | unit: Org без owner → задачи не пропадают молча |

### БЛОК C — Напоминания сотруднику (F5, F6, F7, F15)
| Фаза | Содержание | Acceptance |
|---|---|---|
| C1 | F5: в «Твой день» включить задачи **без срока** (секция «без срока») — снять фильтр `dueDate ≤ конец дня` для блока «мои задачи» ([personal-daily-brief.service.ts:142-205](../../backend/src/modules/operations/services/personal-daily-brief.service.ts#L142)); поднять push до `priorityTier:1` ИЛИ гарантировать кабинетный показ | интеграц: задача без срока попадает в утреннюю сводку; push не глушится тихими часами |
| C2 | F6: после `issue-overdue-detector` слать **исполнителю** уведомление о просрочке (`conversational.sendNotification` eventType `issue.overdue`, policy `[in_app,telegram_bot,max_bot]`), гейт по локальному часу; дедуп через `lastOverdueDetectedAt` ([issue-overdue-detector.cron.ts](../../backend/src/modules/tracker/workers/issue-overdue-detector.cron.ts)) | интеграц: просроченная задача → исполнитель получил in_app+push; повтор не чаще дебаунса |
| C3 | F7: вечерняя сверка «сегодня обещал X, не закрыл» — снизить порог `rulePlanItemOverdue` до 1 дня и привязать к вечернему слоту в таймзоне, ИЛИ подмешивать незакрытые пункты утреннего `plansJson` того же `dateLocal` в вечерний чек-ин ([proactive-watcher.service.ts:481-552](../../backend/src/modules/proactive/services/proactive-watcher.service.ts#L481)) | интеграц: утренний план без вечернего done → вечером пинок с НАЗВАНИЕМ задачи |
| C4 | F15: `pending-actions-reminder` + «Ждёт подтверждения N» — расширить на in_app-канал (не только Telegram), чтобы напоминание было в кабинете ([pending-actions-reminder.cron.ts:61](../../backend/src/modules/pending-actions/workers/pending-actions-reminder.cron.ts#L61)) | интеграц: сотрудник без Telegram видит напоминание в кабинете |

### БЛОК D — Видимость руководителю + время (F12, F13, F14)
| Фаза | Содержание | Acceptance |
|---|---|---|
| D1 | F13a: прокинуть «почему» вклада в цель — добавить `reasons` (топ-3 из `signalsJson`) в `getGoalVectorByPerson`+DTO ([execution-dashboard.service.ts:160-180](../../backend/src/modules/dashboard/services/execution-dashboard.service.ts#L160)) | руководитель видит «netScore −0.7, потому что …» |
| D2 | F13b: кросс-проектный экран «зависшие» (нет движения N дней) вне спринта — отдельный эндпоинт по `issueActivity._max.createdAt` без привязки к cycleId; fallback на `issue.createdAt` для задач без активности; порог в AdminSetting ([sprint-analyst.service.ts:239-260](../../backend/src/modules/tracker/services/sprint-analyst.service.ts#L239)) | руководитель без спринтов видит зависшие задачи |
| D3 | F12: замкнуть решение↔задачу — (а) обратная линковка при создании решения ПОСЛЕ задачи (`linkDerivedTasksForDecision`); (б) при закрытии всех связанных задач → `Decision.status='implemented'` (в `confirmTaskClosure`/issue→completed); (в) `markTasksForReviewOnSupersede` не трогать уже закрытые задачи ([pending-actions.service.ts:539](../../backend/src/modules/pending-actions/services/pending-actions.service.ts#L539)) | unit: решение после задачи линкуется; все задачи закрыты → решение `implemented`; закрытая задача не помечается «под вопросом» |
| D4 | F14: кроны с фикс-часом перевести на ежечасный тик + сравнение локального часа (паттерн `probe-digest.cron`), либо `TZ=Europe/Moscow`; час/частота — крутилки AdminSetting (принцип 9) ([app.module.ts:142](../../backend/src/app.module.ts#L142)) | сбор чатов/просрочка/прогресс идут по МСК; час настраивается без деплоя |

---

## 5. Порядок реализации (приоритет)
**A → C → B → D.** A — ядро мысли владельца (создать+спросить+запомнить+срок). C — прямая польза сотруднику (утром вижу задачи, пинок по незакрытым). B — не терять задачи. D — видимость руководителю. Внутри блока — по номеру фазы.

---

## 6. Доказательство, что лечит (обязательная приёмка по блокам)
- **A (главный сценарий «спросил→запомнил→не переспрашивает»):** (1) «задача отделу дизайна», правила нет → Issue без исполнителя + probe `task.assignee_unresolved` + 201 (не 404); (2) ответ «Анна» → assignee=Анна + `SubjectMemory{«дизайн»→Анна}`; (3) повторно «задача по дизайну» → `resolved via:'memory'`, probe НЕ задан; (4) без срока → probe `task.due_date_missing` → ответ выставил dueDate. **+ живой ре-тест на проде** (Playwright) тем же запросом, сравнение со скриншотом `concierge-dept-design-test.png` (до фикса — молча угадывала маркетолога).
- **B:** поручение без owner+срока → IntakeIssue создан (не потерян); задача из чата видна в общей ленте.
- **C:** задача без срока в утренней сводке; просрочка пришла исполнителю; вечером — пинок с названием незакрытой задачи; напоминание в кабинете без Telegram.
- **D:** «почему» вклада видно; зависшие видны вне спринта; решение→`implemented` при закрытии задач; кроны по МСК.

---

## 7. Инварианты Z
- Миграции только `prisma:migrate` + `STEPS` в `apply-prod-deploy.ts` + `prod-deploy-log` (если понадобятся поля: `Issue.lowQuality`/источник, метки). Большинство блоков — без миграций.
- Крутилки (пороги/часы/флаги) → AdminSetting через `getDynamic` + registry + сид + UI; не ENV, не магические константы (принцип 9).
- Флаги — Ship-On: все новые = kill-switch (ON) → строки в `docs/operations/feature-flags.md`.
- LLM: новых промптов не вводим (переиспользуем probe-*/subject-memory-*); раздел «prompt caching» — SYSTEM не трогаем.
- UI только русский; probe без inline-кнопок; парные токены `bg-*`+`text-*-fg`; без нарративных комментариев.
- Multi-tenancy: все запросы и `findApplicableRule` — с `tenantId`.

## 8. Прод-операции (предв.)
- Новые AdminSetting (Блоки A,C,D) → Шаг 1/7. Возможные поля (`Issue.lowQuality`, `issue.overdue`-payload, `Decision.implemented`-переход) → Шаг 4. Новые метрики + probe-reason + eventType → Шаг 12 (smoke grep). ENV новых нет.

## 9. DoD
typecheck (вкл. `.spec`)/lint/build зелёные; vitest по затронутым файлам + сценарии §6; живой ре-тест блока A; `second-brain/01_projects/` (tracker/probe/operations/dashboard/ai-jobs) обновлены; `feature-flags.md`+`prod-deploy-log.md`; `04_не-сделано` — закрыть/обновить строки по F1,F3,F5,F6,F7; рефлексия.

## 10. Итог
_(заполнит tz-orchestrator после реализации)_
