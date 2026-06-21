---
type: tz
status: ready-to-implement
feature: daily-reminders-delivery-fix-and-work-calendar
date: 2026-06-21
owner: sergrv80 (владелец продукта Кора)
relates_to:
  - plans/tz/2026-06-21-universal-daily-checkin-fixator-tz.md
  - docs/operations/feature-flags.md
---
> Диагностика проведена на проде (diag.ts logs, meet.crossmark.ru, 2026-06-21, доступ подтверждён владельцем). Корень установлен фактами, не гипотезой.
> Парного orchestrator-prompt нет — ТЗ берётся напрямую (фазы мелкие, последовательные).

# ТЗ — Надёжные ежедневные напоминания: доставка утром + рабочий календарь + застрявшие задачи

## Принцип

Запланированное ежедневное напоминание (план дня / отчёт / дайджест задач) — это **ожидаемая пользователем рутина в рабочий час**, а не спонтанный ночной пуш. Поэтому: оно (1) **доходит до Telegram утром** (не глушится «тихими часами»), (2) **не приходит в выходные и в отпуск**, (3) показывает застрявшие задачи **поимённо**.

## Цель + Зачем

**Болезненное состояние (verified на проде):** владелец получает вечерний чек-ин, но не получает утренний. Разбор логов прода показал настоящий корень — **не в кроне**:

| Слот | Время | Каналы (прод-логи) |
|---|---|---|
| Утро | 06:00 UTC = 09:00 МСК | `checkin.prompt` → `channels=[in_app]` (в кабинет ушло, Telegram срезан) |
| День | 09:00 UTC = 12:00 МСК | `probe.digest` → `channels=[in_app,telegram_bot]` ✅ |
| Вечер | 15:00 UTC = 18:00 МСК | `checkin.prompt` → `channels=[in_app,telegram_bot]` ✅ |

Утренний чек-ин **отправляется и доходит в кабинет**, но push в Telegram подавляется: `checkin.prompt` — не критичное (`priorityTier=2`), а 09:00 МСК попадает в «тихие часы» → `tryConsume` возвращает `reason=quiet_hours`, push-канал срезается (`notification-budget.service.ts:93-114`, verified). 12:00 и 18:00 — вне тихих часов → Telegram проходит. Значит правый край тихих часов в проде стоит **≥10:00** (дефолт `08:00` — тогда бага бы не было; кто-то расширил окно в AdminSetting/ENV). [ASSUMPTION: точное число (10/11) не снято с прода — диаг-скрипт `backend/scripts/diag-checkin-reminders.ts` его покажет; фикс от точного числа не зависит.]

**Сопутствующее (verified):**
- **Бюджет 5 пушей/день** срезает даже вечерний Telegram (`budget_exceeded` 18 июня, прод-лог).
- **Шлёт в выходные** — пачка `checkin.prompt` в субботу 21 июня 06:00; в `daily-checkin-prompt.cron.ts` нет проверки рабочего дня (в отличие от `operations-weekly-digest.cron.ts`, который день недели проверяет).
- **Отпуска как сущности нет** (есть только `HolidayCalendar` — праздники РФ — и `Person.workingDays`).
- **Застрявшие задачи** в утреннем дайджесте показаны только счётчиком (`telegram-digest.cron.ts:407-409`, порог 3 дня хардкод).

**Метрика «решено»:** в будни утром `checkin.prompt` доходит до Telegram (в логах `channels=[...,telegram_bot]` в утреннем слоте); в выходные/отпуск — 0 отправок; в дайджесте застрявшие перечислены поимённо.

## REALITY-CHECK (фактический статус по коду 2026-06-21)

| Что | Факт | Вывод |
|---|---|---|
| Утренний крон `DailyCheckInPromptCron` | жив, шлёт morning+evening (`daily-checkin-prompt.cron.ts:27,116`) | НЕ корень; не трогаем расписание |
| `tryConsume` bypass | `bypass = critical \|\| priorityTier===1` пропускает quiet-блок и budget (`notification-budget.service.ts:67,93,143`) | фикс = `priorityTier:1` для чек-ина/дайджеста |
| `sendNotification` проброс | передаёт `priorityTier`/`critical` в `tryConsume` (`conversational.service.ts:189-190`) | проброс есть, менять сигнатуру не нужно |
| Гипотеза «строка ломает `===`» | **ОПРОВЕРГНУТА** прод-логами (утро отправляется) | не реализуем |
| `HolidayService.isHoliday/isWeekend` | есть в tracker (`tracker/services/holiday.service.ts`) | переиспользуем для Ф2 |
| `Person.workingDays` (Int[]) | есть (`schema.prisma:4897`), дефолт `[]` → трактовать как пн–пт | основа Ф2 |
| Модель отпуска | **нет** | Ф3 создаёт `PersonLeave` |
| `telegram-task-parser.formulateDigest` | LLM + fallback, `TelegramDigestPayload` (`telegram-task-parser.service.ts:292,915`) | Ф4 добавляет секцию «застрявшие» |

## Принятые решения владельца (не пересматривать)

| # | Решение | Источник |
|---|---|---|
| Р-1 | Фикс выкатываем и смотрим прод (чинит или нет) — без golden-гейта | владелец 2026-06-21; [[feedback_no_golden_ship_and_observe_prod]] |
| Р-2 | Утренние напоминания должны пробивать тихие часы (это рабочий час, не ночь) | владелец «починить, может расширить окно» |
| Р-3 | В выходные по умолчанию НЕ слать | владелец 2026-06-21 |
| Р-4 | Отпуск — настраиваемое отсутствие, в эти дни не слать | владелец 2026-06-21 |
| Р-5 | Застрявшие задачи (день-два без активности) — адресно исполнителю, поимённо в дайджесте; один утренний дайджест, без лишних пушей; порог-крутилка дефолт 2 дня | владелец (AskUserQuestion 2026-06-21) |

## Доказательство выбора фикса доставки (Ф1)

| Критерий | A. `priorityTier:1` для чек-ина/дайджеста (выбрано) | B. новый параметр `bypassQuietHours` | C. сузить глобальные тихие часы (end→8) | D. сдвинуть час чек-ина (→11) |
|---|---|---|---|---|
| Чинит утреннюю доставку | ✓ обходит quiet | ✓ обходит quiet | ✓ | ⚠️ если окно ≤11 |
| Переживает исчерпанный бюджет | ✓ обходит budget | ✗ упрётся утром (как 18 июня) | ✗ | ✗ |
| Точечно (только напоминания) | ✓ | ✓ | ✗ меняет ВСЕ уведомления, вернёт утренний шум всем типам | ✓ |
| Объём кода | минимум (1 поле в 2 местах) | средний (новый параметр через 2 слоя) | мин, но рискованно | мин, но «утро в 11» поздно |
| Уважает opt-out | ✓ (проверяется раньше bypass) | ✓ | ✓ | ✓ |

**Выбран A.** Чек-ин/дайджест — приоритетные запланированные уведомления; `priorityTier:1` гарантирует доставку утром, обходя и тихие часы, и бюджет, но уважая `opt-out`. B отложен как альтернатива, если владелец захочет, чтобы напоминания уважали дневной бюджет. C/D отвергнуты (C небезопасен глобально, D ломает смысл «утра»).

## Scope

**Входит:** Ф1 фикс доставки (`priorityTier:1`); Ф2 пропуск выходных/праздников; Ф3 модель отпуска `PersonLeave` + пропуск; Ф4 застрявшие задачи поимённо в дайджесте + порог-крутилка; Ф5 крутилки/флаги/прод-инструкция.

**Не входит (с судьбой):**
- Согласование двух утренних механизмов (checkin.prompt + telegram-дайджест в один слот) — отдельное UX-ТЗ; здесь только чиним доставку обоих.
- Авто-импорт отпусков из Bitrix/HR — vNext, отдельное ТЗ (Ф3 даёт ручной ввод/настройку).
- Перенос дефолтного значения тихих часов — НЕ трогаем (фикс точечный, чтобы не задеть другие уведомления).

## Фазы

Зависимости: **Ф1** независима (выкатывается первой, проверка гипотезы). **Ф2**, **Ф3**, **Ф4** независимы между собой, каждая опирается на Ф5 (крутилки) либо несёт свою. Порядок выката: Ф1 → (Ф2, Ф3, Ф4) → Ф5 свёрстана внутри каждой.

```
Ф1 (фикс доставки — ВЫКАТ ПЕРВЫМ, проверка гипотезы тихих часов)
Ф2 (выходные/праздники)   ┐
Ф3 (отпуск PersonLeave)   ┤ независимы, каждая со своей крутилкой
Ф4 (застрявшие поимённо)  ┘
```

### Ф1 — Фикс: утренние напоминания доходят в Telegram (обход тихих часов)

**Цель:** `checkin.prompt` (morning/evening) и утренний telegram-дайджест доставляются с `priorityTier:1`, чтобы push не глушился тихими часами/бюджетом.
**Файлы:**
- `backend/src/modules/operations/workers/daily-checkin-prompt.cron.ts` (вызов `sendNotification` `:116-128`).
- `backend/src/modules/conversational/adapters/telegram-bot/telegram-digest.cron.ts` (вызов `sendNotification` `:181-192`).
**Контракт (дословно добавить в оба вызова `sendNotification`):**
```ts
priorityTier: 1,
```
**Поведение:** `tryConsume` при `priorityTier===1` → `bypass=true` → quiet-блок пропущен, `isOverBudget`→false. `opt-out` (проверяется до bypass) сохраняется. Никаких новых параметров/сигнатур.
**Что НЕ входит:** менять `tryConsume`/`sendNotification`; трогать значение тихих часов; выходные (Ф2).
**Acceptance:**
- grep `daily-checkin-prompt.cron.ts`: `priorityTier: 1` в объекте `sendNotification` для `checkin.prompt`.
- grep `telegram-digest.cron.ts`: `priorityTier: 1` в вызове `sendNotification`.
- `bun run typecheck` + `bun run build` (backend) зелёные.
- Прод-верификация (после выката, наблюдением): в утреннем слоте лог `sendNotification: ... eventType=checkin.prompt channels=[...,telegram_bot]` (Telegram в каналах). [[feedback_no_golden_ship_and_observe_prod]]
**Закрывает:** R1, R2.

### Ф2 — Не слать в выходные и праздники

**Цель:** в нерабочий день (по `Person.workingDays` + `HolidayCalendar`) утренний/вечерний чек-ин и дайджест не отправляются.
**Файлы:** `daily-checkin-prompt.cron.ts` (внутри цикла по `persons`, до `sendNotification`), `telegram-digest.cron.ts` (до `collectIssuesPayload`); переиспользовать `HolidayService` (`tracker/services/holiday.service.ts`) — экспортировать в shared/импортировать; новая крутилка (Ф5).
**Контракт:**
- Вычислить `dayOfWeek` через `localDayBoundsUtc(now, person.timezone)` (`operations/utils/local-date.ts:108`).
- `workingDays = person.workingDays.length ? person.workingDays : [1,2,3,4,5]` (дефолт пн–пт; `[ASSUMPTION]` пустой массив = стандартная рабочая неделя, согласовано с `find-free-slot.service.ts:13`).
- Если `!workingDays.includes(dayOfWeek)` → skip (+ метрика `daily_checkin_skipped{reason:'weekend'}`).
- Если `daily-checkin.skipHolidays`=true (крутилка, дефолт true) И `HolidayService.isHoliday({tenantId, date})` → skip (`reason:'holiday'`).
- Крутилка-рубильник `daily-checkin.skipNonWorkingDays` (дефолт **true** — по умолчанию не слать в выходные, Р-3).
**Что НЕ входит:** отпуск (Ф3); перенос рабочих суббот (берётся из `HolidayCalendar.isWorking` внутри `isHoliday`, уже реализовано).
**Acceptance:**
- `daily-checkin-prompt.cron.spec.ts` (доп. кейс): Person с `workingDays=[1..5]`, `now`=суббота → `promptsSent=0`, причина `weekend`.
- grep: вызов `HolidayService`/`workingDays` в `daily-checkin-prompt.cron.ts`.
- `bunx vitest run backend/src/modules/operations/workers/daily-checkin-prompt.cron.spec.ts` зелёный.
**Закрывает:** R3, R4.

### Ф3 — Модель отпуска `PersonLeave` + пропуск в дни отсутствия

**Цель:** в дни отпуска/отсутствия сотрудника напоминания не отправляются.
**Файлы:** `backend/prisma/schema.prisma` (новая модель), миграция `prisma/migrations/*`, `daily-checkin-prompt.cron.ts` + `telegram-digest.cron.ts` (проверка), новый `PersonLeaveService` (минимальный `isOnLeave(tenantId, personId, date)`), admin-эндпоинт CRUD (по образцу `holidays.controller.ts`).
**Контракт (дословно):**
```prisma
model PersonLeave {
  id        String   @id @default(cuid())
  tenantId  String
  personId  String
  fromDate  DateTime
  toDate    DateTime
  kind      String   @default("vacation")
  comment   String?
  createdAt DateTime @default(now())
  person    Person   @relation(fields: [personId], references: [id], onDelete: Cascade)
  @@index([tenantId, personId, fromDate, toDate])
}
```
**Поведение:** `isOnLeave` = существует `PersonLeave` где `personId` и `localDate ∈ [fromDate, toDate]`. В кронах: если `isOnLeave` → skip (`reason:'on_leave'`). Tenant-scope (`tenantId` в where).
**Что НЕ входит:** авто-импорт из внешних систем (vNext); UI календаря отпусков (минимальный CRUD-эндпоинт; страница — отдельно).
**Acceptance:**
- `bun run prisma:migrate -- --name person_leave` создаёт миграцию; `bun run prisma:generate` зелёный; grep `model PersonLeave` в schema.
- spec: Person с `PersonLeave` на сегодня → `promptsSent=0` (`reason:on_leave`).
- Эндпоинт `POST /api/v1/admin/person-leaves` (Zod-DTO + Swagger) создаёт запись; идемпотентность не требуется (ручной ввод).
**Закрывает:** R5, R6.

### Ф4 — Застрявшие задачи поимённо в утреннем дайджесте + порог-крутилка

**Цель:** в утреннем дайджесте показать конкретные задачи исполнителя без активности ≥ порога (вместо счётчика); порог — крутилка дефолт 2 дня.
**Файлы:** `telegram-digest.cron.ts` (`collectSprintBlock:390-409` — заменить `count` на выборку задач; считать по ВСЕМ назначенным, не только в спринте — Р-5), `telegram-task-parser.service.ts` (`TelegramDigestPayload`/`TelegramDigestSprintBlock` `:915-949` — добавить `stalled: Array<{identifier; title; daysIdle}>`; рендер секции), крутилка (Ф5).
**Контракт:**
- Порог `daily-checkin.staleDaysThreshold` (крутилка, дефолт **2**). `cutoff = now - threshold*86400_000`.
- Выборка: `Issue` где `assignees.some.userId`, `state.category notIn ['completed','cancelled']`, `updatedAt < cutoff`, `deletedAt:null`, `archivedAt:null`; лимит 12; вернуть `[{identifier, title, daysIdle}]`.
- Рендер: русская секция «🟡 Застряли (нет движения N дн.):» списком; пусто → секции нет.
- Анти-спам: дайджест и так раз в день (Redis dedup существует) — отдельный debounce по задаче не нужен в этой фазе ([ASSUMPTION]: повтор в дайджесте раз в день приемлем; если владелец захочет реже — крутилка `daily-checkin.staleRepeatEveryDays` vNext).
**Что НЕ входит:** отдельные пуши среди дня (Р-5 — только в дайджесте); LLM-обогащение секции (чистый шаблон).
**Acceptance:**
- spec парсера/крона: Issue назначена на user, `updatedAt` = 3 дня назад, порог 2 → попадает в `stalled` с `daysIdle≥2`; задача с `updatedAt`=сегодня → не попадает.
- grep: `staleDaysThreshold` и `stalled` в дайджест-коде; русская подпись, без английских литералов ([[feedback_admin_ui_russian_only]]).
**Закрывает:** R7, R8.

### Ф5 — Крутилки AdminSetting + флаги + прод-инструкция

**Цель:** пороги/рубильники — в админке; регистрация флагов; прод-инструкция.
**Файлы:** `admin-setting-schema-registry.ts`, `backend/scripts/seed-admin-settings.ts`, `docs/operations/feature-flags.md`, `docs/operations/prod-deploy-log.md` (Шаги 4, 7), `apply-prod-deploy.ts` (если новый seed).
**Контракт реестра (добавить):**
```ts
['daily-checkin.skipNonWorkingDays', z.boolean()],
['daily-checkin.skipHolidays', z.boolean()],
['daily-checkin.staleDaysThreshold', z.number().int().min(1).max(30)],
```
Сид: `skipNonWorkingDays=true`, `skipHolidays=true`, `staleDaysThreshold=2`. Чтение — `cfg.getDynamic('daily-checkin.staleDaysThreshold', undefined, 2)` (admin→code-fallback, без ENV).
**Ship-On/флаги:** `skipNonWorkingDays`, `skipHolidays` — **kill-switch, дефолт ON** (фича выкатывается включённой). Строки в `feature-flags.md`.
**Acceptance:**
- grep реестра: три ключа `daily-checkin.*`.
- `feature-flags.md` содержит обе строки; prod-deploy-log Шаг 4 (миграция `PersonLeave`, Ф3) и Шаг 7 (seed новых ключей) обновлены.
**Закрывает:** R9, R10.

---

## Требования (трассировка)

- **R1** Утренний `checkin.prompt` shall доставляться с `priorityTier:1`, обходя тихие часы и бюджет. (Ф1)
- **R2** Утренний telegram-дайджест shall доставляться с `priorityTier:1`. (Ф1)
- **R3** Если день не входит в `workingDays` сотрудника, then напоминание shall не отправляться (рубильник `skipNonWorkingDays`, дефолт ON). (Ф2)
- **R4** Если день — праздник по `HolidayCalendar` и `skipHolidays`=true, then напоминание shall не отправляться. (Ф2)
- **R5** Система shall хранить `PersonLeave` (период отсутствия). (Ф3)
- **R6** Если дата входит в активный `PersonLeave`, then напоминание shall не отправляться. (Ф3)
- **R7** Утренний дайджест shall перечислять застрявшие задачи поимённо (≥ порога), а не счётчиком. (Ф4)
- **R8** Порог застревания shall читаться из AdminSetting (дефолт 2 дня). (Ф4,Ф5)
- **R9** Рубильники выходных/праздников shall быть kill-switch (дефолт ON) в feature-flags.md. (Ф5)
- **R10** Пороги/рубильники shall читаться через getDynamic с code-fallback, без ENV/хардкода. (Ф5)

## Границы фичи

- ✅ Always: `priorityTier:1` только для запланированных напоминаний; русские подписи; tenant-scope в каждом where; рубильники выходных дефолт ON.
- ⚠️ Ask first: менять значение глобальных тихих часов; делать спонтанные уведомления `priorityTier:1`; авто-импорт отпусков.
- 🚫 Never: хардкод порога/часа вместо AdminSetting; `process.env.*` мимо env.schema; `new PrismaClient()` в скриптах; OFF-флаг «понаблюдаем→включим».

## Pre-mortem / Риски

- **`priorityTier:1` обходит бюджет** — чек-ин/дайджест всегда пройдут; приемлемо (2–3 запланированных/день), но тратят слот ledger. Ревью: не делать tier=1 для спонтанных типов.
- **Гипотеза тихих часов не подтверждена точным числом** — Ф1 чинит независимо от значения (обход, а не сдвиг). Если после выката утром Telegram всё равно молчит → причина не в тихих часах (тогда снять диаг-скрипт с прода: бюджет/binding/opt-out).
- **workingDays пустой у части Person** — дефолт пн–пт; если у кого-то реально 6-дневка — настроит `workingDays`.
- **Ревью-гейт (`strict-production-review-gate`):** tenant-scope `PersonLeave`-запросов; идемпотентность миграции; отсутствие регрессии вечернего чек-ина.

## Идемпотентность / флаг / prod-deploy

- Ф1 — только код, прод-операций нет (кроме `docker compose up -d --build backend`).
- Ф3 — миграция `PersonLeave` (Шаг 4), применяется авто на `up` через `migrate deploy`.
- Ф5 — seed новых ключей (Шаг 7), повторный прогон no-op.

## DoD

- `bun run typecheck` (вкл. `.spec`), `bun run lint`, `bun run build` — зелёные (backend).
- Фазовые vitest зелёные.
- second-brain обновлён: `01_projects/operations.md` (фикс доставки + рабочий календарь), `02_architecture/data-model.md` (`PersonLeave`).
- prod-deploy-log Шаги 4/7 + feature-flags.md обновлены.
- Рефлексия в `05_история/`.

## Итог

_(заполняет реализация: что выкачено, подтвердилась ли гипотеза тихих часов на проде.)_
