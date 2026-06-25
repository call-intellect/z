# ТЗ: виджет «Задачи встречи» отдаёт 404 (meeting_not_found)

**Дата:** 2026-06-25
**Тип:** багфикс (1 метод + авторизация)
**Статус:** реализовано на ветке `fix/meeting-tasks-widget-visibility` (origin), ждёт подтверждения решения §4 + merge/деплой.
**Связанный разбор:** [plans/analysis/2026-06-25-meeting-tasks-widget-404-and-concierge-loop.md](../analysis/2026-06-25-meeting-tasks-widget-404-and-concierge-loop.md) (раздел «Баг 1»). Concierge — отдельная тема, сюда НЕ входит.

---

## 1. Проблема
В карточке встречи блок «Задачи» всегда показывает «0 / Задач не найдено». В консоли:
```
GET /api/v1/meetings/:id/tasks → 404 {"error":{"code":"not_found","message":"meeting_not_found"}}
```
При этом задачи встречи реально существуют (в трекере, `Issue` с `externalSource:"meeting"` и `linkedMeetingIds:[meetingId]`). Воспроизведено на проде: встреча `01KVW4TQQ9CK3NT4NPTBHZKM9E` (орг «Ооо луа»), 3 задачи (DEVE-11/MTG-17/DEVE-12) слинкованы с встречей, но виджет пуст.

## 2. Корень
Цепочка: фронт [use-meeting-tasks.ts](../../frontend/src/hooks/use-meeting-tasks.ts) → [tasks.api.ts:79](../../frontend/src/api/tasks.api.ts#L79) `GET /meetings/:id/tasks` → deprecated [tasks.controller.ts:64](../../backend/src/modules/tasks/tasks.controller.ts#L64) → [TasksService.listByMeeting](../../backend/src/modules/tasks/tasks.service.ts#L61).

`listByMeeting` авторизует доступ через **строгий** `assertMeetingOwner` → кидает `404 meeting_not_found`, если `meeting.ownerId !== userId` ([tasks.service.ts:188](../../backend/src/modules/tasks/tasks.service.ts#L188)). Любой, кто **видит** встречу, но не является её владельцем (хост/участник/тиммейт по орг-видимости), получает 404. У встречи владелец — хост (chydo_002), а смотрит её другой участник (svmazur) → 404. Страница отчёта `/result` работает, потому что авторизует через `MeetingVisibilityService.assertCanView` ([meetings.service.ts:854](../../backend/src/modules/meetings/meetings.service.ts#L854)) — флаг-aware модель видимости (орг/участник/grants).

**Итог:** виджет использует проверку доступа **строже**, чем модель видимости встреч во всём остальном кабинете.

## 3. Решение (реализовано)
В [tasks.service.ts](../../backend/src/modules/tasks/tasks.service.ts):
1. Заинжектить `MeetingVisibilityService` (wiring не нужен — `MeetingsModule` `@Global`, уже экспортирует его).
2. В `listByMeeting` заменить `assertMeetingOwner` → `assertCanView(meetingId, userId)` (как у `/result`).
3. `create` (ручное добавление задачи) — оставить owner-only (запись не расширять).

Данные после фикса берёт `MeetingActionItemsService.listForMeeting` (флаг-aware: трекер `Issue.linkedMeetingIds` при `knowledge.meetingTasksToTrackerOnly`, иначе легаси `Task`). Линковка подтверждена — виджет вернёт 3 задачи.

## 4. РЕШЕНИЕ ВЛАДЕЛЬЦА — чьи задачи показывать → **РЕШЕНО (2026-06-25): A**
Владелец выбрал **A**: показывать **все** задачи встречи любому, кто видит встречу (фильтр по `userId` убран в трекер-ветке). Обоснование: AI-отчёт встречи и так перечисляет все эти задачи всем, кто видит встречу, — структурный виджет совпадает с отчётом, новой утечки нет. Реализация уже соответствует решению — доп. правок кода не требуется.

Отклонённый вариант B (только свои задачи: оставить фильтр `userId`) — не выбран.

## 5. Верификация (сделано)
- `vitest src/modules/tasks/tasks.service.spec.ts` — 15/15 (3 новых теста на `listByMeeting`: авторизация через видимость / все задачи без userId-фильтра / проброс отказа).
- `tsc` — в `src/modules/tasks/` ноль ошибок (полный typecheck красный из-за стейл локального Prisma-клиента, не связано).
- eslint изменённых файлов — чисто.
- Прод-данные: `linkedMeetingIds` у 3 issue подтверждены прямым `GET /api/v1/issues/:id`.

## 6. Деплой
Только код backend, без миграций/seed/ENV/очередей — **prod-операций нет**. Чтобы увидеть 3 задачи 24.06 — деплой backend после merge.

## 7. Фазы
- [x] Найти корень (404 = строгий owner-чек).
- [x] Фикс `listByMeeting` (assertCanView) + тесты.
- [x] Подтвердить линковку issue↔встреча на проде.
- [x] Подтвердить решение §4 (A/B). → A (2026-06-25).
- [ ] Merge `fix/meeting-tasks-widget-visibility` → dev + деплой backend.
- [ ] Принять глазами: открыть встречу 24.06, виджет показывает задачи.
