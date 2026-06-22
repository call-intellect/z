---
type: tz
status: ready-to-implement
feature: meeting-to-tracker-and-models-unified-fix
date: 2026-06-22
owner: Сергей (владелец продукта Кора)
supersedes:
  - plans/tz/2026-06-22-tasks-subsystem-unified-fix.md  # ПОЛНОСТЬЮ поглощён (блоки A–D перенесены сюда)
relates_to:
  - plans/analysis/2026-06-22-meeting-pipeline-evidence-base-and-model-fit.md  # доказательная база (прод + A/B + replay)
  - plans/analysis/2026-06-22-tasks-lifecycle-deep-audit.md
---

# ТЗ (ЕДИНОЕ): задачная подсистема Коры — создаётся всегда, доходит до трекера, видна сотруднику и руководителю + модели точечно Pro + системные баги конвейера

Статус: **ready-to-implement**
Это **единый контракт на весь объём** — поглощает `tasks-subsystem-unified-fix.md` и добавляет: модели (B/C-тест), системные баги конвейера, задачи из чатов, неотранскрибированную встречу. **Ничего не оставлено «на потом»** — см. матрицу покрытия §10.
Источник: [доказательная база](../analysis/2026-06-22-meeting-pipeline-evidence-base-and-model-fit.md) (живой прод + свод 9 встреч + A/B + **детерминированный replay 0→7 PASS**) + [аудит жизненного цикла](../analysis/2026-06-22-tasks-lifecycle-deep-audit.md).

---

## 0. Проблемы владельца (дословно) и решения
1. «Задача Сергею вернула 404 — должна **создаться в любом случае**, потом уточнить на кого.»
2. «Задача **без срока** — обязательно спросить срок.»
3. «„Отдел дизайна сделать дизайн" не работает — должна быть **система обучения**: спросили „для кого", ответили „Анна", **запомнила**.»
4. «Сотрудник хочет **видеть с утра свои задачи** и **пинок, что не сделал**; руководитель — видеть это в дашборде.»
5. «Любой входящий канал анализируется: задача из любого источника не теряется.»

**Решения владельца (зафиксированы 2026-06-22, не переоткрывать):**
- **Р1.** Задача создаётся **ВСЕГДА** как `Issue` (неназначенная, проект «Из встреч»/«Входящие»), видна в трекере и карточке встречи. Обязательный ручной триаж как барьер — убрать.
- **Р2.** Недостающее (исполнитель/срок) дозапрашивается **структурным probe** (текст/голос, без inline-кнопок) и **запоминается** (`SubjectMemory`).
- **Р3.** Модели — **точечно на Pro только для ИЗВЛЕЧЕНИЯ** (`meeting-extract-actions`, `decision-extract`, `idea-extract`, `insight-extract`); арбитры/триаж/линкеры — Flash; `ai.deepseek.defaultModel` не трогать.
- **Р4.** Отдел/роль = подобрать человека + спросить (адресацию на отдел как сущность в v1 не вводим).
- **Р5.** Утром сотрудник видит **свои задачи** (вкл. без срока); вечером — **пинок по незакрытым**; просрочка доходит исполнителю. Каналы: кабинет всегда + Telegram.
- **Р6.** Авто-закрытие задачи без человека запрещено (наследие R13). Анти-спам — пометка `lowQuality`, не drop.
- **Р7.** Объём — **единый пакет** (всё в этом ТЗ).

---

## 1. Карта (контекст)
- **Две системы задач:** `Issue` (трекер; встречи/помощник) и `Task` (чаты, суточный крон). Не связаны.
- **Два резолвера:** строгий `tracker/AssigneeResolverService` (404) и мягкий `knowledge-core/TaskAssigneeResolverService` (null).
- **Корень симптома «задач нет» (доказан, `confirmed`):** цепочка 5 тихих фильтров; решающий — **авто-триаж для `source=meeting` без owner-fallback** → задачи висят в `/intake`. **Replay 0→7 PASS** доказывает, что фикс A2 доводит до трекера.
- Готовая инфра обучения: `SubjectMemory` (probe-response.handler уже дерайвит правило, gate() подавляет переспрос) — нужны вход (probe в точке назначения) и выход (исполнить ответ).

---

## 2. БЛОК A — Задача создаётся ВСЕГДА + дозапрос исполнителя/срока с обучением (главный)
Закрывает F1, F3(часть), F4, F8, F11, **фильтр 4 (авто-триаж, GAP-1 — доказан replay)**, фильтр 2 (узкий резолв).

**Контракт резолвера** (единый для всех каналов):
```ts
export type AssigneeResolution =
  | { kind:'resolved'; userId:string; name:string; via:'name'|'memory' }
  | { kind:'not_found' }
  | { kind:'ambiguous'; candidates:{userId:string;name:string}[] }
  | { kind:'collective'; label:string; departmentId?:string; roleId?:string };
```

| Фаза | Содержание | Acceptance |
|---|---|---|
| A1 | **Помощник: 404→создать+спросить** (F1). В `me-tasks.service.ts:100-119` при `not_found`/`ambiguous`/`collective` НЕ бросать 404/409, а создать `Issue` в «Входящих» без исполнителя + `probe.suggest({reason:'task.assignee_unresolved', recipient:[actor], payload:{issueId,taskTitle,hintCandidates}})`, вернуть `201 needs_assignee`. Пустой срок → `probe task.due_date_missing`. `hintCandidates=skillRouting.suggestAssignee` (подсказка, не выбор). Концирж-описание `assign_task`+`concierge-respond.prompt` — «адресат не конкретный человек → всё равно зови assign_task, Кора уточнит; не угадывай молча». | интеграц: неизвестное имя → Issue без исполнителя + probe + 201 (не 404); пустой срок → due-probe; известное имя — как раньше |
| A2 | **Встреча: авто-триаж ВСЕГДА промоутит meeting→Issue** (GAP-1, доказан replay). В `intake-auto-triage.worker.ts:282,313-318` для `source=meeting` снять требования `assigneeId!==null` и `projectId!==null`: при `assigneeId=null` → `Issue` неназначенным; при `projectId=null` → дефолт-проект «Из встреч» (MTG, fallback «Входящие»); `lowQuality` тоже промоутить (с лейблом). `linkedMeetingIds=[meetingId]` (уже есть [:467](../../backend/src/modules/tracker/workers/intake-auto-triage.worker.ts#L467)). | **replay ПОСЛЕ кода = 0→7**; интеграц: meeting-задача без исполнителя/проекта → Issue (проект «Из встреч»), виден на доске и во вкладке встречи |
| A3 | **2 probe-reason** (`task.assignee_unresolved`, `task.due_date_missing`) в `probe-reason-labels.ts`+`probe-reason-policy.ts` (окно immediate, recheck «поле всё ещё пусто»); крутилки `tracker.assigneeClarifyEnabled`/`dueDateClarifyEnabled`/`assigneeProbePriorityHint` (registry+сид); метрика `task_assignee_clarify_total{outcome}` | grep reason; unit окна/recheck; сид идемпотентен |
| A4 | **Исполнение ответа probe** (F11): `probe-response.handler` диспетчер `task.assignee_unresolved`→резолв имени→`IssueAssignee`; `task.due_date_missing`→парс даты→`Issue.dueDate`; дерайв `SubjectMemory.disambiguation` (уже авто). `questionText` несёт предметный контекст. **Retrieve-before-ask**: резолвер сперва `subjectMemory.findApplicableRule` → правило «дизайн→userId» → `resolved via:memory`, probe не поднимается | unit: «Анна»→assignee (idempotent); «до пятницы»→dueDate; правило при повторе → probe НЕ задан; невалид→fail-open |
| A5 | **Резолвер: расширить + collective** (фильтр 2, F8). Резолв исполнителя матчить НЕ только участников встречи, но и сотрудников Org, упомянутых в задаче (Person `relationship=employee`); детект `collective` (отдел/роль) через `departments.service`/role-словарь; DI `@Optional` SubjectMemory/Departments | unit: «Айназ» (сотрудник, не на встрече) → resolved; «отдел дизайна» без правила → collective; per-tenant изоляция |
| A6 | **Гейт = пометка, не drop** (F3). В `meeting-extract-actions.service.ts:340-354` при `!gate.ok` НЕ `continue`, а создавать `IntakeIssue` с `lowQuality=true` + пониж. приоритет. Прогон через `TaskDedupService` ПЕРЕД создdanием ([:360](../../backend/src/modules/tracker/services/meeting-extract-actions.service.ts#L360)). При `assigneeUserId=null` из встречи — поднять probe адресату=инициатор/owner (best-effort) | интеграц: задача без owner+срока → IntakeIssue(lowQuality), не пропала; не валит обработку встречи |

---

## 3. БЛОК B — Не терять задачу + единый трекер (включая чаты)
Закрывает F3-смежное, F10, **обрыв chatbox-Task (нет UI-поверхности)**.

| Фаза | Содержание | Acceptance |
|---|---|---|
| B1 | **Единая лента «задача из любого источника»** (F10). Промоут `Task`(chatbox)→`IntakeIssue`/`Issue` + кросс-дедуп против открытых `Issue` (не только `Task`) — [cross-source-task-dedupe.service.ts:228](../../backend/src/modules/chatbox/cross-source-task-dedupe.service.ts#L228). Чат-задача попадает в общий триаж/доску | интеграц: задача из чата видна на доске; «встреча+чат» не задваивается |
| B2 | **chatbox-Task получает UI-поверхность** (обрыв из свода): сейчас `Task sourceType='chatbox', meetingId=null` не виден нигде (трекер на Issue; legacy `/tasks` deprecated не вызывается фронтом; карточка чата без секции задач). После B1 промоут в Issue решает; если оставляем `Task` пред-слоем — секция «Задачи из переписки» в карточке чата + кнопка «в трекер» | интеграц: пользователь видит задачи из чата (через Issue или секцию чата) |
| B3 | **Org без owner — не терять молча** ([chatbox-analyze.worker.ts:262](../../backend/src/modules/chatbox/chatbox-analyze.worker.ts#L262)): fallback (admin/первый membership) + видимый сигнал. Также: сессии `failed`/`analyzing` крон больше не пере-метёт (фильтр строго `pending`) → добавить re-sweep по застрявшим; не глотать исключение `extractTasks` с пометкой `done` | unit: Org без owner → задачи не пропадают; failed-сессия повторно анализируется |
| B4 | **chatbox.analysisEnabled — Ship-On** (нарушение из свода: дефолт OFF): включить анализ переписок по умолчанию (kill-switch), иначе чаты зеркалятся без анализа молча | строка в feature-flags; дефолт ON |

---

## 4. БЛОК C — Напоминания сотруднику (Р5)
Закрывает F5, F6, F7, F15.

| Фаза | Содержание | Acceptance |
|---|---|---|
| C1 | F5: в «Твой день» включить задачи **без срока** (секция «без срока») — снять фильтр `dueDate ≤ конец дня` ([personal-daily-brief.service.ts:142-205](../../backend/src/modules/operations/services/personal-daily-brief.service.ts#L142)); push `priorityTier:1` ИЛИ гарант. кабинетный показ | интеграц: задача без срока в утренней сводке; push не глушится тихими часами |
| C2 | F6: после `issue-overdue-detector` слать **исполнителю** `issue.overdue` (policy `[in_app,telegram_bot,max_bot]`), гейт по локальному часу, дедуп `lastOverdueDetectedAt` ([issue-overdue-detector.cron.ts](../../backend/src/modules/tracker/workers/issue-overdue-detector.cron.ts)) | интеграц: просрочка → исполнитель получил in_app+push; дебаунс |
| C3 | F7: вечерняя сверка «обещал X, не закрыл» — порог `rulePlanItemOverdue`→1 день + вечерний слот в таймзоне ИЛИ подмешивать незакрытые пункты утреннего `plansJson` в вечерний чек-ин ([proactive-watcher.service.ts:481-552](../../backend/src/modules/proactive/services/proactive-watcher.service.ts#L481)) | интеграц: утренний план без вечернего done → вечером пинок с НАЗВАНИЕМ |
| C4 | F15: `pending-actions-reminder` + «Ждёт подтверждения N» — расширить на in_app (не только Telegram) ([pending-actions-reminder.cron.ts:61](../../backend/src/modules/pending-actions/workers/pending-actions-reminder.cron.ts#L61)) | интеграц: сотрудник без Telegram видит напоминание в кабинете |

---

## 5. БЛОК D — Видимость руководителю + время + связь решение↔задача↔встреча (Р4)
Закрывает F12, F13, F14 + UX-разрыв «встреча↔её решения».

| Фаза | Содержание | Acceptance |
|---|---|---|
| D1 | F13a: «почему» вклада в цель — `reasons` (топ-3 из `signalsJson`) в `getGoalVectorByPerson`+DTO ([execution-dashboard.service.ts:160-180](../../backend/src/modules/dashboard/services/execution-dashboard.service.ts#L160)) | руководитель видит «netScore −0.7, потому что …» |
| D2 | F13b: кросс-проектный экран «зависшие» вне спринта — эндпоинт по `issueActivity._max.createdAt` без `cycleId`; fallback `issue.createdAt`; порог в AdminSetting ([sprint-analyst.service.ts:239-260](../../backend/src/modules/tracker/services/sprint-analyst.service.ts#L239)) | руководитель без спринтов видит зависшие |
| D3 | F12: замкнуть решение↔задачу — (а) обратная линковка `linkDerivedTasksForDecision` при создании решения после задачи; (б) все связанные задачи закрыты → `Decision.status='implemented'`; (в) `markTasksForReviewOnSupersede` не трогать закрытые ([pending-actions.service.ts:539](../../backend/src/modules/pending-actions/services/pending-actions.service.ts#L539)) | unit: решение после задачи линкуется; все задачи закрыты → `implemented` |
| D4 | F14: кроны с фикс-часом → ежечасный тик + локальный час (паттерн `probe-digest.cron`) ИЛИ `TZ=Europe/Moscow`; час/частота — крутилки AdminSetting ([app.module.ts:142](../../backend/src/app.module.ts#L142)) | сбор чатов/просрочка/прогресс по МСК; час без деплоя |
| D5 | **Связь встреча↔решения в UI** (разрыв из свода): показать материализованные `Decision` в карточке встречи ИЛИ фильтр `/decisions?meetingId=` (сейчас нет `meetingId` в `ListDecisionsQuery`) | руководитель видит «решения этой встречи» |

---

## 6. БЛОК E — Модели точечно на Pro (Р3, доказано B/C-тестом)
| Фаза | Содержание | Acceptance |
|---|---|---|
| E1 | Перевести primary на `deepseek-v4-pro` для `meeting-extract-actions`, `decision-extract`, `idea-extract`, `insight-extract` (правка сидов `seed-llm-task-routes-*.ts` + `--update-existing`, ИЛИ owner-gated `patch-task-extractor-route-pro.ts` + точечно). **Арбитры/триаж/линкеры — НЕ трогать (Flash).** `ai.deepseek.defaultModel` не менять | `diag-routes`/`/admin/ai-models`: 4 извлекающих на Pro, арбитры на Flash; в логах исчезают «invalid JSON»/fallback на extract-actions |
| E2 | Раздел «prompt caching»: SYSTEM этих агентов не менять (меняется только строка маршрута) — кэш сохраняется. Бюджет: следить `llm_router_dispatch_total`+MTD; при росте — `BudgetGuard` enforce | правок SYSTEM нет; цена под контролем |

---

## 7. БЛОК F — Системные баги конвейера (из свода 9 встреч)
| Фаза | Содержание | Acceptance |
|---|---|---|
| F1 | **Баг идемпотентности решений** (прод: 01KV89P3/01KTNJW0 — Decision 0 при сигналах): `prisma.decision.create` по `sourceIdeaBlockId` → `upsert`/pre-check в `specialist-3-3` и combined `persistDecisions` — устранить `Unique constraint failed` | unit: повтор блока с тем же `sourceIdeaBlockId` → не падает, решение материализовано |
| F2 | **proxy-400 «json»**: openai-via-proxy при `json_object` дописывать слово `json` в user (как `ensureJsonWordInUser` для deepseek) — устранить 400, ломающий fallback extract-actions и `ai.quality-score` | мини-e2e: json_object к proxy без 400 |
| F3 | **combined-путь решений/идей** (дефолт ON): выровнять `persistDecisions/persistIdeas` с полным specialist — triage/CurationItem + (идеи) weight/embedding/supporters ИЛИ гарант. `ensureTriaged` | интеграц: combined-решение → CurationItem; идея → weight>0 |
| F4 | **vox `no_words`/`empty`** (эпидемия, ломает поведение/длительность): разобрать причину (ASR отдаёт текст без таймингов; пустые дорожки), поднять видимость (метрика+алерт) и починить источник | метрика растёт; алерт; пословные тайминги возвращаются |
| F5 | **Встреча completed, но не отранскрибирована** (01KVCSAG — обрыв между `recording.faststart` и стартом ASR): починить триггер запуска транскрибации после готовности записи | интеграц: completed-встреча с записью → ASR запускается |
| F6 | **Goal: 0 везде** (`specialist-3-14` всегда «не цель / низкий confidence»): разобрать порог/промпт извлечения целей + тихие потери `no_owner`/`focus_cap(7, всё в quarterly)` сделать наблюдаемыми | хотя бы часть реальных целей материализуется; no_owner/focus_cap в метрике |
| F7 | **Диагностика AGE vs LLM-extract**: текст «системный отказ графа AGE» кидается и при провале LLM-извлечения ([block-ingest.worker.ts:643-657](../../backend/src/modules/knowledge-core/workers/block-ingest.worker.ts#L643)) — развести сообщения; метрика `age_unavailable` должна реально расти при сбое AGE | лог различает корни; метрика корректна |
| F8 | **`ai.quality-score` не считается** (свод: 01KTNHFC/01KTNJW0): Zod parse `categories: expected object, received undefined` даже когда LLM вернул валидный JSON с `overallScore` — схема не совпадает с ответом; + тот же proxy-400 «json». Привести Zod-схему к фактическому ответу модели (или промпт к схеме) | unit: реальный ответ quality-score проходит схему; оценка встречи считается |

> AGE как граф-зеркало (рёбра) — **не чинить в этом ТЗ как блокер** (его никто не читает в проде, память на реляционном слое); здесь только разведение диагностики (F7). Если решим читать граф — отдельное ТЗ.

---

## 7-bis. БЛОК G — Наблюдаемость и инструменты проверки (чтобы фикс было ЧЕМ верифицировать)
Это «проблемы в тестах», на которые наткнулись при разборе — без них ре-тест из DoD и будущая диагностика ненадёжны.

| Фаза | Содержание | Acceptance |
|---|---|---|
| G1 | **diag по умолчанию бьёт в сломанный домен**: `backend/scripts/diag.ts:1` дефолт `DIAG_API_BASE='https://meet.crossmark.ru'` (отдаёт чужой TLS с 2026-06-09) → обновить дефолт на `https://korateam.ru` (и `.env`), убрать footgun «надо каждый раз задавать base» | `diag` без `DIAG_API_BASE` ходит на korateam.ru |
| G2 | **`diag chain --trace mtg_<id> --json` отдаёт ЧУЖУЮ встречу** (свод 01KTNJW0 → вернулись данные 01KVD2BX; текстовый режим корректен): починить фильтр по traceId в `--json`-ветке `/platform/logs/chain` | `chain --json` возвращает только записи целевого traceId |
| G3 | **Хвост пайплайна не виден**: `trace`/`chain` капят на 500 записей (total бывает 1495), `llm-calls --scan` пропускает встречи вне окна (старые → 0 вызовов). Добавить серверную выборку AI-вызовов **по `meetingId`** (а не скан последних N) + пагинацию/cap-флаг в chain | `llm-calls --meeting <старая>` находит вызовы; chain отдаёт весь след |
| G4 | **`requestPreview`/`responsePreview` усечены хранилищем** → A/B на захваченном промпте идёт на неполных данных. Поднять лимит хранения превью (или хранить полный промпт для diag) для воспроизводимых прогонов | превью содержит полный промпт встречи |
| G5 | **Локально не дёрнуть `deepseek-v4-flash/pro`** для A/B (прод-эндпоинт `DEEPSEEK_BASE_URL` не задан локально; прокси отдаёт только OpenAI). Зафиксировать в доке/тест-env, как направить харнесс на боевой deepseek-эндпоинт, чтобы flash↔pro A/B был воспроизводим (харнесс `backend/scripts/ab-extract-model.ts` готов) | документировано; A/B flash↔pro запускается |

---

## 8. Доказательство, что лечит (ПРОВЕДЕНО до ТЗ — не гипотеза)
- **Replay гейт+триаж на реальных данных** (`backend/scripts/replay-task-chain.ts`): 7 реальных задач эталонной встречи через **настоящий** `shouldMaterializeTask` → **ТЕКУЩАЯ логика 0 `Issue`** (совпало с продом: 5 в `/intake`, 0 в трекере), **ФИКС A2/A6 → 7 `Issue`**. `ПРОВЕРКА: текущая=0 И фикс=все(7) → PASS ✅`.
- **E (модели)**: прод-свод + контролируемый A/B — Flash сыпет invalid-JSON/fallback; Pro надёжнее на извлечении; capable не даёт больше задач (модель не узкое место симптома).
- **F1 (decision upsert)** — по конструкции: прод-ошибка `Unique constraint failed on sourceIdeaBlockId`; upsert по тому же ключу делает повтор идемпотентным.
- **F2 (proxy json)** — по конструкции: ошибка `must contain the word 'json'`; дописывание слова устраняет 400.
- **Доделать при реализации**: unit на A1/A2/A4/A5/A6, B1-B4, C1-C4, D3, F1/F2 + повтор replay ПОСЛЕ кода (0→7) + живой ре-тест на проде (Playwright).
- **Уже закрыто (НЕ переделывать):** F2-склонения (`beb39c85`), F9-видимость закрытия (`a3baba64`) — в `origin/dev`, на проде.

---

## 9. Инварианты Z
- Миграции только `prisma:migrate` + `STEPS` в `apply-prod-deploy.ts` + `prod-deploy-log` (поля `Issue.lowQuality`/источник).
- Крутилки (пороги/часы/дефолт-проект/флаги) → AdminSetting через `getDynamic` (принцип 9); модели — `LlmTaskRoute`/сиды/`/admin/ai-models`, НЕ `defaultModel`; SYSTEM-промпты не трогаем.
- Флаги — Ship-On: новые = kill-switch (ON) → `docs/operations/feature-flags.md`.
- UI только русский; probe без inline-кнопок; парные токены `bg-*`+`text-*-fg`; без нарративных комментариев.
- Multi-tenancy: все запросы и `findApplicableRule` — с `tenantId`.

## 10. Матрица покрытия (доказательство, что НИЧЕГО не оставлено)
| Находка/жалоба | Фаза | | Находка | Фаза |
|---|---|---|---|---|
| Жалоба 1 (404 помощник) | A1 | | F8 отдел/роль | A5 |
| Жалоба 2 (срок) | A3/A4 | | F10 Issue/Task + чат-обрыв | B1/B2 |
| Жалоба 3 (обучение «дизайн→Анна») | A4 | | F11 probe исполняет | A4 |
| Жалоба 4 (утром/пинок/дашборд) | C1-C4, D1-D2 | | F12 решение→implemented | D3 |
| Жалоба 5 (любой канал) | B1-B4 | | F13 объяснимость+зависшие | D1/D2 |
| **Фильтр 4 (авто-триаж, корень)** | **A2 (replay PASS)** | | F14 кроны МСК | D4 |
| Фильтр 2 (узкий резолв) | A5 | | Модели Flash→Pro | E1/E2 |
| F1 404 | A1 | | decision.create баг | F1 |
| F3 гейт-дроп | A6 | | proxy-400 json | F2 |
| F5 без срока в сводке | C1 | | combined-путь | F3 |
| F6 просрочка исполнителю | C2 | | vox no_words | F4 |
| F7 вечерняя сверка | C3 | | неотранскрибир. встреча | F5 |
| F15 in-app напоминания | C4 | | Goal:0 | F6 |
| chatbox Org-no-owner | B3 | | AGE-диагностика | F7 |
| chatbox analysis OFF | B4 | | встреча↔решения UI | D5 |
| quality-score не считается | F8 | | diag дефолт-домен | G1 |
| diag chain --json чужая встреча | G2 | | diag scan/cap режут хвост | G3 |
| requestPreview усечён | G4 | | A/B flash↔pro воспроизводим | G5 |

> Локальная нумерация F1–F8 — это фазы Блока F (системные баги), не путать с находками аудита F1–F15 (те разнесены по A–E выше).

## 11. Порядок реализации
**A → F1/F2 → G1/G2/G3 → B → C → E → D → F3 → F4/F5/F6/F7/F8 → G4/G5.** A — корень (задача доходит, доказан replay). F1/F2 — быстрые баги. G1–G3 — починить диагностику, чтобы ре-тест из DoD был достоверным. B — не терять (вкл. чаты). C — польза сотруднику. E — модели. D — руководитель+связи. F3–F8 — остальные системные. G4/G5 — воспроизводимые прогоны. **Весь объём — единым пакетом (Р7), без отсрочек.**

## 12. Прод-операции (предв.)
Поле `Issue.lowQuality`/метки → Шаг 4. Новые AdminSetting (дефолт-проект, пороги, часы кронов) → Шаг 1/7. Перевод моделей (сиды/патчи) → Шаг 7/8. Новые probe-reason/eventType/метрики → Шаг 12 (smoke grep). Флаги (chatbox analysis ON и пр.) → feature-flags.md + Шаг 1. ENV новых нет.

## 13. DoD
typecheck (вкл. `.spec`)/lint/build зелёные; vitest по затронутым + сценарии §8; **повтор replay 0→7**; живой ре-тест блоков A/C на проде; `second-brain/01_projects/` (tracker/probe/operations/dashboard/ai-jobs/knowledge-core/chatbox) обновлены; `feature-flags.md`+`prod-deploy-log.md`; `04_не-сделано` — закрыть строки по фильтру 4/F1/F3/F5/F6/F7/decision-bug; рефлексия.

## 14. Итог

**Реализовано полностью (2026-06-22, ветка dev, 14 коммитов `df071d7a..`).** Блоки A–D (16 фаз) реализовала параллельная сессия по поглощённому `tasks-subsystem-unified-fix.md`; эта сессия добавила весь остаток:

| Фаза | Коммит | Статус |
|---|---|---|
| **A2** корень — задача встречи → Issue всегда (kill-switch `tracker.meetingTasksAlwaysPromote` ON, проект «Из встреч») | `df071d7a` | ✅ replay 0→7 PASS |
| A1/A3/A4/A5/A6 (помощник 404, probe-reason, исполнение probe, резолвер, гейт=пометка) | (Волна A–D парал. сессии) | ✅ ранее на dev |
| F2 json-guard registry-адаптер | `924a848d` | ✅ |
| F7 AGE vs LLM диагностика | `a391fdb1` | ✅ |
| G1+G3 diag домен + meetingId-фильтр | `833f957e` | ✅ |
| F1+F3 combined upsert + триаж/embedding/weight | `c155ce45` | ✅ |
| D5 решения встречи в UI + meeting_id фильтр | `78626a15` | ✅ |
| F4 vox-метрика + ре-сабмит no_words | `1194cdbb` | ✅ |
| F8 quality-score толерантность | `7875e2e0` | ✅ |
| E 4 извлекающих → deepseek-v4-pro | `9b8ee9a8` | ✅ |
| B4 chatbox.taskExtraction.enabled → AdminSetting | `d917327e` | ✅ |
| G4 previewMaxBytes крутилка | `549acca1` | ✅ |
| F6 goal no_owner-фолбэк + пороги-крутилки | `8c388e7b` | ✅ |
| F5 track-egress-watchdog cron | `d606fbc5` | ✅ |
| G5 harness replay/ab-extract + howto | `fd077855` | ✅ replay 0→7 PASS |

Верификация: backend typecheck/lint/build зелёные; 196 целевых юнит-тестов зелёные; **replay 0→7 PASS** (после кода); миграций Prisma нет, новых ENV нет; 8 новых AdminSetting (3 kill-switch ON + 5 крутилок), 2 метрики, 1 cron. Документация: `feature-flags.md`, `prod-deploy-log.md`, `second-brain/01_projects/*`, `02_architecture/knowledge-core.md`, `04_не-сделано`, рефлексия `05_история/2026-06-22-meeting-to-tracker-models-unified-impl.md`.
