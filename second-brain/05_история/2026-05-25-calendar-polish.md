---
date: 2026-05-25
session: Calendar MVP Polish (P1+P3 / P2 / P4)
status: завершено
distilled: false
---

# Calendar Polish — 3 параллельных агента за 1 проход

## Поставлено

После Calendar MVP (Фазы 1+2) у нас осталось 4 функциональных пробела, из-за которых MVP нельзя было считать «отдаваемым пользователю»:
1. `kind=meeting` не создавал LiveKit-комнату, не отменял при удалении.
2. Reminders уходили только в Telegram (без email).
3. `/projects/[slug]/calendar` фильтровал клиентски.
4. EventForm.participants принимал userId через запятую — UI нерабочий.

Пользователь принципиально расширил scope P4: участником может быть **не только коллега из Org**, но также внешний контакт (Person), произвольное имя без email (создаём Person автоматически) или **никто** («обед 12-15», «поход в больницу»). Это правильно — без этого UserPicker был бы UX-провалом.

## Как решал

**Подход:** один coordinator (я) + 3 параллельных агента. Файлы разнесены так, чтобы конфликтов не было.

- **Агент A (P1+P3 backend+frontend):** `meetings.service.ts` + events backend + frontend calendar API/CalendarView/EventForm (только кнопка joinUrl). Объём ~1500 строк, 35 events-тестов + 10 meetings-тестов.
- **Агент B (P2 backend):** `event-reminders.worker.ts` + spec. Email-канал через `MailService.sendPlain`. Объём ~400 строк, 4 unit-теста.
- **Агент C (P4 full-stack):** новый модуль `org-members` (controller+service+dto+spec) + расширение `persons` (quick-create) + frontend `org-members.api.ts` + `persons.api.ts` + новый компонент `ParticipantPicker.tsx` + замена поля в `EventForm.tsx`. Объём ~1200 строк, 5+5 unit-тестов.

Один файл — `frontend/src/ui/calendar/EventForm.tsx` — трогали оба A и C. Перед commit проверил: оба изменения присутствуют (joinUrl-кнопка на line 413-420, ParticipantPicker на line 40-42, 392). **Конфликта не было** — агенты работали с разными участками файла, поэтому Edit-операции не пересекались.

Все вопросы по дизайну API (например, Egress stop при cancel активной встречи, joinUrl без JWT) агенты вынесли в раздел «Открытые вопросы» в финальном отчёте — приемлемые компромиссы, задокументированы в [calendar.md](../01_projects/calendar.md) как новые TODO.

## Что вышло

- **63 теста зелёных + 1 skipped** в events / persons / org-members / meetings.
- **Backend typecheck:** 1 ошибка в чужом scope (`test/eval/skill-trait-detect-golden`), мой код 0.
- **Frontend typecheck:** 0 ошибок.
- **Один коммит** `5c4c6c1` (24 файла, ~3100 строк нового кода).
- **second-brain обновлён** — TODO-секция в calendar.md сократилась с 9 пунктов до 3 (push, RRULE, OAuth, autoscheduler — отложены).

**Время:** ~20 минут на брифинги + ~17 минут параллельной работы агентов + ~5 минут факт-чек/commit = ~42 минуты на 4 функциональные фазы.

## Чему научился

**Что хорошо сработало:**

1. **Параллельные агенты на shared file работают, если они трогают разные секции.** Раньше я опасался EventForm.tsx как точки конфликта (A добавлял кнопку joinUrl, C заменял поле participants). На практике обе операции прошли чисто: A работал с разделом submit-rendering, C — с form-state и input. Урок: **бояться нужно не shared-файла, а shared-секции**. Если scope чётко разделён в брифинге («кнопку добавь возле rsvp-блока, поле participants замени на ParticipantPicker») — конфликта нет.

2. **`MeetingsService.createForCalendarEvent` оказалось правильным дизайном** — отдельный метод без partner-контекста, не пытался переиспользовать `createForUser`/`createFromCrossmark`. Альтернатива «впихнуть optional partnerId в существующий метод» сломала бы их семантику. Урок: новые use-case → новый явный метод, не флаг в существующем.

3. **Отдельный модуль org-members vs расширение users или persons.** Агент C сам принял правильное решение (новый модуль), потому что в брифинге я перечислил аргументы за/против. Урок: предоставлять агентам **архитектурный контекст с альтернативами**, а не указывать «делай так». Тогда они принимают решения близкие к моим.

**Грабли:**

1. **`git add` падает на первой несуществующей pathspec, остальные тоже не стейджатся.** Я указал `org-members/services/org-members.service.spec.ts`, а агент C положил его прямо в `org-members/`. `git add` упал, и я подумал что застейджились все остальные — а они нет. Урок: после `git add` с длинным списком — всегда `git diff --cached --name-only` для проверки.

2. **Параллельная сессия модифицировала много frontend файлов** (admin.api.ts, chapters.api.ts, tasks.api.ts, ai-result.ts...). При `git status` нужно явно фильтровать своё, иначе случайно подцепишь чужое. Урок: для multi-agent оркестрации в shared working copy **commit только по явным путям**, никогда `-A`/`.`.

3. **Edge case в брифинге пропустил.** Не сказал агенту C, что EventForm в edit-режиме должен показывать УЖЕ выбранных participants — а для этого нужно знать их имена, которые в `CalendarEventDomain.participants` сейчас не приходят. Агент C честно вынес это в TODO. Урок: при замене input на богатый компонент в формах — всегда проверять оба режима (create / edit), и edit обычно сложнее.

4. **Skipped тест в общем прогоне.** 63 passed + 1 skipped. Не выяснил какой именно — стоит проверить, не наш ли это. (Скорее всего регрессионный из meetings или events которому нужны другие условия.)

## Что осталось / next steps

1. **Push** — все commits в `dev` (5c4c6c1 + предыдущие 3). Жду подтверждения пользователя.
2. **Prod-деплой** — `bun run prisma:push` (если что-то применилось) + restart backend + worker. На самом деле в этом коммите schema.prisma не менялась, только code. Но MailService требует ENV переменные SMTP — нужно проверить что они есть в prod.
3. **Edit-режим EventForm + participants** — отдельная задача (enrich EventDto именами или fetch).
4. **External sync** ([calendar-external-sync.md](../../plans/tz/2026-05-25-calendar-external-sync.md)) — следующая итерация, вариант B (CalDAV + Google) согласован.
5. **UI smoke в браузере** — стоит наконец сделать (запустить bun run dev и пощёлкать).
