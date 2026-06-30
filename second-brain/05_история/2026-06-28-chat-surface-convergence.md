---
type: reflection
date: 2026-06-28
distilled: false
related:
  - plans/tz/2026-06-25-edinyy-pomoshnik-chat-surface-convergence.md
  - plans/tz/2026-06-28-meeting-chat-on-master-scoped.md
  - plans/tz/2026-06-28-concierge-conversation-management-parity.md
---

# 2026-06-28 — Конвергенция поверхностей чата на один Мастер (КФ1–КФ5)

## Постановка

ТЗ [`2026-06-25-edinyy-pomoshnik-chat-surface-convergence.md`](../../plans/tz/2026-06-25-edinyy-pomoshnik-chat-surface-convergence.md)
(КФ1–КФ5). Корень: в кабинете жили **3 движка чата** (chat-v2 / concierge / legacy)
за разными входами — десктоп `/chat` (`ChatV2Client`, только Q&A без действий),
мобильный Ask (`OrgChatPanel`), `IssueChat` (scope:issue), `MeetingChatPanel` (legacy
`chatApi`), плюс FAB-поповер concierge с действиями, но без истории/списка диалогов.
Бэкенд «единого мозга» был сделан раньше (Мастер single-pass → chat-v2 `askEphemeral`
в процессе), фронт-консолидация оставалась `[ ]`. Задача: **один Мастер (concierge)
как единственное лицо чата**, chat-v2 — внутренний ответчик. Ветка `dev`,
коммиты `7d111a94`..`c5b7ec10`.

## Что сделал

По фазам ТЗ:

- **КФ1 — scope в Мастере (backend).** `concierge.service.ts ProcessInput` += `scope?`/
  `scopeRefId?`/`asOf?`; протащил в оба вызова `chatV2.askEphemeral`
  (`dispatchAskChatV2` и `resumeClarify`). DTO `PostConciergeMessageBodySchema` += те же
  поля; контроллер прокидывает в `concierge.process()`.
- **titlePreview (backend).** `GET /concierge/conversations` теперь отдаёт `titlePreview`
  (первое user-сообщение, обрезано до 80 симв.) — хелпер
  `backend/src/modules/concierge/concierge-title-preview.ts`. Это чинит «все диалоги
  называются Новый диалог» (Р2 из анализа 2026-06-27).
- **КФ2 — дом Мастера (frontend).** `/chat` десктоп = `MasterChatHome`
  (`frontend/app/(authenticated)/chat/MasterChatHome.tsx` + `MasterConversation.tsx` +
  редьюсер `src/ui/chat/master-chat-events.ts`) на движке concierge: список диалогов слева
  (`conciergeApi.listConversations`), история по выбору (`getConversation`), стрим ответа
  (SSE + polling-fallback), markdown, цитаты passthrough, действия+undo+table-preview,
  переключатель «Помощник / Клон» (`AssistantTargetSelect`), `asOf`. Data-слой:
  `src/domain/concierge-conversation.ts` (маппер), `src/hooks/useConciergeConversations.ts` +
  `useConciergeConversation.ts` (SWR). `concierge.api.ts`: `ConciergeStreamEvent.message`
  += `citations`/`needsClarification`, добавлен `confirm_required`; body += scope/scopeRefId/asOf;
  `ConciergeConversationApi` += `titlePreview`.
- **КФ3 — scoped-чат.** `src/ui/chat/MasterScopedChat.tsx` (+`MasterCitations.tsx`) —
  переиспользуемый scoped-чат Мастера (concierge+scope, markdown/цитаты/действия/опц.
  голос+TTS/suggestedPrompts). `IssueChat` (scope:issue) и мобильный `MobileAskClient`
  (scope:org) → тонкие обёртки над ним.
- **КФ4 — двери.** nav-config: пункт «Спросить» (/chat) открыт лидерским ролям (Р1 —
  владелец реально не видел вход); `/memory` → дверь «Спросить у Мастера» (Р3); FAB
  `ConciergeFloatingButton` → кнопка-навигация в /chat (поповер демонтирован, решение
  владельца из анализа 2026-06-27). Cmd+K: `runAiAsk` ('?') → `conciergeApi.askOnce`
  (был `chatV2Api.ask`); '?' и '>' оба на concierge.
- **КФ5 — чистка.** Удалил 9 сирот: `ChatV2Client`(+spec), `OrgChatPanel`,
  `AssistantClient`, `ConciergeChat`, `ConciergeClonesTab`(+spec), `ConciergeSlot`,
  `chat-v2/ChatPanel`.

## Что вышло

- typecheck / lint / build / vitest — **зелёные** на back и front.
- Бизнес-эффект: вместо 3 движков за 4+ входами — один Мастер; десктоп-дом получил
  список диалогов с человекочитаемыми названиями, действия и историю в одном окне;
  владелец видит вход «Спросить» из меню (Р1 закрыт).
- **Не сделано (вынесено в под-ТЗ):**
  - `MeetingChatPanel` → [`2026-06-28-meeting-chat-on-master-scoped.md`](../../plans/tz/2026-06-28-meeting-chat-on-master-scoped.md)
    (нужны `speakerName`/`onSeek`/история поверх `MasterScopedChat` scope:meeting).
  - pin/archive/feedback в доме → [`2026-06-28-concierge-conversation-management-parity.md`](../../plans/tz/2026-06-28-concierge-conversation-management-parity.md).
- **Визуальная приёмка прода — pending** (нет локального запуска UI → `qa-tester` на
  korateam.ru). Строки в реестре [[../04_не-сделано/README]].

## Чему научился

1. **После миграции компонента ВСЕГДА прогоняй тест-файл этого компонента целиком.**
   `MobileAskClient.test` упал из-за неотмоканного `useRouter` внутри `MasterScopedChat`
   (мигрированной зависимости) — поймал это только на КФ5, хотя сломалось на КФ3. Почему:
   тесты обёртки `MobileAskClient` дёргают её новую внутренность (`MasterScopedChat`), у
   которой свои хуки роутера — мок родителя их не покрывает. Как делать: при превращении
   компонента в обёртку над новым — сразу `bunx vitest run <обёртка>.test` целиком, не
   только изменённый кейс; тесты модуля ловят кросс-фазные регрессии, которые точечный
   прогон пропускает.
2. **Отколотая «под глаза» фаза легко выпадает из горячего пути** (повтор урока из
   2026-06-27): фронт-консолидацию однажды откололи под визуальную приёмку и она зависла
   на месяц. Закрыл её и сразу поставил остаток (MeetingChatPanel, parity, приёмка)
   явными строками в [[../04_не-сделано/README]] — иначе «under-glasses»-хвосты теряются.
3. **«Названия диалогов» — это бэкенд-долг, не фронт-косметика.** «Все диалоги = Новый
   диалог» (Р2) чинится не на фронте, а полем `titlePreview` с бэка (первое user-сообщение):
   фронту нечем было назвать диалог, потому что API не отдавал заголовок. Косметический
   на вид баг оказался отсутствующим контрактом.

## Что осталось

- `MeetingChatPanel`-миграция (под-ТЗ `2026-06-28-meeting-chat-on-master-scoped`).
- pin/archive/feedback дома Мастера (под-ТЗ `2026-06-28-concierge-conversation-management-parity`).
- Визуальная приёмка chat-surface на проде (`qa-tester`, korateam.ru).

## Прод-команды

Не нужны: изменения только в `backend/src` (DTO/сервис/хелпер, без миграций/seed/ENV)
и `frontend/` (UI/хуки/домен). Новых таблиц/колонок/очередей/ENV нет.
