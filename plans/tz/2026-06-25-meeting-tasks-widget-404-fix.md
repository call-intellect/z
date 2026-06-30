# ТЗ: виджет «Задачи встречи» пуст для не-руководителей (видимость трекера строже видимости встречи)

**Дата:** 2026-06-25 · **Обновлено:** 2026-06-26 (переписано под унификацию Task→Issue)
**Тип:** багфикс (авторизация чтения задач встречи)
**Статус:** реализуется на ветке `feature/drop-legacy-task-unify-issue`.
**Связанный разбор:** [plans/analysis/2026-06-25-meeting-tasks-widget-404-and-concierge-loop.md](../analysis/2026-06-25-meeting-tasks-widget-404-and-concierge-loop.md) (раздел «Баг 1»). Concierge — отдельная тема, сюда НЕ входит.

---

## 0. ⚠️ Контекст: путь виджета сменился (почему ТЗ переписано)
Исходная версия ТЗ описывала фикс legacy-эндпоинта `GET /api/v1/meetings/:id/tasks` в `TasksService.listByMeeting` (коммит `ac7ca44e`: `assertMeetingOwner` → `assertCanView`). **Этот фикс и весь модуль больше не существуют:**
- **Ф7a** (`e0dc1257`) — удалён весь backend-модуль `tasks/` (вместе с `tasks.service.ts`, где жил фикс `ac7ca44e`).
- **Ф7b** (`95f3b963`) — вкладка задач встречи переведена с legacy `tasksApi` на **tracker Issue**: фронт читает `GET /api/v1/issues?linkedMeetingId=<id>`.
- **Ф8** (`ec41a025`) — снесена сама модель `Task`.

Итог: фикс `ac7ca44e` физически удалён вместе с файлом, а виджет ходит на другой эндпоинт. **Премиса «доп. правок кода не нужно» неверна для этой ветки** — баг воспроизводится на новом пути другим механизмом (см. §2).

## 1. Проблема
В карточке встречи блок «Задачи» показывает «0 / Задач не найдено» для части пользователей, хотя задачи встречи реально существуют (`Issue` с `linkedMeetingIds:[meetingId]`). Прод-репро: встреча `01KVW4TQQ9CK3NT4NPTBHZKM9E` (орг «Ооо луа»), владелец-хост `chydo_002`, смотрит другой участник `svmazur` — виджет пуст, хотя 3 задачи (DEVE-11/MTG-17/DEVE-12) слинкованы.

## 2. Корень (на новом пути)
Цепочка: фронт [use-meeting-issues.ts](../../frontend/src/hooks/tracker/use-meeting-issues.ts) → `issuesApi.listOrg(orgId, { linkedMeetingId })` → [org-issues.controller.ts](../../backend/src/modules/tracker/controllers/org-issues.controller.ts) `GET /api/v1/issues` → [IssuesService.findAllAcrossProjects](../../backend/src/modules/tracker/services/issues.service.ts#L519).

`findAllAcrossProjects` применяет фильтр `linkedMeetingId` ([issues.service.ts:529](../../backend/src/modules/tracker/services/issues.service.ts#L529)), но **поверх** накладывает видимость рабочего стола «Задачи» (Р3/Р4, [issues.service.ts:543-560](../../backend/src/modules/tracker/services/issues.service.ts#L543)):
- руководитель (`owner/admin/coo`/superadmin) ИЛИ `visibilityMode=open` → видит все;
- **`manager`/обычный участник + `strict` → форс self-scope** (`assignee=self ИЛИ создатель`).

Значит участник встречи с ролью не-руководитель в strict-орге, который **видит встречу**, но не назначен и не автор её задач, получает **пустой** виджет. Это та же симптоматика, что давал прежний 404 строгого owner-чека, только теперь через фильтр выборки. Страница `/result` показывает те же задачи всем, кто видит встречу, потому что авторизует через `MeetingVisibilityService.assertCanView` — флаг-aware модель видимости встреч (орг/участник/grants).

**Итог:** виджет авторизует доступ к задачам встречи через видимость **трекера**, которая строже модели видимости **встреч** во всём остальном кабинете.

## 3. Решение
Реализовать §4 (вариант A) на новом пути: задачи встречи показывать любому, кто **видит встречу**, минуя строгий self-scope трекера — но строго под гейтом видимости встречи.

В [org-issues.controller.ts](../../backend/src/modules/tracker/controllers/org-issues.controller.ts):
1. Заинжектить `MeetingVisibilityService` (wiring не нужен — `MeetingsModule` `@Global`, экспортирует его; `TrackerModule` уже использует meeting-сервисы).
2. В `list`: если задан `query.linkedMeetingId` → `await meetingVisibility.assertCanView(linkedMeetingId, user.id)`. Бросит `MeetingNotFoundError` (404) / `NotAuthorizedError` (403) — точно как `/result`, без новой утечки. Запомнить `meetingAuthorized = true`.
3. Передать `meetingAuthorized` в `findAllAcrossProjects`.

В [issues.service.ts](../../backend/src/modules/tracker/services/issues.service.ts) `findAllAcrossProjects`:
4. Расширить `ctx` опциональным `meetingAuthorized?: boolean`.
5. `seesAll = ctx.isLeadership || ctx.visibility === 'open' || (!!query.linkedMeetingId && ctx.meetingAuthorized === true)` — при авторизованном meeting-scope строгий self-scope `AND` не накладывается (вариант A: все задачи встречи).

**Изоляция:** общий рабочий стол «Задачи» НИКОГДА не шлёт `linkedMeetingId` → его видимость не меняется. Гейт срабатывает только на запрос виджета встречи. Создание/закрытие задачи виджетом (`issue:create`/transition) — отдельные права, под эту правку не попадают.

**Фронт правок не требует** — хук уже шлёт `linkedMeetingId`; после бэкенд-фикса strict-зритель получает все задачи встречи.

## 4. РЕШЕНИЕ ВЛАДЕЛЬЦА — чьи задачи показывать → **РЕШЕНО (2026-06-25): A**
Владелец выбрал **A**: показывать **все** задачи встречи любому, кто видит встречу. Обоснование: AI-отчёт встречи и так перечисляет все эти задачи всем, кто видит встречу, — структурный виджет совпадает с отчётом, новой утечки нет. Решение действует и на новом tracker-пути (см. §3). Отклонён вариант B (только свои задачи: оставить self-scope) — не выбран.

## 5. Верификация
- `vitest src/modules/tracker/services/issues.cross-projects.service.spec.ts` — добавить: (а) `linkedMeetingId + manager+strict + meetingAuthorized=true` → нет self-scope `AND` (все задачи); (б) `linkedMeetingId + manager+strict + meetingAuthorized=false/undefined` → self-scope сохраняется (без авторизации байпаса нет).
- Новый `org-issues.controller.spec.ts`: (а) `linkedMeetingId` задан → `assertCanView` вызван, при отказе ошибка пробрасывается; (б) `linkedMeetingId` не задан → `assertCanView` НЕ вызван; (в) `meetingAuthorized` доходит до сервиса.
- `tsc` (вкл. `.spec`) по `src/modules/tracker/` — ноль ошибок; `eslint` изменённых — чисто; `build`.
- Прогон тестов модуля `tracker` целиком (кросс-фазные регрессии).

## 6. Деплой
Только код backend, без миграций/seed/ENV/очередей/флагов — **prod-операций нет**. Чтобы strict-зрители увидели задачи — деплой backend после merge.

## 7. Фазы
- [x] Найти корень на новом пути (видимость трекера строже видимости встречи).
- [x] Подтвердить, что `MeetingVisibilityService` инъецируем в `TrackerModule` (`@Global` + exports).
- [x] Backend-фикс: `assertCanView`-гейт в `OrgIssuesController` + `meetingAuthorized`-байпас в `findAllAcrossProjects` + тесты (сервис-спека + новая контроллер-спека).
- [x] Приёмка: typecheck (0 ошибок) / lint (0) + тесты модуля tracker зелёные (54 файла / 514 тестов) + ревью auth-диффа.
- [ ] Merge в dev + деплой backend.
- [ ] Принять глазами: strict-участник открывает встречу, виджет показывает все её задачи.
