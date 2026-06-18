---
type: tz
status: ready-to-implement
feature: chat-surfaces-and-honest-buttons
date: 2026-06-05
owner: Сергей (sergrv80@gmail.com)
relates_to:
  - plans/analysis/2026-06-05-full-project-audit-technical.md
  - plans/analysis/2026-06-05-full-project-audit-plain-language.md
  - plans/tz/2026-06-04-meeting-identity-and-clones-attribution.md
---
> Источник находок: аудит `plans/analysis/2026-06-05-full-project-audit-{technical,plain-language}.md`, раздел «Что лишнее, дублируется или недоделано» (pc-01, pc-02, строка 432).
> Статус согласования: 2026-06-05. Развилки закрыты владельцем («делай как рекомендуешь»).

# Честный фронт-офис: единый AI-чат + рабочие кнопки

## Принцип
Минимальные безопасные изменения поверх текущей архитектуры. Мы НЕ переписываем чат, НЕ трогаем логику дедупа Task↔Issue (она уже готова отдельным ТЗ), НЕ строим push-инфраструктуру (она уже есть). Мы убираем три класса UX-дефектов: спрятанный флагман, дублирующиеся диалоговые поверхности и «видимые кнопки, которые молча не работают».

## Цель
Закрыть продуктовые находки аудита:
1. **Флагман спрятан** (pc-01) — пункт меню «Помощник компании» ведёт на устаревший `/chat`, а актуальный `/chat-v2` доступен только через палитру команд, которой нетехнические сотрудники не пользуются. Клиент рискует не увидеть главную ценность продукта.
2. **Три диалоговые поверхности** (pc-02) — `/chat`, `/chat-v2`, `/assistant` с пересекающимся неймингом и одной иконкой. Свести к двум понятным: «ответы» и «действия».
3. **Молчаливые кнопки** (строка 432) — доведение видимых-но-неработающих функций до честного состояния: тест IMAP, push-доставка напоминаний, доставка дайджеста ленты активности, бейдж `goal_alignment`.
4. **Бонус (вскрыто при картографии)** — у флага дедупа `knowledge.meetingTasksToTrackerOnly` НЕТ переключателя в админке. Добавляем русский тумблер, чтобы владелец сам активировал уже готовую фичу #2.

**Зачем (болезненное состояние).** Аудит простым языком: «"кнопка есть, а эффекта нет" — самый дорогой удар по доверию»; «главную ценность продукта клиент рискует просто не увидеть».

## REALITY-CHECK (что есть по факту — проверено по коду 2026-06-05)
Ключевой результат картографии: **большая часть «проблем» — это проводка к готовой инфраструктуре, а не стройка.**

| Находка | Фактическое состояние в коде | Что это значит для ТЗ |
|---|---|---|
| Сайдбар → `/chat` | [Sidebar.tsx:258-265](../../frontend/src/ui/components/app-shell/Sidebar.tsx#L258) — `href:'/chat'`, `matchPrefix:'/chat'`, `gateFeature:'feature.chat_org'` | Точечный repoint на `/chat-v2` |
| `/chat` устарел | [ChatClient.tsx:39-59](<../../frontend/app/(authenticated)/chat/ChatClient.tsx#L39>) сам рисует баннер «Попробовать /chat-v2» | Превращаем страницу в редирект |
| `OrgChatPanel` | Используется ещё в дашборде ([AssistantSidebar.tsx:379](../../frontend/src/ui/components/dashboard/AssistantSidebar.tsx#L379)) | Редиректим только РОУТ `/chat`; компонент НЕ трогаем |
| `/chat-v2` | [page.tsx](<../../frontend/app/(authenticated)/chat-v2/page.tsx>) — тонкая обёртка `<ChatV2Client/>`; metadata title «AI-чат компании» | Цель редиректа; не меняем |
| `/assistant` | [page.tsx](<../../frontend/app/(authenticated)/assistant/page.tsx>) — Concierge (tool-use, действия). **В сайдбаре отсутствует** (вход — floating button + ConciergeSlot) | Добавляем понятный пункт меню «действия» |
| Тест IMAP (админ-боты) | backend [admin-bots.service.ts:349-363](../../backend/src/modules/admin/integrations/bots/admin-bots.service.ts#L349) — `throw NotImplementedException` (501). Фронт [BotsClient.tsx:545-562](<../../frontend/app/(admin)/admin/integrations/bots/BotsClient.tsx#L545>) ловит и показывает **ошибку** (не «success», как написано в аудите). Рабочий паттерн коннекта — рядом: [email-fetch.service.ts:200-242](../../backend/src/modules/ingest/adapters/email/email-fetch.service.ts#L200); глобальный инбокс поллит [project-inbox.service.ts](../../backend/src/modules/mail/inbound/project-inbox.service.ts) из `cfg.mailInbox.*` | Реализуем реальный тест переиспользованием паттерна |
| Push-напоминания | [event-reminders.worker.ts:320-332](../../backend/src/modules/events/workers/event-reminders.worker.ts#L320) — `push` ветка = TODO-лог, **возвращает `true` и помечает `sentAt`** (молча «доставлено»). **Push-инфраструктура ГОТОВА:** [WebPushSender.sendToUser()](../../backend/src/modules/push/services/web-push-sender.service.ts#L62) — чистый API, graceful no-VAPID | Тонкая проводка: inject + вызов |
| Доставка дайджеста ленты | [feed-digest.cron.ts:82-95](../../backend/src/modules/activity-feed/cron/feed-digest.cron.ts#L82) — «собран дайджест (доставка TODO)». Готовый паттерн доставки — [telegram-digest.cron.ts:43](../../backend/src/modules/conversational/adapters/telegram-bot/telegram-digest.cron.ts#L43) через `ConversationalService.sendNotification` | Проводка к `sendNotification` |
| Бейдж `goal_alignment` всегда false | В аудите это `[unverified]`-строка БЕЗ `path:line`. Точечный поиск хардкода `false` ничего не дал; фича alignment реально считается ([strategic-alignment.worker.ts](../../backend/src/modules/knowledge-core/workers/strategic-alignment.worker.ts), `Goal.cachedAlignment`, dashboard «Согласованность стратегии») | Фаза «локализовать-или-снять», без угадывания |
| Флаг дедупа `meetingTasksToTrackerOnly` | Зарегистрирован в бэке ([admin-setting-schema-registry.ts:103](../../backend/src/modules/admin/settings/admin-setting-schema-registry.ts#L103) + сидер), **но во `frontend/` НЕ выведен** — кликом в админке не переключить. Редактор настроек — [KnowledgeCoreSettingsClient.tsx](<../../frontend/app/(admin)/admin/ai/knowledge-core/KnowledgeCoreSettingsClient.tsx>) (массив `SettingRow`, `useAdminSettingEditor`, `AdminSettingField`) | Добавляем одну строку-тумблер |

**Вывод REALITY-CHECK:** объём — это 1 фронт-фаза (поверхности), 3 узкие backend-проводки, 1 фронт-строка (тумблер) и 1 верификационная фаза. Никакой новой схемы БД, никаких новых очередей/ENV (кроме переиспользования существующих).

## Принятые решения владельца
| # | Решение | Обоснование (Почему) | Дата |
|---|---|---|---|
| Р1 | Свести чат к **2 поверхностям + редирект**: сайдбар «Помощник компании» → `/chat-v2`; `/chat` → постоянный редирект; `/assistant` остаётся отдельной поверхностью «действий» с понятным пунктом меню | Флагман в меню, ноль «мёртвых» URL, чёткое «ответы vs действия». `/chat` сам уже признан устаревшим баннером. Меньший риск, чем полное слияние страниц | 2026-06-05 |
| Р2 | Тест IMAP — **реализовать настоящий** (реальный коннект+greeting), не прятать кнопку | Кнопка-тест, которая всегда падает = сломанный UX. Рабочий паттерн уже есть рядом — переиспользуем, не дублируем (`feedback_fix_the_whole_class_not_the_case`) | 2026-06-05 |
| Р3 | Добавить **русский тумблер** флага `meetingTasksToTrackerOnly` в админку | Владелец работает в русской админке; сейчас активировать готовую фичу #2 можно только через API. Принцип «крутилки — в AdminSetting UI, не в код» (`feedback_admin_settings_not_env_or_code`) | 2026-06-05 |
| Р4 | Push и доставку дайджеста — **подключить к существующей инфраструктуре**, не строить новую | Push-модуль и `sendNotification` уже готовы; «молча true» хуже честной доставки или честной ошибки | 2026-06-05 |

## Доказательство выбора (два прохода, кратко)
- **Поверхности чата.** A: redirect-роут + repoint меню (минимум кода, использует факт, что `/chat` уже самопомечен устаревшим). B: полное слияние `/chat-v2`+`/assistant` в одну страницу с режим-переключателем (чище концептуально, но переписывает две страницы, ломает deep-link палитры `?conversationId=`, выше риск регрессии истории диалогов). **Выбран A** — B не оправдывает риск для «спрятан флагман»; объединение режимов — отдельный vNext, если понадобится.
- **Push-напоминания.** A: inject `WebPushSender` в `EventRemindersWorker`, вызов в push-ветке (хирургично, push только для User — как telegram). B: добавить маршрутизацию `push` внутрь `ConversationalService.sendNotification` (чинит push для всех потребителей сразу). **Выбран A** — у напоминаний свой per-reminder enum-канал (`'push'|'email'|'telegram'`), это не channel-kind система Conversational; A не трогает чужой blast-radius. Push в `sendNotification` — отдельный vNext (см. «Вне scope»).
- **Тест IMAP.** A: вынести коннект в общий метод `ProjectInboxService.testConnection()` (глобальный инбокс уже там, конфиг из `cfg.mailInbox.*`). B: дублировать ImapFlow-конструкцию в `AdminBotsService`. **Выбран A** — B плодит третью копию ImapFlow-конструкции (уже две: email-fetch, project-inbox); правим класс, а не кейс.

## Scope
### Входит
- Repoint сайдбара на `/chat-v2`; `/chat` → редирект; пункт меню для `/assistant`.
- Реальный тест IMAP-коннекта глобального email-inbox в админке ботов.
- Проводка push-ветки напоминаний к `WebPushSender`.
- Проводка доставки дайджеста ленты активности к `ConversationalService.sendNotification`.
- Локализация-или-снятие бейджа `goal_alignment`.
- Русский тумблер флага `knowledge.meetingTasksToTrackerOnly` в админке.

### Не входит (с судьбой каждого хвоста)
- **Логика дедупа Task↔Issue (#2)** — уже реализована в `plans/tz/2026-06-04-meeting-identity-and-clones-attribution.md` §5.2 (все фазы `[x]`, дефолт OFF). Здесь только добавляем UI-тумблер (Фаза 6). Прод-раскатка и включение флага — операционная задача (`docs/operations/prod-deploy-log.md`), не код.
- **Полное слияние `/chat-v2`+`/assistant` в одну страницу с режим-переключателем** — vNext, если 2-поверхностная модель окажется недостаточной. Не открываем ТЗ сейчас.
- **Маршрутизация канала `push` внутри `ConversationalService.sendNotification`** (и, как следствие, `mobile_push` в дайджесте) — vNext-заглушка: канал `mobile_push` в дайджесте доставляем best-effort и логируем «push в дайджесте — vNext», остальные каналы (`in_app`/`telegram`/`email`) доставляем полноценно.
- **`rotateIpSalt` (501)** из той же строки аудита 432 — не входит (отдельная админ-операция безопасности, не «фронт-офисная кнопка»; вынести отдельным фиксом при необходимости).
- **Прочие дубли из аудита** (roles-domain×3, clones↔knowledge-clone, два org-сайдбара) — отдельные инициативы, вне темы «спрятанный чат + честные кнопки».

## Граничные контракты (что НЕ трогать)
- **`OrgChatPanel`** ([frontend/src/ui/components/chat/OrgChatPanel.tsx](../../frontend/src/ui/components/chat/OrgChatPanel.tsx)) — компонент остаётся как есть; его использует дашборд. Меняется только роут-обёртка `/chat`.
- **`ChatV2Client` / `/chat-v2`** — целевая страница, не модифицируется.
- **Логика создания Task/Issue** (`meeting-report-fast.worker`, `MeetingActionItemsService`) — не трогаем; Фаза 6 только выводит существующий флаг в UI.
- **`WebPushSender.sendToUser`** — потребляем как есть, сигнатуру не меняем.
- **Deep-link палитры** `/chat-v2?conversationId=...` ([CommandPalette.tsx:768](../../frontend/src/ui/components/command-palette/CommandPalette.tsx#L768)) — должен продолжать работать после всех правок.

## Границы фичи
- ✅ Always: repoint nav, redirect-роут, inject готового сервиса, вызов существующего метода, добавление одной строки в массив настроек.
- ⚠️ Ask first: любое изменение схемы Prisma (не требуется — если возникло, значит подход не тот); переименование `feature.chat_org`; изменение сигнатуры `sendNotification`/`WebPushSender`.
- 🚫 Never: трогать логику дедупа #2; удалять `OrgChatPanel`; вводить новый ENV вместо AdminSetting; `text-white` на цветном фоне / английские слова в видимом UI.

---

## Фаза 1 — Диалоговые поверхности: меню + редирект (frontend) · Закрывает: R1, R2, R3
**Мини-картография:** [Sidebar.tsx:242-266](../../frontend/src/ui/components/app-shell/Sidebar.tsx#L242) (массив items группы «Каждый день»), [chat/ChatClient.tsx](<../../frontend/app/(authenticated)/chat/ChatClient.tsx>), [chat/page.tsx](<../../frontend/app/(authenticated)/chat/page.tsx>), [assistant/page.tsx](<../../frontend/app/(authenticated)/assistant/page.tsx>). Иконки lucide уже импортятся в Sidebar.

**R1.** Когда пользователь открывает сайдбар, пункт «Помощник компании» shall вести на `/chat-v2` (не `/chat`).
- В [Sidebar.tsx:259](../../frontend/src/ui/components/app-shell/Sidebar.tsx#L259) изменить `href: '/chat'` → `href: '/chat-v2'`. `matchPrefix: '/chat'` ОСТАВИТЬ (префикс матчит и `/chat-v2`, и редиректящийся `/chat` — подсветка корректна). `label`, `icon`, `gateFeature`, `tourTarget`, `overviewTarget` НЕ менять.

**R2.** Если пользователь переходит на `/chat` (старые ссылки, баннеры, закладки), then система shall немедленно и постоянно перенаправлять на `/chat-v2`.
- Заменить тело [chat/page.tsx](<../../frontend/app/(authenticated)/chat/page.tsx>) на серверный редирект (App Router):
```tsx
import { redirect } from 'next/navigation';

export default function ChatPage(): never {
  redirect('/chat-v2'); // pc-01/pc-02: единый флагман — /chat-v2
}
```
- Файл `chat/ChatClient.tsx` удалить (его единственный потребитель — `chat/page.tsx`). `OrgChatPanel` НЕ удалять (используется дашбордом — см. граничные контракты).
- [ASSUMPTION: используем `redirect()` из `next/navigation` (а не `next.config.js` redirects) — даёт серверный 307 без правки конфига; при правке перечитать актуальную сигнатуру через Context7 `/vercel/next.js`, если major Next изменился.]

**R3.** Когда пользователь смотрит сайдбар, система shall показывать отдельный пункт для `/assistant` с русским названием, отличающим «действия» от «ответов».
- Добавить в массив items группы «Каждый день» (рядом с пунктом чата, [Sidebar.tsx:257-265](../../frontend/src/ui/components/app-shell/Sidebar.tsx#L257)) запись:
```ts
{
  href: '/assistant',
  label: 'Ассистент',              // [ASSUMPTION: copy — владелец может заменить на «Сделай за меня»]
  icon: Wand2,                      // lucide; добавить в import, если отсутствует
  matchPrefix: '/assistant',
  // gate — зеркалить видимость floating-Concierge (ConciergeSlot); если он без гейта — пункт без gateFeature.
},
```
- ПЕРЕД установкой гейта — перечитать [ConciergeSlot.tsx](../../frontend/src/ui/concierge/ConciergeSlot.tsx) / [AppShell.tsx](../../frontend/src/ui/components/app-shell/AppShell.tsx): если floating-кнопка Concierge показывается с условием (entitlement/role), пункт меню `/assistant` должен иметь ТО ЖЕ условие; если без условия — без `gateFeature`. [ASSUMPTION: зеркалим существующую видимость Concierge; не вводим новый гейт.]

**Что НЕ входит:** изменение самих страниц `/chat-v2`, `/assistant`; переименование `feature.chat_org`; объединение режимов.
**Acceptance 1:**
- grep: `href: '/chat-v2'` присутствует в Sidebar; `href: '/chat'` в Sidebar отсутствует (`rg "href: '/chat'" frontend/src/ui/components/app-shell/Sidebar.tsx` → 0 строк).
- `chat/page.tsx` содержит `redirect('/chat-v2')`; `chat/ChatClient.tsx` отсутствует (`git status` показывает удаление); `rg "OrgChatPanel" frontend` → всё ещё ≥2 совпадения (dashboard цел).
- Сайдбар содержит запись с `href: '/assistant'`.
- `cd frontend && bun run typecheck && bun run lint && bun run build` — зелёные.
- Ручной предикат (для верификатора): открыть `/chat` → URL становится `/chat-v2`; deep-link `/chat-v2?conversationId=X` открывает диалог X.

## Фаза 2 — Реальный тест IMAP глобального email-inbox (backend) · Закрывает: R4
**Мини-картография:** [admin-bots.controller.ts:116-123](../../backend/src/modules/admin/integrations/bots/admin-bots.controller.ts#L116) (`@Post('email-inbox/test-connection')`), [admin-bots.service.ts:349-363](../../backend/src/modules/admin/integrations/bots/admin-bots.service.ts#L349) (заглушка 501), [admin-bots.service.spec.ts:227-232](../../backend/src/modules/admin/integrations/bots/admin-bots.service.spec.ts#L227) (тест ожидает 501 — обновить), [project-inbox.service.ts](../../backend/src/modules/mail/inbound/project-inbox.service.ts) (глобальный инбокс, `cfg.mailInbox.*`), образец коннекта [email-fetch.service.ts:200-242](../../backend/src/modules/ingest/adapters/email/email-fetch.service.ts#L200).

**R4.** Когда super_admin нажимает «Тест соединения» email-inbox, система shall выполнить реальный IMAP-коннект (connect + login + greeting/list) и вернуть `{ ok: true, details }` при успехе или `{ ok: false, error: { code, message } }` при ошибке — без `NotImplementedException`.
- Добавить публичный метод в `ProjectInboxService`: `async testConnection(): Promise<{ ok: boolean; details?: Record<string, unknown>; error?: { code: string; message: string } }>`. Внутри: построить `new ImapFlow({ host, port, secure, auth })` из `cfg.mailInbox.*` (те же ключи, что использует поллер), `await client.connect()`, снять `client.serverInfo`/`await client.list()` (число папок) для `details`, в `finally` — `await client.logout()` (обёрнуто в try/catch как в образце). Если `cfg.mailInbox.enabled === false` или нет хоста — вернуть `{ ok:false, error:{ code:'mail_inbox_not_configured', message:'Глобальный email-inbox не настроен (MAIL_INBOX_*).' } }`.
- В [admin-bots.service.ts:349](../../backend/src/modules/admin/integrations/bots/admin-bots.service.ts#L349) заменить тело `testEmailInboxConnection()`: вызвать `ProjectInboxService.testConnection()` и смаппить в существующий `EmailInboxTestResponseDto`. Inject `ProjectInboxService` (AdminBotsModule должен импортировать модуль, экспортирующий `ProjectInboxService` — проверить экспорт `MailModule`/inbound и добавить в `exports`, если нет).
- Обновить [admin-bots.service.spec.ts:227-232](../../backend/src/modules/admin/integrations/bots/admin-bots.service.spec.ts#L227): тест «пока заглушка 501» заменить на тест успешного маппинга (мок `ProjectInboxService.testConnection` → `{ok:true}` ⇒ результат `ok:true`; → `{ok:false,...}` ⇒ `ok:false`).
- Фронт [BotsClient.tsx:545-562](<../../frontend/app/(admin)/admin/integrations/bots/BotsClient.tsx#L545>) НЕ менять — он уже корректно показывает `toast.success`/`toast.error` по `res.ok`.

**Что НЕ входит:** UI-правки; тест Org-источников (он уже рабочий); приём настроек инбокса через UI (остаётся ENV).
**Acceptance 2:**
- `rg "NotImplementedException" backend/src/modules/admin/integrations/bots/admin-bots.service.ts` → 0 совпадений в методе теста.
- `ProjectInboxService.testConnection` существует и экспортируется (`rg "testConnection" backend/src/modules/mail/inbound/project-inbox.service.ts`).
- Негативный пример: `cfg.mailInbox.enabled=false` → `{ ok:false, error.code='mail_inbox_not_configured' }` (unit-тест).
- `cd backend && bun run typecheck && bun run lint && bunx vitest run src/modules/admin/integrations/bots/admin-bots.service.spec.ts` — зелёные.

## Фаза 3 — Push-доставка напоминаний (backend) · Закрывает: R5
**Мини-картография:** [event-reminders.worker.ts:243-358](../../backend/src/modules/events/workers/event-reminders.worker.ts#L243) (`deliverOne`, push-ветка :320-332), конструктор :65-74 (deps), [push.module.ts](../../backend/src/modules/push/push.module.ts), [web-push-sender.service.ts:62-145](../../backend/src/modules/push/services/web-push-sender.service.ts#L62).

**R5.** Когда наступает время напоминания с каналом `push` и получатель — User, система shall реально отправить web-push через `WebPushSender.sendToUser`, инкрементируя метрику доставки только при фактической отправке.
- Inject `WebPushSender` в `EventRemindersWorker` (добавить в конструктор :65-74). `EventsModule` импортирует `PushModule`; `PushModule` экспортирует `WebPushSender` (проверить `exports`, добавить при отсутствии).
- В push-ветке [event-reminders.worker.ts:320-332](../../backend/src/modules/events/workers/event-reminders.worker.ts#L320) заменить TODO-лог на:
  - если `!recipient.userId` — push адресуется только User (как telegram): debug-лог «push не поддерживает Person без User — пропуск», `return true` (не ошибка, метрику НЕ трогаем);
  - иначе `const { delivered } = await this.webPush.sendToUser({ tenantId, userId: recipient.userId, title, body, url })` (title/body — те же helper'ы, что для email/telegram; `url` — deep-link на событие, как в telegram-ветке);
  - инкремент `metrics.incCalendarReminderSent({ tenant: tenantId, channel, success: true })` оставить в общем хвосте `deliverOne` — он сработает после успешной ветки. Если `delivered===0` (нет подписок / нет VAPID) — это НЕ ошибка доставки (graceful), оставляем `success:true` (как сейчас для telegram-skip). [ASSUMPTION: `delivered===0` при отсутствии подписок не считаем failure — это согласуется с graceful-семантикой `WebPushSender`.]
- НЕ менять идемпотентность (`sentAt` ставится один раз для всех каналов — оставить как есть).

**Что НЕ входит:** push для Person; маршрутизация push в `sendNotification`; UI подписок (готов в push-модуле).
**Acceptance 3:**
- `rg "TODO.*push|push не реализована" backend/src/modules/events/workers/event-reminders.worker.ts` → 0.
- `rg "webPush|WebPushSender" backend/src/modules/events/workers/event-reminders.worker.ts` → ≥1; `PushModule` в exports содержит `WebPushSender`.
- Unit (мок `WebPushSender`): канал `push` + recipient с `userId` ⇒ вызван `sendToUser` 1 раз; recipient без `userId` ⇒ `sendToUser` не вызван, результат не-failure.
- `cd backend && bun run typecheck && bun run lint && bunx vitest run src/modules/events/workers/event-reminders.worker.spec.ts` — зелёные.

## Фаза 4 — Доставка дайджеста ленты активности (backend) · Закрывает: R6
**Мини-картография:** [feed-digest.cron.ts:60-115](../../backend/src/modules/activity-feed/cron/feed-digest.cron.ts#L60) (TODO :82-95), образец доставки [telegram-digest.cron.ts:43](../../backend/src/modules/conversational/adapters/telegram-bot/telegram-digest.cron.ts#L43), реестр payload [event-payload.registry.ts](../../backend/src/modules/conversational/types/event-payload.registry.ts), политика каналов `EVENT_TYPE_CHANNEL_POLICY` в [conversational.service.ts:120-128](../../backend/src/modules/conversational/conversational.service.ts#L120). Поле подписки `channels` (`in_app|telegram|email|mobile_push`) и `digestMode`.

**R6.** Когда `FeedDigestCron` собрал непустой дайджест для подписки, система shall доставить его через `ConversationalService.sendNotification` по каналам подписки (`in_app`/`telegram`/`email`), а не только писать лог.
- Зарегистрировать `eventType 'activity.digest'`: Zod-схему payload в `event-payload.registry.ts` (поля: `feedType`, `kind`('daily'|'weekly'), `count`, краткий markdown/текст-сводка) + строку в `EVENT_TYPE_CHANNEL_POLICY` (например `['in_app','telegram','email']`).
- В [feed-digest.cron.ts:82-95](../../backend/src/modules/activity-feed/cron/feed-digest.cron.ts#L82) заменить TODO-лог на `await this.conversational.sendNotification({ userId: sub.userId, eventType:'activity.digest', preferredChannelKinds: <маппинг sub.channels → ChannelKind[]>, dataClass:'internal', payload:{...} })`. Inject `ConversationalService` в крон (если ещё не injected). Сохранить идемпотентность/частоту по `digestMode` как есть.
- Канал `mobile_push` подписки: пометить best-effort — если в `preferredChannelKinds` нет соответствия (push в `sendNotification` пока не маршрутизируется — см. «Вне scope»), залогировать `debug` «activity.digest: mobile_push — vNext»; остальные каналы доставить.

**Что НЕ входит:** маршрутизация push внутри `sendNotification`; изменение расписания крона; новые каналы.
**Acceptance 4:**
- `rg "доставка TODO" backend/src/modules/activity-feed/cron/feed-digest.cron.ts` → 0.
- `rg "activity.digest" backend/src/modules/conversational/types` → присутствует в registry и в `EVENT_TYPE_CHANNEL_POLICY`.
- Unit (мок `ConversationalService`): подписка с `count>0` ⇒ `sendNotification` вызван с `eventType:'activity.digest'`; `count===0` ⇒ не вызван.
- `cd backend && bun run typecheck && bun run lint && bunx vitest run src/modules/activity-feed` — зелёные.

## Фаза 5 — Бейдж `goal_alignment`: локализовать-или-снять (verify-or-drop) · Закрывает: R7
**Контекст:** в аудите это `[unverified]` без `path:line`; предварительный поиск хардкода не дал результата, а фича alignment реально считается. Эта фаза — детерминированное расследование с двумя исходами, НЕ угадывание.

**R7.** Система shall либо устранить реальный «всегда false» бейдж, либо документально закрыть находку как неактуальную.
- Шаг 1 — локализация (выполнить ВСЕ):
  - `rg -i "goal.?align|aligned|alignment" frontend/src --type ts --type tsx`
  - `rg -i "goalAlignment|isAligned|alignedToGoal" backend/src`
  - проверить ранжирование карточек/сигналов на предмет компонента `goal_alignment`, захардкоженного в `false`/`0` (формула в [second-brain/02_architecture/module-map.md:508](../../second-brain/02_architecture/module-map.md#L508) — ориентир, не источник правды).
- Шаг 2 — развилка:
  - **Если найден** хардкод `false`/всегда-falsy бейдж: подключить к реальному значению — `Goal.cachedAlignment` (0..100) / `overview.alignmentScore` ([overview-response.dto.ts:58](../../backend/src/modules/tracker/dto/overview/overview-response.dto.ts#L58)); если данных на нужном уровне нет — скрыть бейдж (не показывать неинформативный «false»), а не оставлять заведомо ложный.
  - **Если НЕ найден**: задокументировать в `Итог` ТЗ «находка `goal_alignment badge` не воспроизведена на 2026-06-05 — вероятно устаревший пункт аудита; alignment считается через strategic-alignment.worker», и снять из scope. Поправить строку аудита 432 пометкой `[не воспроизведено]`.

**Что НЕ входит:** переписывание расчёта alignment; новый LLM-таск.
**Acceptance 5:**
- В `Итог` ТЗ зафиксирован один из двух исходов с конкретными `path:line` (найдено+исправлено) ИЛИ обоснование снятия.
- Если был код-фикс: `cd frontend && bun run typecheck && bun run build` (и/или backend) зелёные; grep подтверждает отсутствие хардкода-false.

## Фаза 6 — Русский тумблер флага дедупа в админке (frontend) · Закрывает: R8
**Мини-картография:** [KnowledgeCoreSettingsClient.tsx:84-110](<../../frontend/app/(admin)/admin/ai/knowledge-core/KnowledgeCoreSettingsClient.tsx#L84>) (массив групп/настроек, каждая — `{key,label,description,...}` + `AdminSettingField`/`useAdminSettingEditor`), ключ зарегистрирован в [admin-setting-schema-registry.ts:103](../../backend/src/modules/admin/settings/admin-setting-schema-registry.ts#L103) (`z.boolean()`).

**R8.** Когда super_admin открывает «Knowledge-Core настройки», система shall показывать переключатель (boolean) для `knowledge.meetingTasksToTrackerOnly` с русским названием и пояснением, и сохранять значение через существующий `useAdminSettingEditor`.
- Добавить в подходящую группу (например «Встречи/задачи» или новую вкладку) запись:
```ts
{
  key: 'knowledge.meetingTasksToTrackerOnly',
  label: 'Единая задача из встречи (не плодить дубль)',
  description:
    'Включено — из встречи рождается одна видимая задача в трекере (Issue), отдельный «Task» для пунктов не создаётся. Выключено — прежнее поведение. ВНИМАНИЕ: режим «включено» на проде ещё не обкатан — после включения проверьте одну тестовую встречу.',
  type: 'boolean',            // зеркалить, как оформлены другие boolean-настройки на странице
}
```
- Тип поля/рендер — строго по образцу существующих boolean-настроек на этой странице (НЕ изобретать новый контрол). Значение по умолчанию в UI должно отражать code-fallback `false`.

**Что НЕ входит:** изменение логики дедупа; вывод флага в Org-настройки (это super_admin-настройка); прод-включение флага.
**Acceptance 6:**
- `rg "meetingTasksToTrackerOnly" frontend` → ≥1 совпадение (ранее было 0).
- Поле рендерится как boolean-тумблер с русскими `label`/`description`, без английских слов в видимом тексте.
- `cd frontend && bun run typecheck && bun run lint && bun run build` — зелёные.

---

## Граф зависимостей фаз
Все шесть фаз **независимы** (разные файлы/слои) и могут идти параллельными волнами:
- Волна A (frontend): Фаза 1, Фаза 6.
- Волна B (backend): Фаза 2, Фаза 3, Фаза 4.
- Фаза 5 — расследование, можно в любой волне.

Единственная мягкая связь: Фаза 1 и Фаза 6 правят разные файлы фронта — конфликтов нет.

## Pre-mortem / Риски и ревью-аспекты
- **Редирект `/chat` ломает встроенный тур/онбординг**, если шаг тура указывает на `/chat`. Проверить `frontend/src/ui/tour/*` и `nav-help.ts` (`'/chat'` ключ есть в [nav-help.ts:44](../../frontend/src/lib/nav-help.ts#L44)) — при необходимости перенаправить ключ help на `/chat-v2`/`/assistant`. Ревью: переходы тура не должны вести в редирект-петлю.
- **AdminBotsModule не видит `ProjectInboxService`** — DI-ошибка на старте. Ревью: модуль-экспорт добавлен; приложение поднимается (`bun run build`).
- **Push без VAPID** — `sendToUser` graceful (`delivered:0`), не должен ломать доставку остальных каналов и не должен инкрементить failure. Ревью: `success:true` при `delivered:0`.
- **Дайджест: дубль-доставка** при повторном запуске крона — сохранить существующую идемпотентность/частоту (`digestMode`); не добавлять второй путь enqueue. Ревью по `strict-production-review-gate`: идемпотентность, отсутствие двойной отправки.
- **Видимый UI** — ни одного английского слова в новых строках (label/description/toast). Парные токены цветов, без `text-white`/hex.
- **Тумблер ON до обкатки** — Фаза 6 даёт владельцу кнопку включить непротестированную ветку. Снижение риска: явное предупреждение в `description` + мгновенный откат (выключить тумблер). Сам дефолт остаётся OFF.

## Idempotency / feature-flag / prod-deploy
- Новых ENV/схем/очередей/seed-скриптов нет → шаги 1/4/5/6–10 prod-deploy-log не затрагиваются.
- **Шаг 11 (Docker rebuild)** — обязателен: backend (Фазы 2–4) + frontend (Фазы 1, 6): `docker compose up -d --build backend frontend`.
- **Шаг 12 (Smoke)** добавить после реализации: `/chat`→302→`/chat-v2`; `POST /admin/integrations/bots/email-inbox/test-connection` не отдаёт 501; `rg "activity.digest"` в registry.
- Prompt-cache: LLM-промпты не затрагиваются (раздел «Совместимость с prompt caching» — **не релевантно**, новых LLM-вызовов нет).

## DoD
- Все 6 фаз: `bun run typecheck` (вкл. `.spec`), `lint`, `build` зелёные в затронутом проекте; профильные vitest-файлы зелёные.
- Видимый UI — только русский; парные цветовые токены.
- `second-brain/` обновлён по таблице производных заметок: `01_projects/frontend-pages.md` (редирект `/chat`, пункт `/assistant`), `01_projects/admin.md` (тумблер настройки), `01_projects/workers-queues.md`/`ai-jobs.md` (реальная доставка push/дайджеста), `02_architecture/module-map.md` (метод `ProjectInboxService.testConnection`, новый `eventType activity.digest`).
- `docs/operations/prod-deploy-log.md`: добавлена запись с шагами 11–12 для этого выката.
- Рефлексия в `second-brain/05_история/`.

## Итог
_(заполняет tz-orchestrator по завершении: что реализовано целиком, исход Фазы 5, что осталось.)_
