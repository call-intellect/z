---
type: tz
status: ready-to-implement
feature: telegram-channel-reachability-and-channels-ux-fix
date: 2026-06-05
owner: sergrv80@gmail.com (владелец Z)
relates_to:
  - plans/tz/2026-06-05-onboarding-owner-position-and-channels-entry.md
  - plans/tz/2026-05-25-telegram-bot-global-and-invites.md
  - second-brain/01_projects/conversational-channels.md
---
> Контекст исследован по коду в сессии 2026-06-05 (разбор «Telegram негде подключить» по двум скриншотам владельца). Развилки технические — закрыты в «Принятых решениях», вопросов владельцу нет, кроме операционного предусловия (реальный бот+токен) — оформлено как Ф0.

# ТЗ — Telegram: исправить «негде подключить» + UX-шум на «Мои каналы»

## Цель

Сделать так, чтобы собственник и сотрудники реально могли подключить Telegram, а страница «Мои каналы» (`/me/channels`) не вводила в заблуждение.

Три связанные проблемы (с приоритетом):
1. **Корень (бэкенд): глобальный Telegram-канал не виден пользователю.** `listMyChannels` отдаёт только каналы своей Org, а бот глобальный (`tenantId IS NULL`) → Telegram-карточка не рендерится → подключить негде.
2. **UI ведёт в тупик.** Карточка «Telegram» на «Я» и кнопка «Подключить» ведут на `/me/channels`, где Telegram-карточки нет; нет честного состояния «бот не настроен администратором».
3. **UX-шум на `/me/channels`:** канал «В личном кабинете» выглядит как «Привязан/подтверждено» (путают с Telegram); три радио «потолок чувствительности» без объяснения.

### Зачем

Telegram — основной канал доставки уведомлений (`telegram_bot` — первый приоритет в большинстве `eventType`, [conversational.service.ts](backend/src/modules/conversational/conversational.service.ts)). Если его нельзя подключить из интерфейса — собственник не получает отчёты и не понимает, как подключить команду. Предыдущее ТЗ [onboarding-owner-position-and-channels-entry](plans/tz/2026-06-05-onboarding-owner-position-and-channels-entry.md) добавило карточку «Telegram» на «Я» и сделало `/me/channels` каноном — но направило прямо в этот тупик и удалило `TelegramLinkSection` (которая показывала кнопку «Подключить» независимо от списка). Это ТЗ закрывает корень и достраивает честные состояния.

## REALITY-CHECK (что есть/сломано по факту — проверено по коду 2026-06-05)

**Корень — серверный фильтр:**
```ts
// backend/src/modules/conversational/conversational.service.ts:633 (метод listMyChannels)
const channels = await this.prisma.channel.findMany({
  where: { tenantId: args.tenantId, status: 'active' },   // ← глобальный (tenantId=NULL) канал НЕ попадает
  orderBy: { kind: 'asc' },
});
```
- Якорь: метод `async listMyChannels(args: {` (~стр. 624). **Номер строки на момент написания — перед правкой перечитать.**
- Глобальный Telegram-бот — единственная строка `Channel{ tenantId: NULL, kind: 'telegram_bot' }` (β-9). Подтверждение: [telegram-webhooks.controller.ts](backend/src/modules/conversational/adapters/telegram-bot/telegram-webhooks.controller.ts) `where: { tenantId: null, kind: 'telegram_bot' }`; миграция [backend/scripts/migrate-telegram-channels-to-global.ts](backend/scripts/migrate-telegram-channels-to-global.ts) (case А создаёт пустую глобальную строку `config={}`, status='active', если каналов нет).
- Контроллер [conversational.controller.ts:66-95](backend/src/modules/conversational/conversational.controller.ts#L66-L95) (`@Get('channels')`) маппит выход `listMyChannels` и отдаёт `channel.{id,kind,direction,status,maxDataClass}` + `binding`. **`config`/токен наружу НЕ отдаются** (правильно) — значит для состояния «бот не настроен» нужен **производный флаг**, т.к. `status` у пустого глобального канала всё равно `active`.
- Токен бота лежит в `Channel.config.botToken` (зашифрован), `botUsername` в `Channel.config.botUsername` (открытый) — [telegram-bot.adapter.ts](backend/src/modules/conversational/adapters/telegram-bot/telegram-bot.adapter.ts) (~стр. 1264-1272). Токена в ENV нет ([env.schema.ts:899](backend/src/common/config/env.schema.ts#L899)). Настраивает super-admin в `/admin/content/global-channels`.
- `generateLinkCode` ([conversational.service.ts](backend/src/modules/conversational/conversational.service.ts) ~стр. 735) **НЕ проверяет наличие канала** — всегда кладёт код в Redis. Значит без настроенного бота пользователь получит код и ссылку в никуда → нужен UI-guard «не настроен».

**Фронтенд:**
- [ChannelsClient.tsx:152](frontend/app/(authenticated)/me/channels/ChannelsClient.tsx#L152) рендерит `TelegramCard` только для entry с `kind==='telegram_bot'`; иначе Telegram-блока нет.
- `TelegramCard` ([ChannelsClient.tsx:301-462](frontend/app/(authenticated)/me/channels/ChannelsClient.tsx#L301-L462)) использует `mapTelegramChannelEntry` → `if (!view) return null`.
- Доменный маппер `mapTelegramChannelEntry` ([me-channels.ts:52-81](frontend/src/domain/me-channels.ts#L52-L81)) даёт статус `linked | not_linked | bot_blocked | channel_disabled`. Состояния «канал не настроен (нет токена)» НЕТ — добавить.
- Карточка «В личном кабинете» (in_app) ([ChannelsClient.tsx:198-227](frontend/app/(authenticated)/me/channels/ChannelsClient.tsx#L198-L227)) показывает «Привязан: `<externalId>` подтверждено …» — техномусор, путающий с Telegram.
- `MaxDataClassRadio` ([ChannelsClient.tsx:474-572](frontend/app/(authenticated)/me/channels/ChannelsClient.tsx#L474-L572)) — три радио без «зачем»; рисуется для любого binding, включая in_app.
- Карточка «Telegram» на «Я» [MyTelegramCard.tsx](frontend/app/(authenticated)/me/MyTelegramCard.tsx) — при отсутствии telegram-entry показывает `not_linked` → «Подключить Telegram» → ведёт на `/me/channels` (тупик).
- Deep-link username — `NEXT_PUBLIC_KORA_BOT_USERNAME` (по умолчанию `kora_bot`), [me-channels.api.ts:35-40](frontend/src/api/me-channels.api.ts#L35-L40). **Не** `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME`. Лучше брать `botUsername` из канала (см. Б2).

**Известное смежное (НЕ чинить здесь):** `resetTelegramBinding` → `POST /me/channels/telegram_bot/reset` на бэке НЕ реализован (404) — [me-channels.api.ts:53-68](frontend/src/api/me-channels.api.ts#L53-L68). Вне scope, см. «Не входит».

**Вывод:** правка серверного запроса (1 место) + производный флаг в ответе контроллера + honest-состояния и UX-копи на фронте. Изменений схемы Prisma НЕТ.

## Принятые решения (2026-06-05, технические — не пересматривать)

| # | Решение | Обоснование (Почему) |
|---|---|---|
| Б1 | `listMyChannels` включает глобальные **бот-каналы**: `where: { status: 'active', OR: [ { tenantId: args.tenantId }, { tenantId: null, kind: { in: ['telegram_bot','max_bot'] } } ] }`. | Бот глобальный (`tenantId=NULL`) — без этого карточка не появится. Ограничение `kind in (telegram_bot,max_bot)` — чтобы НЕ затащить глобальный SMTP/прочее на личную страницу. Дедуп kind гарантируется Ф0 (миграция оставляет один активный telegram-канал). |
| Б1b | **(находка картографии 2026-06-05)** ТОТ ЖЕ фильтр в `resolveBindings` ([conversational.service.ts](backend/src/modules/conversational/conversational.service.ts), ~стр. 886-898) — это путь ДОСТАВКИ уведомлений (`channel: { tenantId: args.tenantId, status: 'active' }`). Его тоже расширить тем же `OR`. | Иначе привязка к глобальному каналу пройдёт, но уведомления молча НЕ доставятся (verified binding к `tenantId=NULL` отфильтруется). Это один класс бага — чиним оба места разом ([[feedback_fix_the_whole_class_not_the_case]]). |
| Б2 | Контроллер для бот-каналов (`telegram_bot`/`max_bot`) добавляет в ответ `configured: boolean` (= непустой `config.botToken`) и `botUsername: string \| null` (из `config.botUsername`). **Токен наружу не отдаётся** — только булев флаг. | UI должен отличать «настроен/не настроен» (иначе тупик), а deep-link — брать реальный username канала, не угадывать из ENV. |
| Б3 | Доменный маппер `mapTelegramChannelEntry` получает новый статус `channel_not_configured` (когда `configured===false`); приоритет проверки: `not_configured` → `channel_disabled` → `not_linked` → `bot_blocked` → `linked`. | Честное состояние «бот не настроен администратором» вместо ложного «Не привязан → Подключить». |
| Б4 | В состоянии `channel_not_configured` UI (и `/me/channels`, и карточка «Я») НЕ показывает кнопку привязки, а показывает текст «Telegram пока не настроен администратором компании» (+ для owner/admin — ссылка на `/admin/content/global-channels`). | Убрать тупик: нельзя предлагать привязку к ненастроенному боту. |
| Б5 | Карточка in_app: убрать «Привязан: `<externalId>` подтверждено …», показать «Работает автоматически — отдельной настройки не требует»; `MaxDataClassRadio` на in_app не показывать. | in_app — внутренний канал, не Telegram; техномусор путает. |
| Б6 | `MaxDataClassRadio` для внешних каналов оставить, но свернуть под `<details>` «Дополнительно: какие данные можно слать в этот канал» + одна строка-пояснение «Обычно менять не нужно». | Снизить когнитивный шум для нетехнического собственника, не теряя функцию. |
| Б0 | Перед проверкой сквозного сценария прогнать идемпотентную миграцию `migrate-telegram-channels-to-global.ts` (гарантирует ровно один активный глобальный telegram-канал) и проверить наличие токена. Заведение реального бота+токена — операционное действие владельца/super-admin, НЕ код. | Б1 корректен только при отсутствии коллизии «per-tenant active + global». Существование настроенного бота — внешнее предусловие, его нельзя «дописать кодом». |

## Доказательство выбора (сжатый proof-loop)

**A (выбран):** точечно расширить серверный запрос + производный флаг `configured` в ответе + honest-состояния на фронте.
**B (отвергнут):** оставить серверный запрос как есть и на фронте всегда показывать «Подключить Telegram» (как делала удалённая `TelegramLinkSection`), не зная статуса канала. Отличие по оси «точка интеграции» (вся логика на клиенте, без знания состояния канала).

| Критерий | A (server-fix + флаг) | B (клиент всегда показывает кнопку) |
|---|---|---|
| Видит реальный глобальный канал | ✓ | ✗ (угадывает) |
| Отличает «не настроен» от «не привязан» | ✓ | ✗ ведёт в тупик при ненастроенном боте |
| Корректный deep-link username | ✓ (из канала) | ✗ (ENV-догадка `kora_bot`) |
| Объём правок | ✓ малый | ✓ малый |
| Чинит корень, а не симптом | ✓ | ✗ маскирует |

**Challenge-loop по A:** (1) Корень? — да, корень в серверном фильтре `listMyChannels`, чиним его, не маскируем. (2) Эффективнее? — да: один запрос + один флаг закрывают и видимость, и honest-состояния. (3) Код ради кода? — нет; `configured`/`botUsername` реально используются (guard + deep-link). Новый статус `channel_not_configured` устраняет тупик, а не добавляет задел.

## Scope

### Входит
- Серверный фикс `listMyChannels` (Б1) + производные `configured`/`botUsername` в ответе контроллера (Б2).
- Доменный статус `channel_not_configured` (Б3) и honest-UI на `/me/channels` и на карточке «Я» (Б4).
- Deep-link использует `botUsername` из канала с fallback на ENV (Б2).
- UX-копи in_app (Б5) и сворачивание `MaxDataClassRadio` (Б6).
- Предусловие-проверка Ф0 (миграция идемпотентно + проверка токена).

### Не входит (vNext / отложено)
- **Реализация `POST /me/channels/telegram_bot/reset`** (сейчас 404) — отдельная задача; здесь только не ломать существующий graceful-catch. Если понадобится — отдельное ТЗ `plans/tz/<date>-telegram-reset-binding.md`.
- **Создание реального @kora_bot в BotFather и ввод токена** — операционное действие владельца/super-admin (Ф0 это проверяет, но не выполняет в коде).
- **MAX-бот** end-to-end — `max_bot` включён в запрос Б1 «заодно», но его UX/настройку отдельно не трогаем.
- Изменения схемы Prisma, новые ENV, новые очереди.

### Граничные контракты
- Эндпоинт `POST /me/channels/:kind/link-code` и вебхук-привязка используются как есть. Меняется только `GET /me/channels` (добавление полей — обратносовместимо).
- `migrate-telegram-channels-to-global.ts` уже существует и идемпотентен — НЕ переписывать, только прогнать/проверить регистрацию в `apply-prod-deploy.ts` `STEPS`.

## Границы фичи

- ✅ **Always:** Zod-DTO + Swagger при изменении ответа; фронт `ApiDto→DomainModel→UiModel`; русский UI без англицизмов; парные токены; honest loading/empty/error.
- ⚠️ **Ask first:** любое расширение запроса сверх `telegram_bot`/`max_bot` (риск затащить чужие глобальные каналы); любые изменения процесса привязки/вебхуков.
- 🚫 **Never:** отдавать `botToken` (или любой секрет из `config`) в API; `process.env.*` в коде (только `TypedConfigService`); `prisma migrate`; англоязычные строки в UI; `text-white` на цветном/хардкод hex.

## Контракты (дословно)

### Б1 — серверный запрос (conversational.service.ts, метод `listMyChannels`)
```ts
const channels = await this.prisma.channel.findMany({
  where: {
    status: 'active',
    OR: [
      { tenantId: args.tenantId },
      { tenantId: null, kind: { in: ['telegram_bot', 'max_bot'] } },
    ],
  },
  orderBy: { kind: 'asc' },
});
```
Биндинги грузятся как раньше (`channelBinding.findMany({ where: { userId, channelId: { in: ids } } })`) — глобальный канал тоже попадёт по id.

### Б2 — ответ контроллера (`@Get('channels')`, маппинг `channel`)
Для kind ∈ {telegram_bot, max_bot} добавить производные поля (читать `channel.config` ВНУТРИ маппинга, наружу — только булев + username):
```ts
channel: {
  id: channel.id,
  kind: channel.kind,
  direction: channel.direction,
  status: channel.status,
  maxDataClass: channel.maxDataClass,
  // Б2 — только для бот-каналов; токен НЕ отдаём, лишь факт его наличия.
  ...(channel.kind === 'telegram_bot' || channel.kind === 'max_bot'
    ? {
        configured: Boolean((channel.config as Record<string, unknown> | null)?.botToken),
        botUsername:
          ((channel.config as Record<string, unknown> | null)?.botUsername as string | undefined) ?? null,
      }
    : {}),
},
```
Фронтовый тип `ChannelEntryApi.channel` расширить опциональными `configured?: boolean; botUsername?: string | null;` ([me-channels.api.ts](frontend/src/api/me-channels.api.ts) / [conversational.api.ts](frontend/src/api/conversational.api.ts) — где объявлен `ChannelEntryApi`).

### Б3 — доменный статус (me-channels.ts)
```ts
export type TelegramChannelStatus =
  | 'linked' | 'not_linked' | 'bot_blocked' | 'channel_disabled'
  | 'channel_not_configured';
// STATUS_LABELS['channel_not_configured'] = 'Не настроен';
// в mapTelegramChannelEntry, ПЕРВОЙ проверкой:
//   if (api.channel.configured === false) status = 'channel_not_configured';
//   else if (channelDisabled) ...
// view также прокидывает botUsername (для deep-link).
```

### Deep-link (Б2) — buildTelegramDeepLink
Предпочитать `botUsername` из канала; ENV — fallback:
```ts
export function buildTelegramDeepLink(linkCode: string, botUsername?: string | null): string {
  const username = (botUsername || process.env.NEXT_PUBLIC_KORA_BOT_USERNAME || 'kora_bot')
    .replace(/^@/, '').trim();
  return `https://t.me/${username}?start=${encodeURIComponent(linkCode)}`;
}
```

## Фазы (dependency-ordered)

Граф: **Ф0** (предусловие) → **Ф1** (backend) → **Ф2** (frontend domain+ChannelsClient) и **Ф3** (frontend MyTelegramCard) — обе зависят от Ф1, между собой независимы. **Ф4** (in_app копи) и **Ф5** (MaxDataClassRadio) — независимы от Ф1, можно параллельно/в любой момент, но коммитить после Ф2 чтобы не конфликтовать в одном файле ChannelsClient.tsx (Ф2, Ф4, Ф5 правят один файл → делать последовательно: Ф2 → Ф4 → Ф5).

### Ф0 [x] — Предусловие: один глобальный telegram-канал + проверка токена
**Цель:** гарантировать отсутствие коллизии каналов и зафиксировать факт наличия/отсутствия токена.
**Действия:**
- Проверить регистрацию `migrate-telegram-channels-to-global.ts` в [backend/scripts/apply-prod-deploy.ts](backend/scripts/apply-prod-deploy.ts) `STEPS` (phase migrate). Если нет — добавить (idempotent, `skipBootstrap` по образцу соседних migrate-шагов).
- Локально/в окружении прогнать миграцию идемпотентно (повторный прогон = no-op, case Б).
- Проверить факт наличия глобального telegram-канала и токена: либо через `/admin/content/global-channels`, либо diag-инструментом по БД (**прод — только с явным разрешением владельца в сессии**, [[feedback_prod_diagnostic_access_requires_confirmation]]). Если токена нет — зафиксировать как операционный TODO владельцу (завести @kora_bot, ввести токен); это НЕ блокирует код Ф1–Ф5 (honest-состояние `channel_not_configured` покрывает случай).
**Что НЕ входит:** ввод реального токена/создание бота (операционное действие владельца).
**Acceptance:**
- `rg -n "migrate-telegram-channels-to-global" backend/scripts/apply-prod-deploy.ts` → присутствует (или добавлено).
- Повторный прогон миграции завершается exit 0 без изменений (лог «уже мигрировано»).
- В отчёте явно: настроен ли токен (да/нет/не проверялось без прод-доступа).
**Закрывает:** предусловие к R1.

### Ф1 [x] — Backend: видимость глобального канала + доставка + флаг `configured`
**Файлы:** [conversational.service.ts](backend/src/modules/conversational/conversational.service.ts) — `listMyChannels` (Б1, ~стр. 633) **и** `resolveBindings` (Б1b, ~стр. 886-898, путь доставки уведомлений) — оба расширить одинаковым `OR`; [conversational.controller.ts](backend/src/modules/conversational/conversational.controller.ts) (`@Get('channels')` маппинг, Б2). Тип `ChannelApi` на фронте ([conversational.api.ts](frontend/src/api/conversational.api.ts), ~стр. 14) — расширить опц. `configured?: boolean; botUsername?: string | null;`.
**Что НЕ входит:** изменение процесса привязки/link-code; реализация reset.
**Тесты:** unit на `listMyChannels`/маппинг — мок Prisma: (а) есть глобальный telegram active + per-tenant in_app → в ответе оба, telegram с `configured` по наличию токена; (б) глобальный telegram с пустым `config` → `configured:false`; (в) глобального telegram нет → в ответе нет telegram entry (фронт покажет «не настроен» только если entry есть — см. риск ниже). Негативный: SMTP с `tenantId=null` НЕ просачивается (kind не в whitelist).
**Acceptance:**
- `rg -n "tenantId: null, kind: { in: \['telegram_bot', 'max_bot'\] }" backend/src/modules/conversational/conversational.service.ts` → 1.
- В ответе `GET /me/channels` для telegram-канала присутствует `configured` (bool) и `botUsername`; `botToken`/секрет — отсутствует (`rg` по ответу/мапперу: нет `botToken` в возвращаемом объекте контроллера).
- `bun run typecheck && bun run lint && bun run test:unit` (затронутый модуль) — зелёные; написанные тесты проходят.
**Закрывает:** R1, R2, R6.

### Ф2 [x] — Frontend: honest-состояние на `/me/channels`
**Файлы:** [me-channels.ts](frontend/src/domain/me-channels.ts) (статус `channel_not_configured`, Б3 + прокинуть `botUsername` в view), [me-channels.api.ts](frontend/src/api/me-channels.api.ts) (`buildTelegramDeepLink(code, botUsername)`), [ChannelsClient.tsx](frontend/app/(authenticated)/me/channels/ChannelsClient.tsx) (`TelegramCard`: ветка `channel_not_configured` — текст Б4 + ссылка на `/admin/content/global-channels` только для owner/admin; deep-link из `view.botUsername`).
**Что НЕ входит:** in_app копи (Ф4), радио (Ф5).
**Acceptance:**
- `rg -n "channel_not_configured" frontend/src/domain/me-channels.ts frontend/app/(authenticated)/me/channels/ChannelsClient.tsx` → присутствует в обоих.
- При `configured:false` карточка Telegram показывает «Telegram пока не настроен администратором компании» и НЕ показывает кнопку «Привязать Telegram» (grep: ветка без `onLink`).
- `buildTelegramDeepLink` принимает второй аргумент `botUsername`; вызовы обновлены.
- `bun run typecheck && bun run lint` зелёные.
**Закрывает:** R3, R4 (часть), R7.

### Ф3 [x] — Frontend: карточка «Telegram» на «Я» без тупика
**Файлы:** [MyTelegramCard.tsx](frontend/app/(authenticated)/me/MyTelegramCard.tsx).
**Поведение:** если статус `channel_not_configured` → бейдж «Не настроен» + текст «Telegram пока не настроен администратором компании», CTA на `/me/channels` НЕ показывать (или показывать неактивным с пояснением). Для `linked` — «Управлять»; для `not_linked`/`bot_blocked`/`channel_disabled` — «Подключить Telegram»→`/me/channels` (там теперь есть рабочая карточка).
**Что НЕ входит:** мастер привязки (живёт на `/me/channels`).
**Acceptance:**
- `rg -n "channel_not_configured" frontend/app/(authenticated)/me/MyTelegramCard.tsx` → присутствует; в этой ветке нет CTA-ссылки «Подключить».
- `bun run typecheck && bun run lint` зелёные.
**Закрывает:** R4.

### Ф4 [x] — UX: переписать карточку «В личном кабинете»
**Файлы:** [ChannelsClient.tsx:198-227](frontend/app/(authenticated)/me/channels/ChannelsClient.tsx#L198-L227) (ветка `ch.binding` для `ch.kind==='in_app'`).
**Поведение:** для in_app не показывать «Привязан: `<externalId>` подтверждено …»; показать «Работает автоматически — отдельной настройки не требует.» `MaxDataClassRadio` для in_app не рендерить.
**Что НЕ входит:** другие каналы.
**Acceptance:**
- На in_app-карточке нет строки с `externalId`/«Привязан»/«подтверждено» (grep ветки in_app).
- `MaxDataClassRadio` не вызывается для `ch.kind==='in_app'` (grep условия).
- `bun run typecheck && bun run lint` зелёные.
**Закрывает:** R5.

### Ф5 [x] — UX: свернуть «потолок чувствительности»
**Файлы:** [ChannelsClient.tsx:474-572](frontend/app/(authenticated)/me/channels/ChannelsClient.tsx#L474-L572) и место его вызова (~стр. 187-197).
**Поведение:** обернуть `MaxDataClassRadio` в `<details>` с summary «Дополнительно: какие данные можно слать в этот канал» + строка «Обычно менять не нужно — по умолчанию приходят рабочие данные.» Показывать только для внешних каналов (не in_app — уже из Ф4).
**Что НЕ входит:** логика смены класса (оставить как есть).
**Acceptance:**
- `rg -n "<details" frontend/app/(authenticated)/me/channels/ChannelsClient.tsx` → обёртка вокруг радио присутствует.
- Текст-пояснение «Обычно менять не нужно» присутствует.
- `bun run typecheck && bun run lint` зелёные.
**Закрывает:** R8.

## Требования (трассировка)

- **R1.** Когда у платформы есть активный глобальный Telegram-канал (`tenantId=NULL`), система shall возвращать его в `GET /me/channels` для любого пользователя его Org.
- **R2.** Ответ `GET /me/channels` для бот-каналов shall содержать `configured: boolean` и `botUsername`, и shall НЕ содержать `botToken`/секрет.
- **R3.** Если `configured===false`, then доменный статус shall быть `channel_not_configured`.
- **R4.** В состоянии `channel_not_configured` UI (`/me/channels` и карточка «Я») shall показывать «не настроен администратором» и НЕ предлагать привязку (нет CTA в тупик).
- **R5.** Карточка in_app shall показывать «Работает автоматически…» без `externalId`/«Привязан»/«подтверждено» и без блока выбора чувствительности.
- **R6.** Глобальные каналы kind ∉ {telegram_bot, max_bot} (напр. глобальный SMTP) shall НЕ появляться в `GET /me/channels`.
- **R7.** Deep-link Telegram shall строиться из `botUsername` канала; при его отсутствии — из ENV `NEXT_PUBLIC_KORA_BOT_USERNAME`, иначе `kora_bot`.
- **R8.** Блок «потолок чувствительности» shall быть свёрнут (`<details>`) с пояснительной строкой и не показываться для in_app.

## Pre-mortem / Риски и ревью-аспекты

- **Утечка секрета:** при добавлении `configured`/`botUsername` легко случайно вернуть `config` целиком. Ревью: грепнуть, что контроллер не отдаёт `channel.config`/`botToken`. **Критично.**
- **Коллизия каналов:** если миграция Ф0 не прогонялась и есть активный per-tenant telegram + глобальный — в списке два telegram. Ф0 (миграция) это устраняет. Ревью: тест на единственность активного telegram.
- **«configured:false, но entry отсутствует»:** если глобального telegram-канала вообще нет (миграция не создала строку) — entry не придёт, и фронт покажет `not_linked`, а не `not_configured`. Поэтому Ф0 (миграция создаёт пустую глобальную строку, case А) — предусловие к honest-состоянию. Зафиксировать в отчёте Ф0.
- **i18n:** новые строки — только русские.
- **RBAC ссылки на админку:** ссылку на `/admin/content/global-channels` показывать только owner/admin (используй существующий guard/роль из `useAuth`/RBAC на фронте; не показывать обычному сотруднику).

## Idempotency / feature-flag / prod-deploy

- **Feature-flag:** не нужен — исправление дефекта, аддитивные поля ответа обратносовместимы.
- **prod-deploy:** изменений схемы/ENV нет. Шаг — прогон идемпотентной миграции `migrate-telegram-channels-to-global.ts` (если ещё не прогонялась в этом окружении) через `apply-prod-deploy.ts`; обновить `docs/operations/prod-deploy-log.md` (Шаг 9 migrate) если запись отсутствует. Операционно: super-admin вводит токен бота в `/admin/content/global-channels` (вне кода).
- **Совместимость с prompt caching:** не релевантно (LLM не затрагивается).

## DoD

- `bun run typecheck` (вкл. `.spec`), `lint`, `build` бэка и фронта — зелёные.
- `bun run test:unit` затронутых модулей — зелёный; новые тесты `listMyChannels`/маппинга проходят.
- Ручная проверка сквозного сценария (при настроенном боте): «Я» → «Подключить Telegram» → `/me/channels` показывает карточку Telegram с кодом/ссылкой → после `/start` статус `linked` синхронно на «Я» и `/me/channels`. При НЕнастроенном боте — обе поверхности показывают «не настроен», без тупика.
- second-brain: обновить [conversational-channels.md](second-brain/01_projects/conversational-channels.md) (видимость глобального канала в `/me/channels`, флаг `configured`) и [frontend-pages.md](second-brain/01_projects/frontend-pages.md) (honest-состояния, UX-копи). `prod-deploy-log.md` — при изменении STEPS/миграции. Рефлексия в `05_история/`.

## Итог

**Реализовано целиком (2026-06-05, ветка `sergdev` от dev).** Все фазы Ф0–Ф5 закрыты.

| Фаза | Коммит | Что сделано |
|---|---|---|
| Ф0 | — | Миграция `migrate-telegram-channels-to-global.ts` уже зарегистрирована в `apply-prod-deploy.ts:372` (идемпотентна). Токен-проверка в проде НЕ делалась (нет разрешения владельца) — операционный TODO. |
| Ф1 | `8b14de6e` | `listMyChannels` **и** `resolveBindings` (путь доставки!) расширены на глобальные бот-каналы; контроллер отдаёт `configured`+`botUsername` (токен не утекает). +5 unit-тестов. |
| Ф2+Ф3 | `d019ef21` | Доменный статус `channel_not_configured`; honest-блок «бот не настроен» на `/me/channels` (+ссылка в админку для owner/admin), без CTA в тупик; deep-link из `botUsername`; карточка «Я» — бейдж «Не настроен» без CTA. +4 unit-теста. |
| Ф4+Ф5 | (последний) | in_app: «Работает автоматически» вместо «Привязан: id подтверждено», радио для in_app скрыто; «потолок чувствительности» внешних каналов свёрнут в `<details>` с пояснением. |

**Находка картографии (вне исходного scope, починена сразу):** второй экземпляр того же фильтра в `resolveBindings` — путь ДОСТАВКИ уведомлений. Без его правки привязка прошла бы, а уведомления в Telegram молча не доходили бы. Починен в Ф1 (Б1b).

**Верификация:** backend `typecheck`/`build` + 140/140 тестов модуля conversational; frontend `typecheck`/`lint`/`build` — всё зелёное.

**Что осталось владельцу (операционно, НЕ код):** убедиться, что глобальный @kora_bot реально заведён и токен введён в `/admin/content/global-channels`. Если токена нет — UI теперь честно покажет «Telegram не настроен» (без тупика), но фактическая привязка/доставка заработают только после ввода токена. Проверку можно сделать diag-инструментом по базе (прод — с явного разрешения владельца).
