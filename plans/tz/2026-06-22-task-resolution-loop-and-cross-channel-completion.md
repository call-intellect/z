# ТЗ: Петля «задача → решение», сквозной авто-захват выполнения со всех каналов + связка фиксов трекера

Статус: **ready-to-implement**
Дата: 2026-06-22
Автор контракта: диагностика на проде korateam.ru (Org «Ооо луа»), живые тесты + код + прод-трейс.

> Это единый контракт. Внутри разбит на фазы Ф1–Ф6 для управляемой приёмки, но **ничего не откладывается «на потом»** — в работу берётся весь объём.

---

## 0. Зачем (проблема владельца, дословно)

1. «Сотрудник ставит задачу другому сотруднику — не работает (HTTP 404)».
2. «Сотрудник поставил задачу и отчитался, что выполнил — должна быть петля задача→решение с подтверждением, но нигде ничего не появилось».
3. «Решение по задаче должно попадать в карточку комментарием — в т.ч. промежуточные данные по пунктам, не только полное закрытие».
4. «Любой входящий канал должен анализироваться: если где-то прозвучало решение/выполнение — оно должно подхватываться автоматически. Это автоматизация, она должна работать со ВСЕХ источников».

---

## 1. Доказательная база (проверено вживую 2026-06-22, не из памяти)

Каждый фикс ниже бьёт в **подтверждённую** точку. Методы: живой кабинет (Playwright под владельцем), прямые API-зонды, прод-трейс через `backend/scripts/diag.ts` (read-only, super-admin).

| # | Факт | Как доказано |
|---|---|---|
| Д1 | 404 при «задача другому» = бизнес-ошибка `assignee_not_found`, **не** отсутствие маршрута | API-зонд `POST /api/v1/me/tasks/assign` на проде вернул `{code:"assignee_not_found"}`, не «Cannot POST» |
| Д2 | Маршрут `assign` и инструмент `assign_task` на проде **есть** (прод собран с `dev`, в `main` их нет) | `git show main:…` — нет; live-зонд — есть |
| Д3 | Корень 404 — **склонение имени**: резолвер матчит буквально | `assigneeName:"Сергею"`→404; `assigneeName:"Сергей"`→успех. В Org есть Person ровно «Сергей». Ростер: `Айназ, Настя, Сергей, Анна Богачева` |
| Д4 | Баг непостоянный: LLM-помощник то склоняет имя, то нет | у Насти подтверждение показало «кому — Сергею» (дательный→404); мой повтор дал «Сергей» (ок) |
| Д5 | Кандидатов на закрытие у Org — **0**; петля не сработала | `GET /api/v1/pending-actions/count` → `task_closure:0, task_review:0, progress_draft:0` |
| Д6 | Авто-захват «выполнено» с разговорного канала **не сработал** | free-note «Выполнил задачу: написать Насте — отправлено» → 0 кандидатов за 8+ мин |
| Д7 | Конвейер при этом отработал **чисто** — сигнал «выполнено» просто не родился | прод-трейс: `block-ingest успех → block-distill успех → block-linker успех`, **0 записей про closure/completion** |
| Д8 | Все каналы идут в **единый хаб** `IngestService.ingest` | код: chatbox/bitrix/conversational/checkin/email/web-form/meeting все зовут `ingest.ingest()` |
| Д9 | Ручной промежуточный апдейт прогресса **работает** | `POST /api/v1/issues/:id/progress-updates` → 201, лёг в карточку |
| Д10 | Авто-черновик прогресса — только крон 07:00, только задачи «в работе», ≥2 сигнала | код `progress-auto-draft.cron.ts` |
| Д11 | Страница подтверждений `/actions` **не выведена в навигацию** | DOM `/dashboard` и сайдбар — ссылок на `/actions` нет |
| Д12 | Кандидаты на закрытие видит **только админ** | код `task-closure.provider.ts` — `isPrivileged` |
| Д13 | При закрытии **комментарий с решением в карточку не пишется** | код `pending-actions.service.ts` `confirmTaskClosure` — только `transitionState` |
| Д14 | В чате помощника просачивается англ. ярлык «assign task (ок)» | live-снимок панели помощника |

### Реестр входящих каналов (опора, проверен по коду)
Все 13 источников (`SourceType` + интеграции) funnel-ятся в один хаб: видеовстречи (`meeting`), аудио/звонки (`phone_call`), загрузка записи, **чат-бокс** (`chatbox`), **Битрикс24**, помощник/Telegram/MAX (`conversational`/free_note), почта (`email`), веб-форма/«дамп» (`web_form`), документы, события трекера (`tracker_event`), ежедневный чек-ин (`daily_checkin`). Интеграции (чат-бокс/Битрикс/почта) требуют подключения в Org, иначе данных нет.

---

## 2. Принятые решения владельца (не переоткрывать)

- **Р1.** Подтверждать закрытие задачи может **и исполнитель** (тот, на ком задача — «Пётр закрыл свою»), **и** владелец/админ. Сейчас — только админ → расширить.
- **Р2.** **Всё в одно ТЗ**, ничего не откладывается; деление на фазы — только для приёмки.
- **Р3.** (наследие) Авто-закрытие задачи без человека запрещено (R13 предыдущих ТЗ): система готовит кандидата, закрывает человек. Сохраняем.

---

## 3. REALITY-CHECK (точные якоря в коде; верни перед правкой — номера строк на 2026-06-22)

- Резолвер (буквальный матч, корень 404): `backend/src/modules/tracker/services/assignee-resolver.service.ts:48-52` (`===` → `startsWith` → `includes`), вызов из `me-tasks.service.ts:100`.
- Инструмент помощника: `backend/src/modules/concierge/services/service-map-generator.service.ts:172-192` (`assign_task` → `POST /api/v1/me/tasks/assign`).
- Маршруты задач: `backend/src/modules/tracker/controllers/me-tasks.controller.ts:45,70,97`.
- Эмиссия сигнала «выполнено»: `backend/src/modules/knowledge-core/services/router.service.ts:400-420` (`done_item|task_completed|task_status_changed` → `task.completion_signalled`).
- Где Router вызывается: **не** в `block-ingest.worker.ts` (он лишь `enqueueBlockDistill`, стр. ~667-674) — Router отрабатывает на шаге **block-distill** (доп. async-хоп).
- Классификация signalType: `backend/src/modules/knowledge-core/services/block-extraction.service.ts` + промпт `prompts/block-ingest.prompt.ts` (таксономия `SIGNAL_TYPE_VALUES`).
- Handler закрытия (KNN ≥ 0.85, LLM-verify, только кандидат): `backend/src/modules/operations/services/task-completion.handler.ts` (порог `taskClosure.matchThreshold` дефолт 0.85, `tracker_event` пропускается).
- Видимость только админу: `backend/src/modules/pending-actions/providers/task-closure.provider.ts` (`isPrivileged`).
- Подтверждение закрытия (нет комментария): `backend/src/modules/pending-actions/services/pending-actions.service.ts` `confirmTaskClosure` (~466-557) — `issuesService.transitionState` без `IssueComment`.
- Авто-черновик прогресса: `backend/src/modules/tracker/workers/progress-auto-draft.cron.ts:55` (`@Cron('0 7 * * *')`), `:102-115` (только `state.category='started'`), `minSignals` дефолт 2.
- Прогресс API (ручной — работает): `backend/src/modules/tracker/controllers/progress-updates.controller.ts` + `services/progress-updates.service.ts`.
- Комментарии задачи: `backend/src/modules/tracker/services/comments.service.ts` + `controllers/comments.controller.ts` (есть `GET/POST /api/v1/issues/:id/comments`).
- Навигация (нет ссылки на /actions): `frontend/app/(authenticated)/actions/ActionsClient.tsx` существует; сайдбар (app-shell) её не содержит.
- Англ. ярлык в помощнике: `frontend` рендер имени инструмента из tool-call (`assign_task`→«assign task»); править на русский лейбл.

---

## 4. Фазы

### Ф1 — Резолвер исполнителя с учётом склонений (лечит 404, Д1–Д4)
**Цель:** «поставь задачу <Имя в любом падеже>» стабильно находит сотрудника.
- В `AssigneeResolverService.resolve` добавить морфологически устойчивое сопоставление: нормализация русских окончаний имени/основы (лемматизация или сравнение по стему), сопоставлять не только с `Person.name`, но и с `User.name`/частями ФИО. Сохранить текущую защиту от неоднозначности (`ambiguous`).
- Не полагаться на то, что LLM приведёт имя в именительный: чинить **в резолвере** (единая точка для всех каналов, включая Telegram-парсер).
- Доп. (необязательно, не вместо резолвера): в описании инструмента `assign_task` попросить именительный падеж.
**Acceptance:** на тест-Org с Person «Сергей»: `assigneeName ∈ {Сергею, Сергея, Сергей, серегой}` → один и тот же резолв; несуществующее имя → понятная ошибка (не сухой 404); два одноимённых → `ambiguous`. Unit-тесты резолвера на падежи.

### Ф2 — Надёжный авто-захват «выполнено/решение» со ВСЕХ каналов (главная задумка, Д5–Д8)
**Проблема (Д7):** блок усваивается, но не получает completion-signalType → петля не стартует; цепочка длинная и хрупкая (ingest → distill → router → handler → KNN≥0.85 → verify), каждый шаг тихо роняет сигнал.
**Цель:** если на любом канале прозвучало «сделал/выполнил/закрыл/готово/отправил» по существующей задаче — гарантированно появляется кандидат на закрытие (или прогресс), видимый человеку.
- **Усилить распознавание completion** в классификаторе усвоения (block-ingest): явные маркеры выполнения надёжно → `task_completed`/`done_item`. Прогнать на корпусе фраз RU.
- **Снизить хрупкость матча:** порог `taskClosure.matchThreshold` сделать настраиваемым и калибровать; при KNN-near-miss — добавить лексический матч по заголовку задачи (а не только вектор).
- **Не терять сигнал молча:** на каждом «тихом return» (нет матча / verify=false) писать диагностический лог + метрику (`task_closure.dropped{reason}`), чтобы было видно, где гаснет.
- **Детерминированный путь у помощника:** добавить concierge-инструмент `complete_task` / `report_task_progress` (закрыть/отчитаться по задаче), чтобы «я выполнил задачу X» через помощника не зависело только от LLM-разметки графа. Закрытие — через подтверждение (Р3).
**Acceptance:** e2e-тест по каждому достижимому каналу (free_note/conversational, chatbox, meeting-транскрипт): «выполнил задачу X» при открытой задаче X → в течение разумного времени появляется `TaskClosureCandidate` ИЛИ прогресс; в метриках виден путь; при отсутствии матча — лог с причиной. Прогон тем же способом, что в диагностике (live + diag-трейс).

### Ф3 — Авто-черновик прогресса по событию, не «раз в сутки» (Д9–Д10)
**Цель:** промежуточные апдейты «по пунктам» Кора подхватывает с любого канала и в реальном времени, не только кроном 07:00 и не только по задачам «в работе».
- Триггерить черновик прогресса событийно (на тот же `task.completion_signalled` / на новые сигналы графа по задаче), а не только кроном.
- Снять ограничение «только `state.category='started'`» — учитывать и backlog/in-progress (промежуточный прогресс возможен до перевода в «в работе»).
- Оставить дедуп и `draftState='pending'` (без авто-публикации) + kill-switch.
**Acceptance:** сигнал «сделал часть X» по открытой задаче (любой канал) → авто-черновик прогресса `pending` появляется без ожидания крона; повторный сигнал не плодит дубль.

### Ф4 — Видимость подтверждений: `/actions` в навигации + закрытие исполнителем (Д11–Д12, Р1)
- Вывести «Подтверждения» (`/actions`) в сайдбар и плашкой «Требует вас: N» на главную (счётчик уже есть).
- Кандидаты на закрытие/прогресс показывать **и исполнителю** задачи (не только админу): расширить `TaskClosurePendingProvider`/`PendingActions` так, чтобы исполнитель видел и мог подтвердить свои.
- Сохранить RBAC: чужие задачи исполнитель не видит.
**Acceptance:** обычный участник видит «Подтверждения» в меню; видит и подтверждает кандидата по своей задаче; админ видит все; счётчик/бейдж совпадает.

### Ф5 — Решение → комментарий в карточке (Д13)
**Цель:** при закрытии/отчёте текст решения попадает в карточку как комментарий (видно «что и как сделано»), включая промежуточные данные.
- При подтверждении закрытия (`confirmTaskClosure`) и при принятии прогресса — создавать `IssueComment` с текстом решения/доказательной цитатой (`evidenceQuote`) и пометкой источника (канал/«из разговора»).
- Идемпотентность: повторное подтверждение не плодит дубль-комментарий.
**Acceptance:** закрыл задачу по «выполнено из канала» → в карточке появился комментарий с решением и ссылкой на источник; промежуточный прогресс тоже отражается в ленте карточки.

### Ф6 — Мелочь: убрать англ. «assign task (ок)» (Д14)
- В чате помощника заменить технический tool-name на русский лейбл (как в `CONFIRM_TOOL_RU_NAMES`).
**Acceptance:** в панели помощника нет английских слов; для `assign_task` показывается «поставить задачу сотруднику».

---

## 5. Инварианты Z (соблюдать)
- Миграции только `bun run prisma:migrate -- --name …`; новые seed/patch/backfill/migrate → массив `STEPS` в `apply-prod-deploy.ts` + строка в `docs/operations/prod-deploy-log.md`; скрипты — `createPrismaClient()`, импорты `../src`.
- Крутилки (пороги матча, окна, кадэнс прогресса) → **AdminSetting** через `getDynamic` + registry + сид + UI-поле, не ENV/не магические константы.
- Флаги — Ship-On: новый функционал выкатывается включённым; допустимы только kill-switch (ON) либо решение владельца с параметром.
- LLM: primary DeepSeek/OpenAI-proxy, embeddings `text-embedding-3-small`; **раздел «Совместимость с prompt caching»** для любых правок промпта (стабильный SYSTEM, переменные данные в конце user — не ломать кэш классификатора усвоения).
- UI только русский; парные токены `bg-*`+`text-*-fg`; без нарративных комментариев в TS.
- Multi-tenancy: все запросы с `tenantId`/`TenantGuard`.

## 6. Прод-операции (предв.)
- Новые AdminSetting (порог матча/кадэнс прогресса) → Шаг 1/7.
- Возможная миграция (поле источника комментария-решения) → Шаг 4.
- Новые метрики `task_closure.dropped{reason}`, новый concierge-инструмент → Шаг 12 (smoke).
- Изменён промпт block-ingest (Ф2) → сверка с `docs/methodology/prompts/`.

## 7. Итог
**Реализовано целиком (2026-06-22).** Все фазы Ф1–Ф6 закрыты, ничего не отложено.
- Ф1 (резолвер склонений) — `beb39c85`.
- Ф2a (промпт block-ingest) / Ф2b (handler+метрики+lexical+эмит+крутилки) / Ф3 (событийный авто-черновик) / Ф5 (решение→комментарий) — `a3baba64`.
- Ф2c (детерминированный путь помощника: complete/progress) — `bd7e126c`.
- Ф4 (видимость исполнителю + `/actions` в навигации) — `f1dcaada`.
- Ф6 (англ. «assign task (ок)») — `ea06f766` (Волна 0).
Верификация: backend typecheck+build зелёные, frontend typecheck зелёный, тесты затронутых модулей зелёные. Ветка `feature/2026-06-22-task-loop-and-qa-fixes`, не прод.

---

## 8. Решения оркестратора (2026-06-22, верифицировано картографией кода)

Картография 12 агентов подтвердила/уточнила якоря §3. Корректировки и принятые мной решения по развилкам (владельца не беспокою — полные права):

**Дрейф якорей (исправлено):**
- Промпт block-ingest лежит в `backend/src/modules/knowledge-core/prompts/block-ingest.prompt.ts` (НЕ `services/prompts/`).
- Router эмитит событие **через `EventEmitter2`** (`@Optional` inproc-шина, не BullMQ) на canonical-переходе блока в block-distill (3 точки: markCanonical/merged/swap). Payload: `{tenantId, blockId, signalType, sourceType}` — **issueId в событии НЕТ**.
- Крутилки `taskClosure.{enabled,matchThreshold,embedTimeoutMs}` **читаются, но НЕ зарегистрированы** в `admin-setting-schema-registry.ts` (нарушение принципа 9) — закрываю в Ф2.
- `TaskClosureCandidate` имеет только скалярный `issueId` (**нет** `issue Issue @relation`, у `Issue` нет обратной связи) → видимость исполнителю в Ф4 делаю **двухшаговым резолвом** issueId через `IssueAssignee.findMany` (без миграции/FK-риска), по образцу `progress-draft.provider.ts`.
- `IssueComment` полей «источник» нет (есть `authorType`/`content`/`contentStripped`) → метку источника в Ф5 пишу **в текст комментария** («✅ Решение (из разговора): …»), **миграция не нужна**.

**Р-Ф1 (морфология имён).** Выбор: **dependency-free гибрид**, не новый npm-пакет. Обоснование: в `backend` нет ни одной морфо-библиотеки; пакеты склонения (petrovich/lvovich) делают ПРЯМОЕ склонение (имен.→косвенные), а нам нужно обратное сопоставление — пришлось бы генерить все падежи каждого имени ростера; плюс риск заброшенности/CVE (прецедент отказа от xlsx). Реализация в `assignee-resolver.service.ts`: (1) обогатить `normalizeName` (ё→е, срез кавычек как в `entity-resolution`); (2) собрать ключи кандидата из токенов `Person.name` **и** `User.name`; (3) новая ступень каскада МЕЖДУ exact и startsWith — **«склонение»**: токен совпадает, если `exact` ИЛИ (общий префикс-основа ≥ `min(len)-2` И `levenshtein ≤ порог`) — это ловит «Сергею/Сергея/серёгой», но отвергает разные имена с другим началом («Анна»/«Инна»); Левенштейн переиспользовать из проекта (есть в `prompt-feedback-collector.service.ts`, вынести в `common/`). Порог рёбер — **крутилка** `tracker.assigneeMatchMaxEdits` (code-fallback 2) в registry+сид+UI (группа tracker). Exact остаётся приоритетнее (тест «точное ≻ частичное» не ломается). Доп. метрика `task_assignee_resolve_total{via}`.

**Р-Ф2 (надёжный захват completion) — делю на 3 части:**
- **Ф2a (промпт):** в `block-ingest.prompt.ts` добавить явные правила+RU-примеры для `done_item`/`task_completed`/`task_status_changed` (сейчас они только enum-значения без объяснений → модель путает с fact/result). Cache-friendly: правка SYSTEM = разовый сброс кэша классификатора, переменные данные остаются в конце user; раздел «Совместимость с prompt caching» — в отчёте фазы.
- **Ф2b (handler):** зарегистрировать `taskClosure.{enabled,matchThreshold,embedTimeoutMs,candidateTtlDays}` в registry+сид+UI; добавить counter `task_closure_outcome_total{outcome=created|no_match|not_done|embed_fail|disabled|skipped_tracker}` (через `BusinessMetricsService`, `@Optional`); добавить **лексический fallback** (title-contains / pg_trgm среди ОТКРЫТЫХ задач) при KNN-near-miss; диагностические `debug`-логи с причиной на каждом тихом return.
- **Ф2c (детерминированный путь помощника):** новые REST `POST /api/v1/me/tasks/complete {taskName, note?}` и `POST /api/v1/me/tasks/progress {taskName, progress}` + резолвер задачи по имени (среди открытых задач пользователя, contains+ambiguous, по образцу assignee-resolver); `complete` → **детерминированно создаёт `TaskClosureCandidate(pending)`** с sentinel `sourceBlockId='concierge-complete:<userId>'` (идемпотентно по @@unique), закрытие — человеком в `/actions` (Р3 сохранён); `progress` → `progress-updates.service.create` (human). Инструменты в `service-map-generator` + `CONFIRM_TOOL_RU_NAMES`/`PARAM_RU_LABELS` (`concierge.service.ts`) + фронт `TOOL_NAME_LABEL`.

**Р-Ф3 (событийный прогресс).** Ядро `processIssue` крона **вынести в `ProgressAutoDraftService`** (tracker.module, exported), и крон, и новый слушатель зовут его (не дублировать). Слушатель `@OnEvent('task.progress_signalled')`; событие эмитит **TaskCompletionHandler** с готовым `{tenantId, issueId, sourceBlockId}` сразу после того как KNN нашёл открытую задачу (best && sim≥порог) — и для done, и для частичного (issueId уже известен, повторный KNN не нужен). Снять фильтр `state.category='started'`. Дедуп для событийного пути — **per-block ключ** `progress_auto_draft:${issueId}:${sourceBlockId}` (а не суточный), + сохранить гейт `hasPendingDraft`. Переиспользовать существующий kill-switch `tracker.progressAutoDraftEnabled` (новый флаг не плодить).

**Р-Ф4 (видимость).** В `task-closure.provider.ts` убрать ранние `return` (стр.62/69), в `buildWhere` для непривилегированных — `where.issueId = { in: <issueIds исполнителя> }` (двухшаговый резолв через `IssueAssignee.findMany({where:{userId}})`); owner/admin — без фильтра. Фронт: добавить `/actions` в `DESKTOP_NAV` (label «Требует вас», icon `AlertTriangle`), убрать дубль-хардкод в `getDesktopNavRefs:463`, поправить `nav-subset.spec` при необходимости; плитка «Требует вас: N» на главной (счётчик уже есть).

**Р-Ф5 (комментарий-решение).** Новое поле `comment` в `ConfirmPendingActionBody`+`ConfirmInput` (не переиспользовать `answerText`). В `confirmTaskClosure` approve-ветке обернуть `transitionState`+`IssueComment.create`+`update кандидата` в **один `$transaction`** (атомарность+идемпотентность, гейт `status==='pending'`). Текст = `comment` или fallback на `evidenceQuote`/`rationale` с пометкой источника. Аналогично при приёме прогресса. authorType `'human'`. Reject-ветка — без комментария.

**Р-Ф6 (лейбл).** Дописать ВСЕ недостающие ключи в `frontend/src/domain/concierge.ts` `TOOL_NAME_LABEL` (фикс класса, ~9+ имён), не только `assign_task`.
