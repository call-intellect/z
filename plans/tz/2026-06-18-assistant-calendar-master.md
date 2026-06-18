# ТЗ (мастер): помощник Коры — дубли, даты/таймзоны, контрагент-vs-место, онлайн-пометка

> Статус: НЕ начато (реализация по «начни реализацию» / «погнали Фазу N»).
> Объединяет и заменяет: [2026-06-18-telegram-assistant-calendar-fixes.md](2026-06-18-telegram-assistant-calendar-fixes.md) (фиксы багов).
> Доказательная база: [analysis/…calendar-bugs-diagnosis.md](../analysis/2026-06-18-telegram-assistant-calendar-bugs-diagnosis.md) (логи+код),
> [analysis/…person-centric-time-and-online-flag.md](../analysis/2026-06-18-calendar-person-centric-time-and-online-flag.md) (продуктовая модель).
> Скоуп: backend (NestJS) + минимум frontend (настройки профиля, тумблер «онлайн»).
> Затрагивает: `conversational`, `concierge`, `events`, `me`, `users`, схему БД.

## Цель
Сделать так, чтобы помощник в мессенджерах и кабинете надёжно работал с календарём:
1. **не дублирует** ответы (один ответ на одно сообщение);
2. **понимает «сегодня/завтра/в среду»** и считает день в **таймзоне человека**;
3. **не путает** «чем занимается человек/компания» (контекст → память) с **местом встречи** (`location`);
4. **не создаёт видеокомнату по умолчанию** — онлайн только по явной пометке;
5. у пользователя есть **рабочий профиль** (таймзона + рабочие дни + часы) в настройках.

## Сквозные правила (соблюдать во всех фазах)
- **prompt-cache:** переменные данные (дата, контекст) идут в **USER-блок**, НЕ в SYSTEM
  (feedback `llm_prompts_cache_friendly`). Описания инструментов меняем редко (деплой, не per-request).
- **Ship-On:** всё выкатывается включённым; единственный флаг — kill-switch (см. ниже).
- **Крутилки в AdminSetting**, не хардкод (дефолтные рабочие часы/TZ).
- **TZ-расчёты** — через `operations/utils/local-date.ts` (Intl, без новых зависимостей).
- **Prisma:** изменения схемы — версионируемой миграцией (`prisma:migrate`), не `db push`.
- После каждой фазы: `bun run typecheck && lint && build` + затронутые unit зелёные.

## Карта фаз и порядок
- **Группа «острое» (без БД), делать первой:** Ф1 (дубли), Ф2 (дата в контекст), Ф7 (описания инструментов).
- **Группа «БД-поля» (одна миграция):** Ф4 (профиль), Ф5 (контрагент), Ф6 (онлайн) — поля вместе.
- **Группа «TZ-логика»:** Ф3 (окно/find_free_slot) — после Ф4 (рабочие часы).
- **Группа «UI»:** Ф8 (настройки профиля, тумблер онлайн, поле контрагента в карточке).
Рекомендуемый порядок реализации: **Ф1 → Ф2 → Ф7 → (миграция Ф4/Ф5/Ф6 поля) → Ф6 → Ф5 → Ф3 → Ф4-логика → Ф8**.

> ### ⚠️ Поправка по факту кода (2026-06-18, в ходе реализации — перекрывает текст ниже)
> Проверка схемы показала: **у модели `User` поля `timezone` НЕТ** (есть `id/email/name/phone/role/…/calendarFeedToken/tourProgress/companyRole`, и всё). Анализ и текст фаз ошибочно ссылались на «User.timezone:2481» — это на самом деле **`Org.timezone`**. Таймзона ЧЕЛОВЕКА в коде уже резолвится `Person.timezone → Org.timezone → 'Europe/Moscow'` (`find-free-slot.service.ts:resolveOrganizerTimezone`). Поэтому **рабочий профиль (таймзона + рабочие часы) кладём на `Person`, НЕ на `User`** (Person.timezone уже существует и редактируема; единый источник, согласованный с резолвом). Везде ниже, где написано «User.timezone / User.workStartHour / …», читать «**Person**.timezone / **Person**.workStartHour / …». Ф2 (контекст помощника) и Ф3 (окно дня) берут TZ через резолв Person→Org→Moscow, а не из User.

---

## Фаза 1 — Дедуп входящих апдейтов + ранний ACK (баг «дубли») `[x]`
**Причина:** `processUpdate` ждёт `dispatchInbound → handleAssistantTurn → concierge.process` (14–15с) до
возврата 200; отправитель ретраит доставку; нет дедупа `update_id`
([диагностика §1](../analysis/2026-06-18-telegram-assistant-calendar-bugs-diagnosis.md)).

**Сделать:**
1. **Идемпотентность по `update_id`** (основной фикс). В `processUpdate`
   ([telegram-webhooks.controller.ts:278-355](../../backend/src/modules/conversational/adapters/telegram-bot/telegram-webhooks.controller.ts#L278-L355)),
   после verify secret, до `ingestUpdate`: Redis `SET tg:update:<channelId>:<update_id> 1 NX EX 3600`.
   - `NX` не сработал → это повтор → сразу `return { ok: true }`, без обработки.
   - `body.update_id` нет/невалиден → обрабатываем без дедупа, WARN.
   - Фатальная ошибка дальше по обработке (catch) → `DEL` ключа (чтобы ретрай помог). Успех — ключ живёт до TTL.
   - Redis недоступен → fail-open (обрабатываем), WARN.
2. **Ранний ACK** за kill-switch `ASSISTANT_INBOUND_ASYNC_ENABLED` (ON):
   webhook возвращает 200 сразу, тяжёлую обработку `assistant_turn` — в фон.
   - **Рекоменд. (Р5-A):** через BullMQ-очередь (надёжно, ретраи контролируемы) — webhook enqueue → 200;
     процессор зовёт `handleAssistantTurn`.
   - **Минимум (Р5-B):** не `await`-ить `dispatchInbound` для фоновых типов (fire-and-forget + catch).
     Тогда корректность держится на дедупе из п.1.
3. То же для MAX-адаптера (тот же мост).

**Файлы:** `telegram-webhooks.controller.ts`, `telegram-bot.adapter.ts` (поле `update_id` в `TelegramUpdate`),
MAX-адаптер, опц. новый BullMQ-процессор, `env.schema.ts` (+флаг), `feature-flags.md`.
**Приёмка:** двойной POST одного `update_id` → один ответ; webhook отвечает 200 < 1с (лог времени).

---

## Фаза 2 — «Сейчас» (дата/время/TZ) в контекст помощника (баг «завтра») `[x]`
**Причина:** LLM не знает текущую дату/таймзону — `create_event` падал `400` (нет `startAt`), бот переспрашивал
([диагностика §2](../analysis/2026-06-18-telegram-assistant-calendar-bugs-diagnosis.md)).

**Сделать:** в начало контекст-блока (он едет в USER, кэш SYSTEM не страдает) добавить строку «сейчас»:
- `ConciergeContextBuilderService.build`
  ([concierge-context-builder.service.ts:24-81](../../backend/src/modules/concierge/services/concierge-context-builder.service.ts#L24-L81))
  дочитывает `User.timezone` (добавить в `select`), берёт `now = new Date()` один раз и формирует:
  `Сейчас: 2026-06-18 (среда), 16:30 по таймзоне пользователя (Asia/Novosibirsk). «сегодня» = эта дата, «завтра» = +1 день; время понимай в этой таймзоне.`
  (день недели + дата + час — через `local-date.ts` `getLocalDate`/`getLocalHour`).
- TZ = `User.timezone` (после Ф4 — из рабочего профиля; до Ф4 — текущее поле, дефолт Moscow).

**Файлы:** `concierge-context-builder.service.ts` (+ опц. строка-инструкция в USER-шаблоне
[concierge-respond.prompt.ts:164-199](../../backend/src/modules/concierge/prompts/concierge-respond.prompt.ts#L164-L199), НЕ в SYSTEM).
**Приёмка:** «запиши встречу завтра в 10:00 с N» создаёт событие на корректную дату без переспроса и без 400;
в `requestPreview` LLM-вызова видна строка «Сейчас…».

---

## Фаза 3 — Окно «сегодня»/диапазоны и `find_free_slot` в таймзоне человека (баг «сегодня») `[x]`
**Причина:** `resolveCalendarWindow` дефолтит окно через `setUTCHours` (UTC)
([events.service.ts:683-700](../../backend/src/modules/events/services/events.service.ts#L683-L700)); `find_free_slot`
хардкодит Пн-Пт 9-18 ([find-free-slot.service.ts:142-143](../../backend/src/modules/events/services/find-free-slot.service.ts#L142-L143)).

**Сделать:**
1. Вынести уже существующий `localDayBounds(cursor, tz)` (из find-free-slot.service.ts:139) в
   `operations/utils/local-date.ts` как `startOfLocalDayUtc(now, tz): Date` (+ `localDayWindowUtc(now, tz)`), unit-тест.
2. `resolveCalendarWindow(from, to, timezone)` — дефолт окна по локальному дню пользователя
   (`from = startOfLocalDayUtc(now, tz)`, `to = from + 24ч`). Прокинуть `User.timezone` из
   `getMyCalendar`/`getUserCalendar`/контроллера `/me/calendar`. Явные `from/to` — без изменений.
3. `find_free_slot` — заменить хардкод 9-18/Пн-Пт на рабочие часы из профиля участников (Ф4); до Ф4 — дефолт из AdminSetting.
4. Дефолт `timezone` в `create_event` (`CreateEventSchema`, сейчас `Europe/Moscow`) — подставлять TZ организатора.

**Файлы:** `operations/utils/local-date.ts` (+тест), `events/services/events.service.ts`, `find-free-slot.service.ts`,
`events.controller.ts`, опц. `events.dto.ts`.
**Приёмка:** unit `startOfLocalDayUtc` (UTC+7/+3, переход суток); для пользователя UTC+7 «сегодня» = локальные сутки, не смещённые.

---

## Фаза 4 — Рабочий профиль пользователя (таймзона + рабочие дни + часы) `[ ]`
**Цель:** единый источник «когда и в каком поясе человек работает».
([анализ §3.1](../analysis/2026-06-18-calendar-person-centric-time-and-online-flag.md)).

**Сделать:**
1. **Схема (миграция, вместе с Ф5/Ф6):** `User.workStartHour Int?`, `User.workEndHour Int?`,
   `User.workingDays Int[]` (0=вс..6=сб) — nullable, NULL = брать дефолт. `User.timezone` уже есть.
2. **Дефолты — AdminSetting** (`work_hours_default_start=9`, `work_hours_default_end=18`,
   `work_days_default=[1,2,3,4,5]`, `default_timezone=Europe/Moscow`) — seed `seed-admin-settings.ts`.
3. **Ручка `/me`** (паттерн как `PATCH /me/notification-preferences`,
   [me.controller.ts:55-64](../../backend/src/modules/me/me.controller.ts#L55-L64)): редактировать
   `timezone` (валидация `isValidTimezone`), `workStartHour/End`, `workingDays`. GET-профиль их отдаёт.
4. **Автоспрос помощником:** при `create_event`/`list_my_events`, если TZ не задана явно (профиль пустой) —
   один короткий вопрос «В каком вы часовом поясе? (город/UTC±)», ответ → запись в профиль. Не спамить
   (спрашиваем один раз, флажок «спрошено» в Redis/профиле).

**Файлы:** `schema.prisma`, миграция, `seed-admin-settings.ts`, `me.controller.ts`/`me.service.ts`,
концерж (автоспрос — в `concierge`/`assistant-channel.bridge`).
**Приёмка:** пользователь задаёт TZ «Новосибирск» → «какие сегодня встречи» и «завтра в 10» считаются по UTC+7.

---

## Фаза 5 — Различение «контрагент / о ком встреча» vs «место» (главный запрос владельца) `[x]`
**Причина:** боту некуда класть «чем занимается человек/компания», кроме `location` → «молочный завод»
становится местом офлайн-встречи ([анализ §3.0](../analysis/2026-06-18-calendar-person-centric-time-and-online-flag.md)).

**Сделать:**
1. **Слой 1 (правило в описании `create_event`):** `location` — **только явное место проведения**
   (адрес, «в офисе», «у нас», «по адресу…», ссылка). «Кто человек / чем занимается его компания /
   какой это клиент» (молочный завод, производство обуви) — **НЕ место**: в `counterparty`/`description`,
   не в `location`. ([service-map-generator.service.ts:300-348](../../backend/src/modules/concierge/services/service-map-generator.service.ts#L300-L348))
2. **Слой 2 (поле):** `Event.counterparty String?` (миграция вместе с Ф4/Ф6) + параметр `counterparty`
   в `create_event` («с кем/какая компания/клиент»). В карточке встречи показывать как «Клиент/контрагент».
3. **Слой 3 (целевой, опц./vNext):** привязка контрагента к `Entity` (организация-клиент) в графе —
   расширить `participants` до организации-сущности. Отметить как следующий шаг (память компании).

**Файлы:** `service-map-generator.service.ts` (описание+param), `schema.prisma` (+`counterparty`),
`events.dto.ts`, `events.service.ts` (сохранение), фронт-карточка (Ф8).
**Приёмка:** «встреча с Александром, он с молочного завода завтра в 10» → `location` пусто,
`counterparty`≈«Александр, молочный завод», тип не «офлайн-на-заводе».

---

## Фаза 6 — Онлайн-пометка: видеокомната только по явному «онлайн» `[x]`
**Причина:** видеокомната создаётся при `kind=meeting` (дефолт), плодит `failed/never_activated` для очных
встреч ([events.service.ts:254-258](../../backend/src/modules/events/services/events.service.ts#L254-L258), [диагностика §4](../analysis/2026-06-18-telegram-assistant-calendar-bugs-diagnosis.md)).

**Сделать (Р1-A — отделить формат от типа):**
1. `Event.online Boolean @default(false)` (миграция вместе с Ф4/Ф5). `kind` остаётся «тип» (совещание/1:1/дедлайн).
2. `events.service.ts create`: LiveKit-комнату создавать при **`data.online === true`** (вместо `kind === 'meeting'`).
3. `create_event`: добавить параметр `online` (default `false`); сменить дефолт `kind` на нейтральный
   (не онлайн-видео). Описание: «`online=true` только если человек явно сказал созвон/онлайн/видео/zoom».
4. **«Добавить онлайн позже»:** инструмент/эндпоинт `make_event_online` (PATCH события → `online=true` →
   создать комнату), чтобы к офлайн-встрече можно было прицепить ссылку.
5. Старые `failed/never_activated` не трогаем (история).

**Файлы:** `schema.prisma` (+`online`), `events.service.ts`, `events.dto.ts`, `service-map-generator.service.ts`
(param+описание+новый tool), `assistant-channel.bridge` whitelist (+`make_event_online`).
**Приёмка:** «встреча с N на заводе завтра» → создаётся БЕЗ видеокомнаты, не `failed`; «онлайн-созвон с N» → с комнатой.

---

## Фаза 7 — Описания list-инструментов (чтобы LLM брал правильный) `[x]`
**Причина:** `list_meetings` без фильтра даты, но описан для «что было сегодня»
([service-map-generator.service.ts:139-156](../../backend/src/modules/concierge/services/service-map-generator.service.ts#L139-L156)).

**Сделать:**
1. `list_meetings` — убрать «что у меня было сегодня»; указать: «последние видеовстречи Коры без фильтра по
   дате; для вопросов про календарь/сегодня/неделю используй `list_my_events`».
2. `list_my_events` — уточнить «дефолт = сегодняшние сутки в таймзоне пользователя».

**Файлы:** `service-map-generator.service.ts`.
**Приёмка:** «какие у меня сегодня встречи» → LLM зовёт `list_my_events`, не `list_meetings`.

---

## Фаза 8 — Frontend: настройки профиля, тумблер «онлайн», поле контрагента `[ ]`
**Сделать:**
1. Настройки пользователя: таймзона (выбор IANA), рабочие дни, рабочие часы (начало/конец) — слой
   ApiDto→Domain→Ui, единый `api-client` (skill `frontend-rules`).
2. Форма создания/карточка встречи: тумблер «Онлайн-встреча» (→ `online`), поле «Клиент/контрагент»
   (→ `counterparty`), кнопка «Сделать онлайн» для офлайн-встречи.
**Приёмка:** пользователь меняет TZ/часы в кабинете; при создании встречи видит и задаёт онлайн/контрагента.

---

## Развилки (решения владельца; рекомендации даны)
- **Р1 «онлайн»:** boolean `Event.online` поверх `kind` (рекоменд.) vs смена дефолта `kind`. → **boolean**.
- **Р5 ранний ACK:** BullMQ (рекоменд., надёжно) vs fire-and-forget (дешевле, без ретраев). → **BullMQ**.
- **Р-контрагент:** Слой 1+2 сразу (правило + поле) — да; Слой 3 (граф) — отдельно/vNext. → **1+2 сейчас**.
- **Р-профиль:** настройки + автоспрос при незаданной TZ. → **оба**.

## Прод / реестры (для prod-deploy-log при реализации)
- **Миграция Prisma** (Ф4/Ф5/Ф6): `User.workStartHour/workEndHour/workingDays`, `Event.online`, `Event.counterparty` → Шаг 4.
- **Seed AdminSetting** дефолтов рабочих часов/TZ → Шаг 7 (+ в `apply-prod-deploy.ts STEPS`).
- **ENV/флаг** `ASSISTANT_INBOUND_ASYNC_ENABLED` (kill-switch, ON) → Шаг 1 + `docs/operations/feature-flags.md`.
- **Новая очередь** (если Ф1 через BullMQ) → Шаг 12 (smoke).

## Для оркестратора (tz-orchestrator)
Каждая фаза: картография затронутых файлов → точечные правки → независимая приёмка (греп маркеров +
re-Read + свой typecheck/lint/build + unit) → коммит по фазе. Группа «острое» (Ф1/Ф2/Ф7) даёт максимум
эффекта без миграций — выкатывать первой. Поля Ф4/Ф5/Ф6 — одной миграцией.

## Итог
Реализовано: — (ТЗ, код не начат). Осталось: Ф1–Ф8. Делает помощника таймзоно-корректным, без дублей,
не путающим «о ком» с «где», и не плодящим лишние видеокомнаты.
