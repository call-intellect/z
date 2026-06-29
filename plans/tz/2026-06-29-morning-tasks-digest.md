---
type: tz
status: ready-to-implement
feature: morning-tasks-digest
date: 2026-06-29
owner: sergrv80@gmail.com
relates_to:
  - plans/tz/2026-06-22-tasks-subsystem-unified-fix.md
  - plans/tz/2026-06-27-task-decision-execution-unified-tz.md
  - second-brain/01_projects/tracker.md
  - docs/operations/feature-flags.md
---
> Анализ: исследование проведено инлайн (картография кода в этом ТЗ, §REALITY-CHECK) · Статус согласования: 2026-06-29 (развилки закрыты владельцем — см. §«Принятые решения владельца»)

# ТЗ — «Утренняя сводка задач» (morning tasks digest)

## Цель

Каждое утро по МСК каждый активный сотрудник получает одно уведомление со списком **всех своих открытых (незакрытых) задач** из трекера, сгруппированных по срочности, чтобы спланировать день. Если открытых задач нет — короткое «всё чисто». Доставка — по тем каналам, что владелец включил в админке (колокольчик / почта / Telegram / MAX); час рассылки — тоже крутилка в админке.

## Зачем (болезненное состояние → решение)

- **Сейчас:** трекер есть, но он *пассивен* — сотрудник сам должен зайти и посмотреть свои задачи. Проактивных уведомлений про **открытые** задачи нет: есть только реактивные точечные (`issue.assigned` при назначении, `issue.overdue` при просрочке, `task.closed_for_review` при закрытии). Никто не получает утром цельную картину «вот что на тебе висит».
- **Решение:** ежедневный персональный «утренний бриф задач». Это закрывает класс «сотрудник не держит в голове свой список и забывает задачи», а не один кейс. Ложится на уже работающие рельсы (единый «почтальон» `ConversationalService`, мультиканальная доставка, AdminSetting-крутилки) — без новых таблиц и без нового модуля.

---

## REALITY-CHECK (факт по коду на 2026-06-29)

> Номера строк — на момент написания ТЗ. Перед правкой **перечитать файл** и искать по якорю-символу (указан рядом).

| Что | Статус по факту | Вывод для ТЗ |
|---|---|---|
| Единый «почтальон» `ConversationalService.sendNotification(input)` | **Работает.** [conversational.service.ts:121](../../backend/src/modules/conversational/conversational.service.ts) (якорь `async sendNotification`). Вход `SendNotificationInput` ([:45](../../backend/src/modules/conversational/conversational.service.ts), якорь `export interface SendNotificationInput`): `{ tenantId, recipientUserId, eventType, payload, dataClass?, preferredChannelKinds?, priorityTier?, ... }`. Сам создаёт `Notification`, гарантирует `in_app`, резолвит binding'и, фильтрует по политике, гейтит push бюджетом. | Переиспользуем как есть. Каналы задаём через `preferredChannelKinds` (перекрывает дефолтную политику). |
| Канальная политика по eventType | Захардкожена `EVENT_TYPE_CHANNEL_POLICY` ([:60](../../backend/src/modules/conversational/conversational.service.ts), якорь `const EVENT_TYPE_CHANNEL_POLICY`). Перекрывается `input.preferredChannelKinds` ([:166](../../backend/src/modules/conversational/conversational.service.ts), якорь `input.preferredChannelKinds ??`). | Добавляем строку-дефолт для `tasks.daily_open`, но фактически каналы берём из AdminSetting и передаём в `preferredChannelKinds`. |
| Рендер текста уведомления | **Пер-канальный**, в адаптерах: у каждого свой `renderText(notification)` со `switch (eventType)`. Telegram [:1131](../../backend/src/modules/conversational/adapters/telegram-bot/telegram-bot.adapter.ts) (якорь `private renderText`), MAX [:868](../../backend/src/modules/conversational/adapters/max-bot/max-bot.adapter.ts) (якорь `private renderText`), Email через `subjectFor`+`renderPlainText` [:63/:76](../../backend/src/modules/conversational/adapters/email-smtp.adapter.ts). `in_app` ([in-app.adapter.ts](../../backend/src/modules/conversational/adapters/in-app.adapter.ts)) **текст не строит** — рендерит фронт из `payload`. | Новый `eventType` требует case в **3 адаптерах** (telegram/max/email) + рендер на фронте. |
| Эталон расписания | `feed-digest.cron.ts` ([:17](../../backend/src/modules/activity-feed/cron/feed-digest.cron.ts), `@Cron('0 9 * * *', { timeZone: 'Europe/Moscow' })`) — **но это заглушка** («доставка TODO», [:60](../../backend/src/modules/activity-feed/cron/feed-digest.cron.ts)). Реальный эталон доставки — `probe-digest.cron.ts` (группировка по получателю → `conversational.sendNotification`). | Берём `@Cron` + `timeZone:'Europe/Moscow'` из feed-digest, паттерн доставки — из probe-digest. Час делаем крутилкой (hourly-tick + MSK-gate, см. ниже). |
| Час кронов как AdminSetting | **Не введён** (реестр не-сделано, строка D4 2026-06-22): юзер-facing кроны переведены на фикс `timeZone:'Europe/Moscow'`, параметризуемый час отложен в vNext «hourly-tick + крутилка-часа при запросе». | Владелец теперь **явно запросил** крутилку-часа для этой рассылки → реализуем hourly-tick + MSK-gate именно здесь. Закрывает D4 для этого крона. |
| Задачи (модель) | `Issue` + `IssueAssignee` + `IssueState`. `IssueState.category ∈ {backlog, unstarted, started, completed, cancelled}` ([schema.prisma](../../backend/prisma/schema.prisma), якорь `model IssueState`). `Issue`: `tenantId`, `stateId?`, `dueDate?`, `completedAt?`, `priority` (`urgent\|high\|medium\|low\|none`), `deletedAt?`, индексы `@@index([tenantId, stateId, deletedAt])`, `@@index([tenantId, dueDate])`. `IssueAssignee` (`@@unique([issueId,userId])`, `@@index([userId])`). | «Открытая» = `deletedAt IS NULL` И (`stateId IS NULL` ИЛИ `state.category NOT IN ('completed','cancelled')`). Получатель = `IssueAssignee.userId`. |
| Перечисление сотрудников | `Membership` (`@@unique([orgId,userId])`, `role`, нет поля «активность»). Деактивация = `User.deletedAt`. | «Активный сотрудник» = `Membership` join `User WHERE user.deletedAt IS NULL`. Нужно для рассылки «всё чисто» тем, у кого 0 задач. |
| Дедуп (повторная отправка) | `Notification`: `tenantId`, `recipientUserId`, `eventType`, `createdAt`, `@@index([tenantId, recipientUserId, status])`. | **Новой таблицы не нужно.** Дедуп = «есть ли уже `tasks.daily_open` для (tenant,user) с `createdAt >= началоСутокМСК`». |
| Модульная зависимость | `ConversationalModule` — `@Global()` и **экспортирует** `ConversationalService` ([conversational.module.ts:100/:134](../../backend/src/modules/conversational/conversational.module.ts)); сам импортирует `TrackerModule` ([:102](../../backend/src/modules/conversational/conversational.module.ts)). `TrackerModule` его **не** импортирует. | Cron кладём в `tracker/workers/`, инжектим **глобальный** `ConversationalService` напрямую — **цикла нет** (tracker не импортирует conversational). |
| Admin-настройки | Реестр-валидатор `Map<key, ZodTypeAny>` ([admin-setting-schema-registry.ts:9](../../backend/src/modules/admin/settings/admin-setting-schema-registry.ts)); UI-метаданные (category/section/description/default) — в сидах `seed-admin-setting-*.ts` (образец [seed-admin-setting-tracker.ts](../../backend/scripts/seed-admin-setting-tracker.ts)); UI — декларативный `DomainSettingsClient` + `SettingsGroup[]` (образец [TrackerSettingsClient.tsx](../../frontend/app/(admin)/admin/tracker/TrackerSettingsClient.tsx)). Чтение в коде — `cfg.getDynamic<T>(key, undefined, codeFallback)`. | Добавляем 5 ключей: реестр-валидатор + сид + UI-группа; в коде читаем через `getDynamic` с code-fallback (работает до сида — Ship-On). |
| Фронт-рендер уведомления | Список показывает `n.eventTypeLabel` (карта `EVENT_TYPE_LABELS` в [domain/conversational.ts:78](../../frontend/src/domain/conversational.ts)). Детали `NotificationDetail` рендерят `payload.title/body/summary` дженериком ([NotificationsClient.tsx:360-376](../../frontend/app/(authenticated)/me/notifications/NotificationsClient.tsx)). | Добавляем label + выделенный рендер сгруппированного списка для `tasks.daily_open`. |

**Главный вывод REALITY-CHECK:** фича на ~80% лежит на готовом. **Новых Prisma-моделей/колонок/миграций нет** (→ нет Шага 4 prod-deploy). Новое: 1 cron + 1 сервис-строитель + payload-схема + 3 case в адаптерах + фронт (label+рендер) + 5 AdminSetting-ключей (реестр+сид+UI).

---

## Принятые решения владельца (НЕ пересматривать)

| # | Решение | Обоснование (почему так) |
|---|---|---|
| В1 | **Содержание = ВСЕ открытые задачи сотрудника** (не «топ-N», не «только горящие»). Группировка для читабельности, но показываем все. | Владелец 2026-06-29: «Все мои открытые задачи… чтобы спланировать день». Лимит «и ещё N» — только защита от патологически длинных списков, дефолт высокий (50). |
| В2 | **Получатель = каждый сотрудник про СВОИ задачи** (где он `IssueAssignee`). Руководительский разрез по команде — вне scope. | Владелец 2026-06-29: «Каждый про свои». Командный разрез — отдельная фича (роли/права/агрегация). |
| В3 | **Пустой день → слать «всё чисто»** (а не молчать). | Владелец 2026-06-29: «Слать всё чисто». Предсказуемый утренний ритм. Следствие: перечисляем ВСЕХ активных сотрудников, не только тех, у кого есть задачи. |
| В4 | **Каналы = колокольчик (in_app) + почта (email_smtp) + Telegram (+ MAX) одновременно**, и набор каналов, и час — **крутилки в админке владельца**, не в коде/ENV. | Владелец 2026-06-29: «И в почту, и в колокольчик, и в телеграм… по-хорошему настраиваемое в главной админке». |
| В5 | **Дефолт — ВКЛючён (Ship-On).** Каналы по умолчанию включены, не OFF. | CLAUDE.md принцип №8. Был инцидент `operations.daily_digest.deliver_to_telegram=false` (молча не работал, реестр не-сделано 2026-06-15) — не повторяем. |
| В6 | **Время — утром по МСК.** Конкретный час — из админки, дефолт 09:00 МСК. | Владелец 2026-06-29 + согласованность с `feed-digest` (09:00 МСК). |

---

## Доказательство выбора (два прохода + challenge-loop)

**Проход A (выбран):** cron в `tracker/workers/` → ежечасный тик с `timeZone:'Europe/Moscow'` + гейт по часу-крутилке (MSK) → перечисление активных сотрудников по тенантам → сбор открытых задач по assignee → группировка → дедуп по существующей `Notification` → `conversational.sendNotification` с `preferredChannelKinds` из AdminSetting. Рендер — case в адаптерах. **Без новых таблиц, без нового модуля, без очереди.**

**Проход B (отвергнут):** новая таблица-подписка `MorningDigestSubscription` (по образцу `ActivityFeedSubscription`) + фикс `@Cron('0 9 * * *','Europe/Moscow')` + пер-юзерные BullMQ-jobs на доставку.
*Ось различия:* модель данных (новая таблица) + синхронность (очередь vs цикл) + конфигурируемость часа (фикс vs крутилка).

| Критерий (= ограничение фичи) | A | B |
|---|---|---|
| Час рассылки — крутилка в админке (В4/В6) | ✓ hourly-tick+gate | ✗ фикс в коде |
| Без новой миграции/таблицы | ✓ дедуп по `Notification` | ✗ новая таблица + Шаг 4 |
| Ship-On без раскатки (В5) | ✓ getDynamic+code-fallback | ✓ |
| Идемпотентность повторного прогона | ✓ проверка `Notification` за сутки | ✓ run-таблица |
| Переиспользование «почтальона» | ✓ | ✓ |
| Масштаб «тысячи сотрудников/тенант» | ⚠️ синхронный цикл (ок при текущих ~единицах юзеров) | ✓ очередь |
| Сложность/объём | ✓ минимум кода | ✗ +таблица +воркер +миграция |

**Вывод:** A выигрывает по всем ограничениям, кроме гипотетического масштаба. Очередь B — преждевременная оптимизация под несуществующую нагрузку (прод ~единицы юзеров на тенант).

**Challenge-loop по A:**
1. *Корень, не симптом?* Да — даёт класс «проактивный утренний план задач», а не один кейс уведомления.
2. *Самое эффективное?* Да при текущем масштабе; синхронный цикл по N сотрудникам раз в сутки — копейки. **Числовой триггер пересмотра:** когда у одного тенанта станет **> 2000 активных сотрудников** — вынести доставку в BullMQ-очередь (пер-юзер job). Зафиксировать в `04_не-сделано` при выкате.
3. *Код ради кода?* Нет — переиспользуем `ConversationalService`, адаптеры, `AdminSetting`, `DomainSettingsClient`. Новой инфраструктуры ноль.

---

## Scope

### Входит
- Новый `eventType` **`tasks.daily_open`**: Zod-payload в реестре + дефолтная канальная политика.
- Сервис-строитель сводки (перечисление активных сотрудников по тенантам, сбор открытых задач по assignee, группировка, лимит, пустой случай) — чистая логика, юнит-тестируемая.
- Cron `MorningTasksDigestCron` в `tracker/workers/`: ежечасный тик (МСК) + гейт по часу + kill-switch + дедуп + отправка.
- Рендер `tasks.daily_open` в адаптерах telegram / max / email.
- Фронт: `eventTypeLabel` + выделенный рендер сгруппированного списка в `NotificationDetail`.
- 5 AdminSetting-ключей `tracker.morningDigest.*`: реестр-валидатор + сид + UI-группа в трекерных настройках; регистрация сида в `apply-prod-deploy.ts`.
- Метрика prom-client + строки в `feature-flags.md` и `prod-deploy-log.md`; обновление second-brain.

### Не входит (с судьбой каждого хвоста)
- **Руководительский/командный разрез** («сводка закрытых/открытых по команде директору») → vNext, отдельное ТЗ (роли + агрегация + права). Решение В2.
- **Вынос доставки в BullMQ-очередь** → vNext, числовой триггер «>2000 активных сотрудников/тенант» (challenge-loop Q2). Строка в `04_не-сделано` при выкате.
- **Вечерний отчёт / дайджест закрытых задач** → не запрошено; отдельная фича.
- **Пер-юзерная подписка/отписка от утренней сводки в личном кабинете** → vNext. На MVP действует существующий механизм `eventTypeDeny`/`eventTypeAllow` в user-prefs «почтальона» ([conversational.service.ts:849](../../backend/src/modules/conversational/conversational.service.ts)) — кто отписался, тот не получит; UI настройки — позже.
- **Перевод ВСЕХ кронов на крутилку-часа** → остаётся как D4 vNext; здесь делаем только для этого крона.

### Граничные контракты с другими ТЗ
- `ConversationalService.sendNotification` — **используем как есть**, не меняем сигнатуру и не трогаем бюджет/политику push. Наш вклад в [conversational.service.ts](../../backend/src/modules/conversational/conversational.service.ts) — ровно одна строка в `EVENT_TYPE_CHANNEL_POLICY`.
- `IssueAssignmentNotifierService` / `IssueOverdueDetectorCron` — **не трогаем**; наша рассылка ортогональна (проактивный список, а не событие).
- AdminSetting-инфраструктура (`admin-settings.service`, `DomainSettingsClient`) — **используем как есть**, добавляем только данные.

---

## Контракты (canon для копипасты)

### К1. Payload-схема `tasks.daily_open` (event-payload.registry.ts)
Добавить в [event-payload.registry.ts](../../backend/src/modules/conversational/types/event-payload.registry.ts) (рядом с другими схемами) и зарегистрировать в карте (где `['issue.assigned', IssueAssignedPayloadSchema]` и т.п., якорь `['issue.assigned'`):

```ts
const TasksDailyOpenItemSchema = z
  .object({
    issueId: z.string().min(1).max(80),
    identifier: z.string().min(1).max(40),      // PROJ-123
    title: z.string().min(1).max(300),
    dueDate: z.string().max(40).nullable().optional(), // ISO или null
    priority: z.enum(['urgent', 'high', 'medium', 'low', 'none']),
    actionUrl: z.string().min(1).max(300),
  })
  .strict();

const TasksDailyOpenGroupSchema = z
  .object({
    key: z.enum(['overdue', 'due_today', 'in_progress', 'backlog']),
    label: z.string().min(1).max(60),
    items: z.array(TasksDailyOpenItemSchema).max(500),
  })
  .strict();

const TasksDailyOpenPayloadSchema = z
  .object({
    dateMsk: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    isEmpty: z.boolean(),
    total: z.number().int().nonnegative(),       // всего открытых задач
    shownCount: z.number().int().nonnegative(),  // сколько вошло в группы
    overflowCount: z.number().int().nonnegative(),// «и ещё N» (total - shownCount)
    title: z.string().min(1).max(120),           // «Ваши задачи на сегодня»
    actionUrl: z.string().min(1).max(300),       // ссылка «открыть все»
    groups: z.array(TasksDailyOpenGroupSchema).max(4),
  })
  .strict();
```
Регистрация: `['tasks.daily_open', TasksDailyOpenPayloadSchema]`.
> ⚠️ `body`/`summary` в payload **намеренно нет** — текст строят адаптеры/фронт из `groups` (нет дублирующего дженерик-блока на фронте).
> ⚠️ Без регистрации `validateEventPayload` уходит в мягкий `LiberalPayloadSchema` ([:335](../../backend/src/modules/conversational/types/event-payload.registry.ts), якорь `registry.get(eventType) ?? LiberalPayloadSchema`) — контракт не проверяется. Поэтому регистрация **обязательна**: именно она делает payload строгим (негатив-тест в Ф0 это проверяет).

### К2. Дефолтная канальная политика (conversational.service.ts)
В `EVENT_TYPE_CHANNEL_POLICY` ([:60](../../backend/src/modules/conversational/conversational.service.ts)) добавить строку (фактически перекрывается `preferredChannelKinds`, но нужна как безопасный дефолт):
```ts
'tasks.daily_open': ['in_app', 'email_smtp', 'telegram_bot', 'max_bot'],
```

### К3. AdminSetting-ключи `tracker.morningDigest.*`
| Ключ | Тип (валидатор реестра) | Code-fallback | Назначение | Тип флага |
|---|---|---|---|---|
| `tracker.morningDigest.enabled` | `z.boolean()` | `true` | Kill-switch всей рассылки | (а) аварийный рубильник |
| `tracker.morningDigest.hourMsk` | `z.number().int().min(0).max(23)` | `9` | Час рассылки по МСК | крутилка |
| `tracker.morningDigest.channels` | `z.array(z.enum(['in_app','email_smtp','telegram_bot','max_bot','push']))` | `['in_app','email_smtp','telegram_bot','max_bot']` | Набор активных каналов | крутилка |
| `tracker.morningDigest.maxItemsTotal` | `z.number().int().min(1).max(500)` | `50` | Защитный лимит «и ещё N» | крутилка |
| `tracker.morningDigest.sendWhenEmpty` | `z.boolean()` | `true` | Слать «всё чисто», если задач нет (В3) | крутилка |

Чтение в коде — строго `await cfg.getDynamic<T>('tracker.morningDigest.X', undefined, <fallback>)` (как [probe-digest.cron.ts:43](../../backend/src/modules/probe/probe-digest.cron.ts), якорь `getDynamic<number>('probe.digestHourUtc'`). **Никаких `process.env`.**

### К4. Группировка и «открытость» (детерминированные правила)
Открытая задача: `Issue.deletedAt IS NULL` И (`stateId IS NULL` ИЛИ `state.category ∉ {'completed','cancelled'}`).
Группы (порядок и определение; задача попадает ровно в одну, проверять сверху вниз):

| key | label (RU) | Условие |
|---|---|---|
| `overdue` | «Просрочено» | `dueDate != null` И `dueDate < началоСутокМСК` |
| `due_today` | «Срок сегодня» | `dueDate != null` И `началоСутокМСК ≤ dueDate < началоЗавтраМСК` |
| `in_progress` | «В работе» | `state.category == 'started'` |
| `backlog` | «Запланировано» | всё остальное открытое (`backlog`/`unstarted`/`stateId == null`) |

Сортировка внутри группы: `priority` desc (`urgent>high>medium>low>none`), затем `dueDate` asc (null — в конец), затем `identifier` asc.
Лимит: если `total > maxItemsTotal` — берём первые `maxItemsTotal` в порядке групп выше, `overflowCount = total - shownCount`, иначе `overflowCount = 0`.
Пустой случай (`total == 0`): `isEmpty=true`, `groups=[]`, и слать только если `sendWhenEmpty==true`.

### К5. Вычисление МСК (МСК = UTC+3, без DST)
```ts
// текущий час МСК для гейта:
const mskHour = Number(
  new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', hour12: false }).format(now),
); // 0..23
// дата МСК (для dateMsk и границ суток) через Intl 'en-CA' → 'YYYY-MM-DD':
const dateMsk = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(now);
const [y, m, d] = dateMsk.split('-').map(Number);
const startOfTodayMskUtc = new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - 3 * 3600_000);
const startOfTomorrowMskUtc = new Date(startOfTodayMskUtc.getTime() + 24 * 3600_000);
```

### К6. ASCII-поток
```
@Cron('0 * * * *', {timeZone:'Europe/Moscow'})  // тик в начале каждого МСК-часа
   └─ enabled? (getDynamic) ── нет ─> return
   └─ mskHour == hourMsk? ── нет ─> return
        └─ для каждого Org (tenant):
             членство активных (Membership × User.deletedAt IS NULL)
             открытые Issue этого tenant (deletedAt null, category∉done/cancel) + assignees
             группировка по userId
             └─ для каждого активного сотрудника:
                  уже слали сегодня? (Notification tasks.daily_open, createdAt≥началоСутокМСК) ── да ─> skip
                  задач 0 и !sendWhenEmpty ─> skip
                  payload = build(groups | empty)
                  channels = getDynamic(channels) (пусто → ['in_app'])
                  conversational.sendNotification({tenantId, recipientUserId, eventType:'tasks.daily_open',
                       payload, dataClass:'internal', preferredChannelKinds:channels, priorityTier:3})
```

---

## Границы фичи (локальные)
- ✅ **Always:** читать крутилки через `getDynamic` с code-fallback; `dataClass:'internal'`; идемпотентность через `Notification`-дедуп; tenant-изоляция (каждый запрос по `tenantId`); метрика на отправку; best-effort (падение по одному сотруднику не валит проход — try/catch внутри цикла, как probe-digest).
- ⚠️ **Ask first:** менять сигнатуру `sendNotification`; вводить новую таблицу/миграцию; слать на другие eventType; трогать бюджет push.
- 🚫 **Never:** `process.env.*` мимо `env.schema.ts`; `new PrismaClient()` в скрипте (только `createPrismaClient()`); дефолт каналов OFF; слать деактивированным (`User.deletedAt != null`) или вне их тенанта; английские слова в UI/текстах сотруднику.

---

## Требования (R), EARS

- **R1.** Когда наступает начало МСК-часа, **система** shall запускать `MorningTasksDigestCron.tick()`.
- **R2.** Если `tracker.morningDigest.enabled == false`, то **система** shall немедленно завершить проход без отправок.
- **R3.** Если текущий МСК-час ≠ `tracker.morningDigest.hourMsk`, то **система** shall завершить проход без отправок.
- **R4.** Когда проход активен, **система** shall перечислить всех сотрудников с активным `Membership` и `User.deletedAt IS NULL`, по каждому тенанту отдельно.
- **R5.** Когда для сотрудника собираются задачи, **система** shall включить ровно те `Issue`, где он `IssueAssignee`, `Issue.deletedAt IS NULL`, и состояние не `completed`/`cancelled` (включая `stateId == null`), в рамках его тенанта.
- **R6.** Когда задачи собраны, **система** shall разложить их по группам `overdue/due_today/in_progress/backlog` по правилам §К4 и отсортировать внутри группы.
- **R7.** Если число открытых задач > `tracker.morningDigest.maxItemsTotal`, то **система** shall показать первые N по порядку групп и проставить `overflowCount = total − N`.
- **R8.** Если у сотрудника 0 открытых задач и `sendWhenEmpty == true`, то **система** shall отправить уведомление с `isEmpty=true`; если `sendWhenEmpty == false` — не отправлять.
- **R9.** Если для пары (tenant, сотрудник) уже существует `Notification` c `eventType='tasks.daily_open'` и `createdAt ≥ началоСутокМСК`, то **система** shall пропустить отправку (идемпотентность).
- **R10.** Когда уведомление отправляется, **система** shall вызвать `sendNotification` с `eventType='tasks.daily_open'`, `dataClass='internal'`, `preferredChannelKinds` = `tracker.morningDigest.channels` (пустой массив → `['in_app']` + warn).
- **R11.** Когда уведомление доставляется, **система** shall отрендерить человекочитаемый текст из `payload.groups` в каналах telegram/max/email и в кабинете (in_app), на русском, без английских слов.
- **R12.** Когда отправка по одному сотруднику падает, **система** shall залогировать и продолжить остальных (ошибка одного не прерывает проход).
- **R13.** Когда отправка поставлена в очередь, **система** shall инкрементировать метрику prom-client с label'ом `isEmpty`.

---

## Фазы

Граф зависимостей: **Ф0 → Ф1 → Ф2**; **Ф3, Ф4 зависят от Ф0** (контракт payload), параллельны Ф2 и друг другу; **Ф5 зависит от Ф0** (ключи) и логически до прод-выката; **Ф6** — финал после Ф1–Ф5. Строгий порядок только Ф0→Ф1→Ф2. Ф3/Ф4/Ф5 можно вести параллельной волной после Ф0.

### Ф0 — Контракты: eventType + AdminSetting-ключи `[ ]`
**Ценность:** как «почтальон» и админ-слой, получаю валидируемый контракт `tasks.daily_open` и зарегистрированные крутилки, чтобы остальные фазы опирались на канон.
**Цель:** добавить payload-схему (§К1), строку политики (§К2), 5 валидаторов в реестр (§К3).
**Что входит:** правки [event-payload.registry.ts](../../backend/src/modules/conversational/types/event-payload.registry.ts), [conversational.service.ts](../../backend/src/modules/conversational/conversational.service.ts) (одна строка политики), [admin-setting-schema-registry.ts](../../backend/src/modules/admin/settings/admin-setting-schema-registry.ts) (5 строк).
**Что НЕ входит:** cron, логика сбора, рендер, сид, UI.
**Файлы:** 3 указанных.
**Acceptance:**
- `grep -n "tasks.daily_open" backend/src/modules/conversational/types/event-payload.registry.ts` → ≥2 совпадения (схема + регистрация).
- `grep -n "tracker.morningDigest" backend/src/modules/admin/settings/admin-setting-schema-registry.ts` → 5 строк.
- `bun run typecheck` зелёный.
- Негатив: `validateEventPayload('tasks.daily_open', { groups: 'oops' })` бросает (проверить юнит-тестом или в Ф6).
**Закрывает:** R10 (контракт), частично R3/R7/R8 (ключи).

### Ф1 — Сервис-строитель `MorningTasksDigestService` (чистая логика) `[ ]`
**Ценность:** как воркер задачного трекера, получаю детерминированный сборщик «открытые задачи сотрудника → сгруппированный payload», чтобы cron остался тонким и логика была юнит-тестируема.
**Цель:** сервис без побочных эффектов доставки: методы перечисления активных сотрудников по тенанту, сбора открытых задач по assignee, группировки (§К4), сборки payload (включая пустой случай и overflow).
**Что входит:** новый файл `backend/src/modules/tracker/services/morning-tasks-digest.service.ts`; провайдер в [tracker.module.ts](../../backend/src/modules/tracker/tracker.module.ts) (providers, рядом с другими сервисами). Зависимости: `PrismaService`, `TypedConfigService`. Экспорт чистых функций группировки для тестов.
**Что НЕ входит:** `@Cron`, `sendNotification`, дедуп (это Ф2).
**Файлы:** `services/morning-tasks-digest.service.ts`, `tracker.module.ts`.
**Контракт метода (ориентир):**
```ts
buildPayloadForUser(args: {
  tenantId: string; userId: string;
  openIssues: OpenIssueRow[];   // уже отфильтрованные открытые задачи assignee
  now: Date; maxItemsTotal: number;
}): TasksDailyOpenPayload   // groups/total/shownCount/overflowCount/isEmpty/dateMsk/title/actionUrl
```
`actionUrl` задачи = `/issues/${issueId}` (роут существует, используется в `issue.assigned`); payload-level `actionUrl` = `/tasks` (роут `frontend/app/(authenticated)/tasks` существует — список задач сотрудника). Развилка закрыта: оба роута проверены по факту.
**Acceptance:**
- Юнит-тест `morning-tasks-digest.service.spec.ts`: вход с задачами в 4 категориях → корректное распределение и порядок групп (пример вход→выход в тесте).
- Пустой вход → `isEmpty=true, total=0, groups=[]`.
- `total=60, maxItemsTotal=50` → `shownCount=50, overflowCount=10`.
- Просрочка: `dueDate` вчера МСК → группа `overdue`; сегодня МСК → `due_today`.
- `bun run typecheck` + `bunx vitest run backend/src/modules/tracker/services/morning-tasks-digest.service.spec.ts` зелёные.
**Закрывает:** R5, R6, R7, R8 (сборка пустого).

### Ф2 — Cron `MorningTasksDigestCron` (тик + гейт + дедуп + отправка) `[ ]`
**Ценность:** как сотрудник, получаю утром одно уведомление со своими задачами, потому что cron в нужный МСК-час собирает и отправляет сводку через «почтальона».
**Цель:** ежечасный `@Cron('0 * * * *', { timeZone: 'Europe/Moscow' })` → kill-switch → гейт по часу (§К5) → перечисление активных сотрудников → дедуп (§К6) → `conversational.sendNotification` с `preferredChannelKinds` из настроек → метрика. Best-effort per-user (try/catch).
**Что входит:** новый `backend/src/modules/tracker/workers/morning-tasks-digest.cron.ts`; провайдер в [tracker.module.ts](../../backend/src/modules/tracker/tracker.module.ts) (рядом с `IssueOverdueDetectorCron`, якорь `IssueOverdueDetectorCron,`). Инжект **глобального** `ConversationalService` (импорт типа из `../../conversational/conversational.service`; модуль НЕ импортировать — он `@Global`). Метрика: добавить счётчик в `BusinessMetricsService` (например `incMorningTasksDigest({ isEmpty })`) — по образцу существующих `inc*` в [business-metrics.service.ts](../../backend/src/common/metrics/business-metrics.service.ts).
**Что НЕ входит:** группировка (из Ф1), рендер текста (Ф3), UI (Ф4), сид (Ф5).
**Файлы:** `workers/morning-tasks-digest.cron.ts`, `tracker.module.ts`, `common/metrics/business-metrics.service.ts`.
**Acceptance:**
- `grep -n "Europe/Moscow" backend/src/modules/tracker/workers/morning-tasks-digest.cron.ts` → есть; `grep -n "getUTCHours" …` → **нет** (час берём через Intl МСК, не UTC).
- `grep -n "MorningTasksDigestCron" backend/src/modules/tracker/tracker.module.ts` → есть в providers.
- Спек `morning-tasks-digest.cron.spec.ts`: при `mskHour != hourMsk` — `sendNotification` не вызывается (мок); при совпадении и наличии задач — вызывается с `eventType='tasks.daily_open'` и `preferredChannelKinds` из настроек; повторный прогон в тот же день (есть Notification) — skip.
- `bun run typecheck` (вкл. `.spec`) + `bun run lint` + `bunx vitest run …cron.spec.ts` зелёные.
**Закрывает:** R1, R2, R3, R4, R9, R10, R12, R13.

### Ф3 — Рендер `tasks.daily_open` в каналах (telegram / max / email) `[ ]`
**Ценность:** как сотрудник, читаю аккуратный список задач в Telegram/MAX/почте, а не «Уведомление: tasks.daily_open».
**Цель:** добавить `case 'tasks.daily_open':` в `renderText` ([telegram-bot.adapter.ts:1131](../../backend/src/modules/conversational/adapters/telegram-bot/telegram-bot.adapter.ts), [max-bot.adapter.ts:868](../../backend/src/modules/conversational/adapters/max-bot/max-bot.adapter.ts)) и в `subjectFor`+`renderPlainText` ([email-smtp.adapter.ts:63/:76](../../backend/src/modules/conversational/adapters/email-smtp.adapter.ts)). Текст строить из `payload.groups`: заголовок + по группам (label + строки `IDENTIFIER — title [· срок]`), хвост `+ ещё N` при `overflowCount>0`; пустой (`isEmpty`) → «На сегодня открытых задач нет — хорошего дня». Telegram/MAX — HTML с `escapeHtml`, обрезка `.slice(0,4000)` (как соседние case). Email — plain + ссылка `actionUrl`.
**Что входит:** 3 адаптера. **Что НЕ входит:** фронт (Ф4), payload (Ф0).
**Файлы:** telegram-bot.adapter.ts, max-bot.adapter.ts, email-smtp.adapter.ts.
**Acceptance:**
- `grep -n "tasks.daily_open" backend/src/modules/conversational/adapters/telegram-bot/telegram-bot.adapter.ts backend/src/modules/conversational/adapters/max-bot/max-bot.adapter.ts backend/src/modules/conversational/adapters/email-smtp.adapter.ts` → совпадение в каждом (для email — в `subjectFor` и `renderPlainText`).
- Юнит/инлайн-проверка: payload c 2 группами → текст содержит оба `identifier`; `isEmpty=true` → текст «открытых задач нет»; никаких английских слов.
- `bun run typecheck` зелёный.
**Закрывает:** R11 (каналы).

### Ф4 — Фронт: label + рендер сводки в кабинете `[ ]`
**Ценность:** как сотрудник, открываю уведомление в кабинете и вижу сгруппированный список задач со ссылками, а не сырой payload.
**Цель:** (1) добавить `'tasks.daily_open': 'Задачи на сегодня'` в `EVENT_TYPE_LABELS` ([domain/conversational.ts:78](../../frontend/src/domain/conversational.ts)); (2) выделенный рендер в `NotificationDetail` ([NotificationsClient.tsx:260](../../frontend/app/(authenticated)/me/notifications/NotificationsClient.tsx)) — если `n.eventType==='tasks.daily_open'`, отрисовать группы (label + список задач-ссылок на `/issues/${issueId}`, бейдж приоритета, срок), пустой случай — «всё чисто». Слои `ApiDto→DomainModel→UiModel`, парные токены `bg-*`/`text-*-fg`, без `text-white`/hex.
**Что входит:** 2 файла фронта. **Что НЕ входит:** новые API-вызовы (payload уже приходит в `mapNotificationDetail`).
**Файлы:** `frontend/src/domain/conversational.ts`, `frontend/app/(authenticated)/me/notifications/NotificationsClient.tsx`.
**Acceptance:**
- `grep -n "tasks.daily_open" frontend/src/domain/conversational.ts frontend/app/(authenticated)/me/notifications/NotificationsClient.tsx` → есть в обоих.
- `cd frontend && bun run typecheck && bun run lint` зелёные.
- Playwright/визуально (в Ф6): уведомление показывает группы и ссылки; пустое — «всё чисто».
**Закрывает:** R11 (in_app).

### Ф5 — AdminSetting: сид + UI + регистрация в прод-агрегаторе `[ ]`
**Ценность:** как владелец, в админке включаю/выключаю рассылку, меняю час и каналы — без правки кода.
**Цель:** (1) новый сид `backend/scripts/seed-admin-setting-morning-tasks-digest.ts` (5 ключей §К3, category `'ai'`/section `'tracker'` или category `'tracker'`/section `'workers'` — по образцу [seed-admin-setting-tracker.ts](../../backend/scripts/seed-admin-setting-tracker.ts), `createPrismaClient()`, защита admin-edited); (2) группа в [TrackerSettingsClient.tsx](../../frontend/app/(admin)/admin/tracker/TrackerSettingsClient.tsx) (`SettingsGroup` «Утренняя сводка задач» с 5 spec'ами; для `channels` — мульти-селект/массив, schema `z.array(z.enum([...]))`); (3) регистрация сида в `STEPS` [apply-prod-deploy.ts](../../backend/scripts/apply-prod-deploy.ts): строка `{ phase: 'seed-base', script: 'scripts/seed-admin-setting-morning-tasks-digest.ts' }` (рядом с `seed-admin-setting-daily-digest.ts`, якорь `seed-admin-setting-daily-digest`).
**Что входит:** сид, UI-группа, STEPS. **Что НЕ входит:** логика крона (Ф2).
**Файлы:** новый seed, TrackerSettingsClient.tsx, apply-prod-deploy.ts.
**Acceptance:**
- `grep -n "tracker.morningDigest" backend/scripts/seed-admin-setting-morning-tasks-digest.ts` → 5 ключей.
- Идемпотентность: повторный прогон сида → `created=0` (no-op) + не перетирает admin-edited (как образец).
- `grep -n "morning-tasks-digest" backend/scripts/apply-prod-deploy.ts` → есть в STEPS.
- `grep -n "Утренняя сводка" frontend/app/(admin)/admin/tracker/TrackerSettingsClient.tsx` → есть.
- `bun run typecheck` (backend+frontend) зелёный; `bunx tsx backend/scripts/seed-admin-setting-morning-tasks-digest.ts` — dry-проверка синтаксиса (если есть локальная БД; иначе typecheck).
**Закрывает:** R7/R8/R10 (значения крутилок), В4/В5/В6.

### Ф6 — Документация, метрики-флаги, верификация `[ ]`
**Ценность:** как команда, имею прод-инструкцию, реестр флага и обновлённый second-brain, чтобы фича была сопровождаема.
**Цель:** дописать `feature-flags.md` (kill-switch `tracker.morningDigest.enabled` + крутилки), `prod-deploy-log.md` (Шаг 1 — новый сид/настройки, Шаг 12 — smoke grep по cron/eventType), second-brain (`01_projects/tracker.md`, `01_projects/ai-jobs.md`/`workers-queues.md` — новый cron, `01_projects/api-layer.md` — новый eventType если описывается, `04_не-сделано` — vNext: командный разрез, BullMQ-очередь при >2000), рефлексия.
**Что входит:** только docs/second-brain. **Файлы:** перечисленные.
**Acceptance:**
- `grep -ril "tracker.morningDigest.enabled" docs/operations/feature-flags.md` → есть.
- `grep -ril "morning-tasks-digest\|tasks.daily_open" docs/operations/prod-deploy-log.md` → есть.
- second-brain обновлён по таблице производных заметок (см. DoD).
**Закрывает:** DoD-документация, V-триггеры vNext.

---

## Pre-mortem / Риски и ревью-аспекты

| Риск | Митигизация (в фазе) |
|---|---|
| **Двойная отправка** при рестарте/двух инстансах в тот же час | Дедуп по `Notification` за МСК-сутки (R9, Ф2). Acceptance проверяет повтор → skip. |
| **Спам «всё чисто»** большим оркам | Текущий масштаб ~единицы юзеров; крутилка `sendWhenEmpty` (дефолт true по В3) позволяет выключить. |
| **Список-простыня** у активных юзеров | `maxItemsTotal` (дефолт 50) + `overflowCount` «и ещё N» (R7). |
| **Отправка ex-сотрудникам** | Фильтр `User.deletedAt IS NULL` (R4, 🚫-граница). |
| **Час по UTC вместо МСК** (грабля D4) | Час через `Intl … timeZone:'Europe/Moscow'`, не `getUTCHours` (Acceptance Ф2 грепает отсутствие `getUTCHours`). |
| **Циклическая зависимость модулей** | Cron в tracker инжектит `@Global` ConversationalService; TrackerModule НЕ импортирует ConversationalModule (REALITY-CHECK). |
| **Каналы выключены в ноль** | Пустой `channels` → `['in_app']` + warn (R10). Kill-switch отдельно (`enabled`). |
| **Падение по одному юзеру валит проход** | try/catch per-user (R12), как probe-digest. |

**Ревью-аспекты для `strict-production-review-gate`:** tenant-изоляция в запросах задач/членства; идемпотентность дедупа; отсутствие `process.env`/`new PrismaClient()`; отсутствие английского в текстах; метрика на отправку; best-effort обработка ошибок; дефолты Ship-On (ON).

## Сквозные аспекты (чек анти-забывания)
- **RBAC/tenant:** все запросы `Issue`/`Membership`/`Notification` фильтруются по `tenantId`; рассылка строго в рамках тенанта сотрудника. ✓ (Ф1/Ф2)
- **Observability:** prom-метрика `incMorningTasksDigest({isEmpty})` (Ф2) + логи pino best-effort. ✓
- **Errors + идемпотентность:** per-user try/catch (R12) + дедуп (R9). ✓
- **Миграция данных:** `[N/A: новых таблиц/колонок нет — дедуп по существующей Notification]`.
- **Rollout/флаг:** kill-switch `tracker.morningDigest.enabled` (Ship-On ON), строка в `feature-flags.md` (Ф6). ✓
- **Тесты:** юнит группировки (Ф1), спек гейта/дедупа крона (Ф2), рендер-проверка (Ф3), typecheck/lint фронта (Ф4). ✓

## Idempotency / Feature-flag / Prod-deploy
- **Idempotency:** (1) рассылка — дедуп по `Notification` (R9); (2) сид — upsert с защитой admin-edited, повторный прогон = no-op (Acceptance Ф5).
- **Feature-flag:** `tracker.morningDigest.enabled` — аварийный рубильник (тип «а»), дефолт ON; остальные 4 ключа — крутилки. Реестр — `feature-flags.md`.
- **Prod-deploy (diff к [prod-deploy-log.md](../../docs/operations/prod-deploy-log.md)):**
  - Шаг 1 (ENV/настройки): применить новый сид через агрегатор — `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update` (сид зарегистрирован в STEPS, Ф5). Отдельный прямой запуск НЕ нужен.
  - Шаг 12 (smoke): `docker compose exec backend grep -rl "tasks.daily_open" dist || true`; проверить лог cron `MorningTasksDigestCron` в нужный МСК-час.
  - Шаги 4/5/6/8/9/10 — **не затронуты** (нет схемы/SQL/patch/backfill/migrate/setup).

## DoD (общий чек качества)
- `bun run typecheck` (вкл. `.spec`), `bun run lint`, `bun run build` — зелёные (backend и frontend).
- Юнит/спеки Ф1–Ф2 зелёные (`bunx vitest run`).
- second-brain обновлён: `01_projects/tracker.md` (рассылка), `01_projects/workers-queues.md`+`ai-jobs.md` (новый cron), `01_projects/api-layer.md`/`frontend-pages.md` при необходимости; `04_не-сделано` — vNext-строки.
- `feature-flags.md` + `prod-deploy-log.md` обновлены (затронуты ENV-настройки/сид/cron).
- Рефлексия в `second-brain/05_история/2026-06-29-*.md`.
- Ни одного `process.env.*`/`new PrismaClient()`/`prisma migrate` в добавленном коде; UI/тексты — только русский.

## Итог
> Заполняет tz-orchestrator по завершении: реализовано целиком / остаток. Ожидаемо: cron + сервис + payload + 3 рендера + фронт(label+рендер) + 5 крутилок (реестр+сид+UI) + docs. Новых миграций нет.
