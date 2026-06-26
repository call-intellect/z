# Анализ: виджет «Задачи встречи» (404) + петля concierge (лимит шагов)

**Статус:** аналитический разбор для ТЗ (не само ТЗ). Вход для агента, который сводит общее исправление.
**Дата:** 2026-06-25
**Повод:** в кабинете `svmazur@mail.ru` (орг «Ооо луа») после вчерашней встречи (24.06) пользователь видит «пусто»: (1) блок «Задачи» в карточке встречи показывает «0 / Задач не найдено»; (2) «Помощник компании» (concierge/«Мастер») на вопрос «какие встречи были 24 июня» отвечает «данные за этот день нигде не зафиксированы».
**Как исследовано:** прод-QA через Playshright под тестовым аккаунтом (read-only + прямые `fetch` из залогиненной сессии) + чтение кода (`backend/src/modules/{tasks,meetings,concierge}`, `frontend/src`).

---

## TL;DR

Оба симптома — **витринные баги, данные целы**:

- **Цепочка обработки встречи 24.06 отработала полностью.** Запись → AI-отчёт → ingest в граф знаний → задачи в трекере — всё на месте (доказательства ниже).
- **Баг 1 (виджет):** роут `GET /api/v1/meetings/:id/tasks` авторизует доступ **строгой проверкой владельца** (`meeting.ownerId === userId`), а не моделью видимости встреч. Любой, кто видит встречу, но не является её `ownerId` (хост/участник/тиммейт по орг-видимости), получает `404 meeting_not_found`. Чинится сменой авторизации на `MeetingVisibilityService.assertCanView` (как у рабочего `/result`).
- **Баг 2 (concierge):** ReAct-петля не завершается после первого успешного `ask_chat_v2` — отдаёт управление модели, та снова зовёт инструмент, и так до `concierge.max_steps=6`; затем `buildPartialAnswer` вываливает «Не успел собрать полный ответ…» / ложное «не нашёл». Лимит шагов — аварийный стоп петли, **не причина**. Решение уже принято владельцем в [2026-06-25-telegram-concierge-classifier-arch.md](2026-06-25-telegram-concierge-classifier-arch.md) §9 (убрать петлю, single-pass).

---

## Доказательства, что данные целы (прод, встреча `01KVW4TQQ9CK3NT4NPTBHZKM9E`, 24.06)

- **AI-отчёт готов** — темы/решения/ответственные/3 задачи в тексте (карточка встречи открывается, `GET /meetings/:id/result` → 200).
- **Граф знаний наполнен** — гибридный поиск по «Память» по фразе «отправка ссылки на подключение в Телеграм» вернул **40 результатов за 793 мс**, топ — «Суть встречи» с `источник: meeting report`, уверенность 90%.
- **Задачи в трекере** — 3 issue с `externalSource:"meeting"` и `linkedMeetingIds:["01KVW4TQQ9CK3NT4NPTBHZKM9E"]` (проверено прямым `GET /api/v1/issues/:id` из сессии):
  - `DEVE-11` «Сделать так, чтобы в Telegram всегда приходила ссылка на подключение»
  - `MTG-17` «Изучить обновление сервиса»
  - `DEVE-12` «Изучить скрипт»
- **Контекст доступа:** орг «Ооо луа» `cmpndk2tw000101mwmixvacuj`, `ownerId` орга и встречи — `cmpndk2so000001mwb2v91d2o` (хост chydo_002, бейдж «CM»). `svmazur` — **не** владелец встречи. Отсюда расхождение `/result` (200) vs `/tasks` (404).

---

## Баг 1 — `GET /api/v1/meetings/:id/tasks` → 404

### Цепочка вызова
- Виджет карточки встречи → хук [use-meeting-tasks.ts](../../frontend/src/hooks/use-meeting-tasks.ts) → [tasks.api.ts:79](../../frontend/src/api/tasks.api.ts#L79) `listForMeeting` → `GET /api/v1/meetings/:id/tasks`.
- Роут обслуживает **deprecated** контроллер [tasks.controller.ts:64](../../backend/src/modules/tasks/tasks.controller.ts#L64) (`@ApiTags('legacy / tasks (deprecated)')`, `@Controller('api/v1')`, `CookieAuthGuard`) → `TasksService.listByMeeting`.

### Корень (точно)
[tasks.service.ts:61](../../backend/src/modules/tasks/tasks.service.ts#L61) `listByMeeting` зовёт `assertMeetingOwner`, который кидает **`NotFoundException('meeting_not_found')` если `meeting.ownerId !== userId`** ([tasks.service.ts:188-190](../../backend/src/modules/tasks/tasks.service.ts#L188)). Воспроизведено прямым запросом:
```
GET /api/v1/meetings/01KVW4TQQ9CK3NT4NPTBHZKM9E/tasks
→ 404 {"ok":false,"error":{"code":"not_found","message":"meeting_not_found"}}
```
Почему `/result` работает, а `/tasks` нет: `MeetingsService.getResult` авторизует через [meetings.service.ts:854](../../backend/src/modules/meetings/meetings.service.ts#L854) `this.visibility.assertCanView(...)` — флаг-aware модель видимости (орг/участник/grants). А `/tasks` использует строгий owner-чек, **несовместимый** с этой моделью. Любой не-владелец, который легитимно видит встречу, получает 404.

### Почему данных не было бы даже без 404
Сама `TasksService.listByMeeting` уже умеет ходить в трекер (флаг `knowledge.meetingTasksToTrackerOnly`, [meeting-action-items.service.ts:7](../../backend/src/modules/meetings/meeting-action-items.service.ts#L7)). При `trackerOnly=true` → `MeetingActionItemsService.listIssuesForMeeting` ([meeting-action-items.service.ts:137](../../backend/src/modules/meetings/meeting-action-items.service.ts#L137)) фильтрует `Issue` по `linkedMeetingIds: { has: meetingId }`. Линковка подтверждена (см. доказательства) → после фикса авторизации виджет получит ровно 3 задачи.

### Рекомендованный фикс (спека)
1. В `TasksService` заинжектить `MeetingVisibilityService`. Wiring менять **не нужно** — `MeetingsModule` помечен `@Global()` и экспортирует и `MeetingVisibilityService`, и `MeetingActionItemsService` ([meetings.module.ts](../../backend/src/modules/meetings/meetings.module.ts)); `TasksService` уже инжектит второй без явного импорта модуля.
2. В `listByMeeting` заменить `assertMeetingOwner` → `assertCanView` (возвращает `Meeting` с `tenantId`).
3. В трекер-ветке **убрать фильтр по `userId`** в `listForMeeting`, чтобы виджет показывал **все** задачи встречи (как в отчёте: 3), а не только свои. Отчёт и так раскрывает все задачи любому, кто видит встречу, — новой утечки нет.
4. `create` (ручное создание задачи) оставить owner-only (`assertMeetingOwner` сохранить для него) — запись не расширять.

### Связанные эндпоинты (не путать)
- [meetings.public.controller.ts:89](../../backend/src/modules/public-api/meetings.public.controller.ts#L89) `GET meetings/:id/tasks` — **public-api** (API-токен, `@RequireScope('read')`, `assertOwned`), уже ходит через `MeetingActionItemsService`. Это не сессионный путь, который зовёт фронт.
- [meetings-admin.controller.ts](../../backend/src/modules/admin/meetings-admin.controller.ts) — admin-разбор встречи, тоже через `MeetingActionItemsService`.
- Замена на фронте по описанию deprecated-роута: `GET /api/v1/issues?linkedMeetingId=:meetingId` (но фактический query-параметр у трекер-листинга другой — `?linkedMeetingId=` отдаёт 400; если решать на стороне фронта/issues-листинга, уточнить контракт).

### Что уже сделано в рабочем дереве (не закоммичено)
Я внёс правку 1–4 выше + тесты. Файлы: `backend/src/modules/tasks/tasks.service.ts`, `backend/src/modules/tasks/tasks.service.spec.ts`. Агент, который сводит ТЗ, может **взять как есть** или **перекрыть своей реализацией** (тогда мои правки откатить `git checkout -- backend/src/modules/tasks/`).
Верификация: `vitest tasks.service.spec` 15/15 (3 новых теста); `tsc` — в `src/modules/tasks/` ноль ошибок (прочее «красное» — устаревший локальный Prisma-клиент, не связано); eslint изменённых файлов — чисто.

---

## Баг 2 — concierge ReAct-петля (лимит шагов)

### Симптом (воспроизведён в UI)
Вопрос «Помощнику компании»: «какие встречи были вчера, 24 июня». Прогресс: **5 раз** «Спрашиваю память компании: успех», затем финал начинается с «**Не успел собрать полный ответ за отведённые шаги — вот что нашёл: {…}**» и текст «в памяти компании я не нашла информации о встречах за 24 июня — данные за этот день нигде не зафиксированы». При том, что память эти данные содержит (см. доказательства). То есть память отвечала, а **обёртка-агент не отдала ответ**.

### Механизм по коду ([concierge.service.ts](../../backend/src/modules/concierge/services/concierge.service.ts))
- Петля [concierge.service.ts:265](../../backend/src/modules/concierge/services/concierge.service.ts#L265) `for (let i = 0; i < maxSteps; i++)`. Выход из петли — **только** если модель сама вернула финал ([:300-304](../../backend/src/modules/concierge/services/concierge.service.ts#L300)) или сработал loop-guard ([:318](../../backend/src/modules/concierge/services/concierge.service.ts#L318)).
- Успешный `ask_chat_v2` ловится на [:393](../../backend/src/modules/concierge/services/concierge.service.ts#L393) (`toolName === 'ask_chat_v2' && execResult.ok`), результат кладётся в `toolMessages`, **но петля НЕ завершается** — управление возвращается модели на следующий круг. Модель, не понимая, что готовый ответ уже есть, снова выбирает `ask_chat_v2` → цикл до `maxSteps`.
- `passthrough` (отдать чистый текст ответа) включается **только если за весь ход был ровно один инструмент** ([:463-464](../../backend/src/modules/concierge/services/concierge.service.ts#L463)). После 5–6 вызовов условие ложно.
- Фоллбэк [:470-471](../../backend/src/modules/concierge/services/concierge.service.ts#L470) → `buildPartialAnswer` ([:573-585](../../backend/src/modules/concierge/services/concierge.service.ts#L573)) → префикс «Не успел собрать полный ответ за отведённые шаги — вот что нашёл: …» (+ обрезанный сырой результат).
- `maxSteps` — AdminSetting `concierge.max_steps` (дефолт `DEFAULT_MAX_STEPS`, [:535](../../backend/src/modules/concierge/services/concierge.service.ts#L535)); loop-guard — `rag.loop_guard_threshold` ([:546](../../backend/src/modules/concierge/services/concierge.service.ts#L546)).

**Вывод (ответ на вопрос владельца «зачем лимит шагов?»):** лимит — аварийный стоп бесконечной петли, а не «поисковый бюджет». «Нашёл сразу, но продолжает искать» — потому что петля по дизайну отдаёт ход модели после каждого успешного ответа и не считает успешный `ask_chat_v2` терминальным.

### Вторичный фактор (гипотеза, стоит проверить отдельно)
Карточки памяти не несут **календарную дату встречи** как фильтруемое поле (в выдаче — офсеты `[00:00]`, источник `meeting report`, без даты). Вопрос «за 24 июня» агент не может подтвердить датой → крутит уточняющие запросы и выжигает шаги. Даже после фикса петли запрос «по дате» может оставаться слабым местом, если дату не прокинуть в метаданные карточек / не дать инструмент «встречи за дату».

### Связь с уже принятым решением
Это ровно баг из [2026-06-25-telegram-concierge-classifier-arch.md](2026-06-25-telegram-concierge-classifier-arch.md) §0; там же **§9 — решение владельца: убрать ReAct-петлю** (single-pass: вопрос → chat-v2 один раз → отдать текст напрямую), §10 — целевая архитектура «единого коммуникатора», §11 — «сейчас НЕ кодим, сначала ТЗ».

### Варианты для ТЗ
- **Интерим-заплатка (малая, в духе §9):** завершать петлю сразу после первого успешного `ask_chat_v2` и отдавать его текст через `passthrough` (снять условие «ровно один инструмент» для этого случая). Точки правки: [:393](../../backend/src/modules/concierge/services/concierge.service.ts#L393) (break после захвата) + [:463-471](../../backend/src/modules/concierge/services/concierge.service.ts#L463) (passthrough/partial). Останавливает «врёт что не нашёл / сырой JSON» немедленно, без большого рефактора.
- **Полное решение (§9–§10):** убрать `for i<maxSteps`, loop-guard, `buildPartialAnswer`, `passthrough`, инструмент `ask_chat_v2`-обёртку, мёртвый `clarifyMinConfidence`; вопрос маршрутизировать в chat-v2 напрямую (`chat_query` уже существует). Это отдельное ТЗ.

---

## Открытые вопросы / следующие шаги
- [x] Баг 1: разрешено унификацией Task→Issue. Модуль `tasks/` и правка `ac7ca44e` снесены (Ф7a/Ф7b/Ф8); виджет переехал на tracker `GET /issues?linkedMeetingId`. Фикс переписан на новый путь — гейт `assertCanView` + байпас strict-scope в `findAllAcrossProjects` (коммит `f03ce25b`, ТЗ [2026-06-25-meeting-tasks-widget-404-fix.md](../tz/2026-06-25-meeting-tasks-widget-404-fix.md)). Вариант A сохранён.
- [x] Баг 1: «три точки контракта задач встречи» схлопнуты унификацией — deprecated `TasksController` удалён, источник один (tracker `Issue.linkedMeetingIds`).
- [ ] Баг 2: интерим-заплатка сейчас vs ждать single-pass ТЗ (решение владельца — в работе).
- [ ] Баг 2 (вторичное): прокинуть дату встречи в метаданные карточек памяти / дать инструмент «встречи за период», иначе запросы «по дате» останутся слабыми и после фикса петли.
- [ ] Проверить значение флага `knowledge.meetingTasksToTrackerOnly` в проде (по данным — фактически ON: задачи лежат как `Issue`).
