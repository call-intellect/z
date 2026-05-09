---
type: tz
status: done
feature: meeting-room-chat
date: 2026-05-09
---

# ТЗ: Сохранение in-meeting чата участников

> Источник: вопрос владельца на ревью эталонов 2026-05-09 — «во время видеовстречи у нас есть чат для участников и он сохраняется переписка из него?»
>
> Текущее состояние: in-meeting чат работает через LiveKit DataChannel (компонент `<Chat />` из `@livekit/components-react`), переписка **не сохраняется** в БД. Это решение MVP, см. комментарий в [frontend/src/ui/components/meeting-room/ChatPanel.tsx:13](frontend/src/ui/components/meeting-room/ChatPanel.tsx#L13).
>
> Связанные ТЗ: `plans/tz/2026-05-09-ai-meeting-workspace.md` (там есть `MeetingChatMessage` для AI-чата по результату — это **другая** сущность, не путать).

## Цель

Сохранять переписку чата встречи в БД, чтобы:
1. Опоздавший гость получил историю при входе.
2. После завершения встречи переписка была видна на странице результата (отдельный таб).
3. AI-отчёт мог опционально учитывать чат как доп. контекст к транскрипту (полезно для решений «договорились в чате», «ссылка на доку», «ник в Slack»).

## Scope

**Входит:**
- Модель `MeetingRoomMessage` в Prisma + миграция через `db push`.
- Backend модуль `room-messages/` с REST API (POST/GET, защищённый `CookieAuthGuard`).
- Перехват сообщений во фронте: вместо стокового `<Chat />` — собственный UI поверх `useChat()` хука LiveKit, который параллельно POST'ит каждое отправленное сообщение в наш backend и подгружает историю на mount.
- Новый таб «Чат» на странице результата встречи (внутри 5-табового layout — становится 6 табов или встраивается в Transcript-таб как блок). Решение: отдельный 6-й таб «Чат» (Tabs позволяют, в дизайн-системе motion-indicator потянет).
- Подмешивание чата в `merger.ts` AI-pipeline (опционально, через флаг `INCLUDE_ROOM_CHAT_IN_AI=true` — дефолт `true`).
- Retention — вместе со встречей: `onDelete: Cascade` на `Meeting`.

**Не входит:**
- Файлы / картинки / эмодзи-реакции (только текст).
- Приватные сообщения (DM между участниками).
- Редактирование/удаление сообщения после отправки.
- Threaded-replies / mentions с уведомлениями.
- E2E-шифрование сообщений (используем тот же уровень доверия, что и для остального контента встречи).
- Экспорт чата отдельным файлом (попадёт в bulk_zip md-генератор автоматически).
- Webhook от LiveKit на `data_received` — DataChannel-сообщения **не уходят** через webhook у LiveKit Server по умолчанию. Полагаемся только на наш fronted POST.

## Технические изменения

### База данных

Новая модель в `backend/prisma/schema.prisma`:

```prisma
model MeetingRoomMessage {
  id              String   @id @default(cuid())
  meetingId       String
  meeting         Meeting  @relation(fields: [meetingId], references: [id], onDelete: Cascade)
  participantId   String?  // null если участник вышел и был удалён до записи (граничный случай)
  participant     Participant? @relation(fields: [participantId], references: [id], onDelete: SetNull)
  /** Денормализация — имя на момент отправки, чтобы не зависеть от существования Participant. */
  authorName      String
  /** Идентичность LiveKit на момент отправки — для дедупа при re-POST. */
  authorIdentity  String
  content         String   @db.Text
  /** Идемпотентность POST: фронт генерирует ulid при отправке, backend `@@unique`. */
  clientMessageId String   @unique
  sentAt          DateTime @default(now())

  @@index([meetingId, sentAt])
}
```

В `Meeting` — добавить relation `roomMessages MeetingRoomMessage[]`.

В `Participant` — добавить relation `roomMessages MeetingRoomMessage[]`.

Применение: `bunx prisma db push` (правило проекта — никаких migrate).

### Backend

Новый модуль `backend/src/modules/room-messages/`:

```
room-messages/
  room-messages.module.ts
  room-messages.controller.ts
  room-messages.service.ts
  room-messages.repository.ts
  dto/
    send-room-message.dto.ts
    list-room-messages.dto.ts
  room-messages.service.spec.ts
```

#### Эндпоинты (под `/api/v1`, защищены `CookieAuthGuard`):

| Метод | Путь | Описание |
|---|---|---|
| `POST` | `/meetings/:meetingId/room-messages` | `{ clientMessageId, content }`. Валидация: `content.length 1..2000`. Проверка ownership: `currentUser.id === meeting.ownerId` ИЛИ есть `Participant(meetingId, userId=currentUser.id)`. Идемпотентность: `clientMessageId @@unique` — повторный POST → 200 с уже сохранённым. На success — `MeetingRoomMessage` создан, `participantId` подставляется по `(meetingId, userId)` если есть. |
| `GET` | `/meetings/:meetingId/room-messages?since=<ISO>` | История сообщений встречи в порядке `sentAt asc`. Опц `since` — для poll'инга. Проверка ownership та же. Лимит — последние 1000 сообщений (для встреч до 10 человек × 8 часов этого хватит). |

Гостевой доступ:
- Гость авторизован тем же `z_session` cookie после `/access` flow → `CookieAuthGuard` пропускает.
- Проверка участия: `Participant.userId = currentUser.id` ИЛИ (для гостей без userId) `Participant.livekitIdentity = currentUser.livekitIdentity` — это поле кладём в JWT при выпуске access-токена. **Если такого поля в JWT нет — добавляем** (это маленькое расширение, нужно проверить `JwtService.signAccess`).

#### Лимиты / safety
- `MAX_ROOM_MESSAGE_CHARS=2000` (новый ENV в `WorkspaceLimitsSchema`).
- Throttler на POST: 30 сообщений / минуту на участника (`@Throttle({ default: { limit: 30, ttl: 60_000 } })`).

#### Регистрация
- В `app.module.ts` добавить `RoomMessagesModule`.

### Frontend

#### Замена `<Chat />` на собственный UI поверх `useChat()`

`frontend/src/ui/components/meeting-room/ChatPanel.tsx` — переписать. Вместо стокового `<Chat />`:

```tsx
const { send, chatMessages } = useChat(); // хук из @livekit/components-react
```

Логика:
1. **На mount** (после подключения к комнате) — GET `/api/v1/meetings/:id/room-messages` → `historyMessages`.
2. **Объединение**: показываем `[...historyMessages, ...chatMessages.filter(m => m.timestamp > joinedAt)]`. Сообщения из истории — серым «отправлено до твоего присоединения», свежие — мятным.
3. **На onSend** (нажатие Enter в input):
   - Генерим `clientMessageId = ulid()`.
   - Вызываем LiveKit `send(text, { topic: 'chat' })` — сообщение разлетается участникам в realtime через DataChannel.
   - Параллельно POST `/api/v1/meetings/:id/room-messages` `{ clientMessageId, content }`.
   - На сетевую ошибку POST'а — toast «Сообщение не сохранено в истории, но участники его получили». Сообщение остаётся в UI.
4. **На прилетевшее DataChannel-сообщение от другого участника** — добавляем его в локальный state. Backend POST'ит **только отправитель** (тот, кто это сообщение написал) — иначе будет N-кратное дублирование.
5. **Идемпотентность**: если сообщение пришло из истории и оно же есть в `chatMessages` (граничный случай при reload) — дедупим по `clientMessageId`.

UI:
- Сохранить визуальный язык дизайн-системы (mint accent, glass).
- Системная плашка при join: «Кто-то присоединился — старые сообщения скрыты до их видимости». Решение: показываем ВСЕ исторические сразу, отделяем визуально — серый divider «До твоего присоединения».
- Скролл вниз на новое сообщение (если юзер был внизу).
- В sidebar AppShell иконка Chat с badge непрочитанных (если пользователь свернул панель).

#### API-обёртка

`frontend/src/api/room-messages.api.ts` — `getHistory(meetingId, since?)`, `send(meetingId, body)`.

#### Domain

`frontend/src/domain/room-message.ts` — `RoomMessage` тип + mapper.

#### Страница результата встречи

`frontend/src/ui/components/meeting-result-v2/MeetingResultPageReal.tsx` — добавить **6-й таб «Чат»**:
- Список сообщений в хронологии: автор + текст + timestamp.
- Группировка подряд идущих сообщений одного автора.
- Поиск по содержимому (input сверху).
- Empty state: «Во время встречи никто не писал в чат».

В компоненте Tabs от M4 — motion-indicator уже поддерживает динамическое количество.

#### Public share

`MeetingShare` — добавить флаг `allowChat: Boolean @default(false)` (как `allowVideo`/`allowTranscript`/`allowTasks`/`allowChapters`).

В `SharesController.create` DTO — расширить.

В `PublicShareController.getMeeting` — отдавать messages если `allowChat=true`.

В диалоге `ShareDialog.tsx` — добавить тумблер «Чат».

### AI-pipeline (опциональное подмешивание)

`backend/src/modules/ai/services/merger.ts` — расширить:
- ENV: `INCLUDE_ROOM_CHAT_IN_AI=true` (новый, default true).
- Если включено: после merge per-track транскриптов — дописать в результирующий JSON отдельный блок `roomChat: [{ sentAt, authorName, content }]`.
- В `analyze.worker` промпт уже видит весь merged-объект — Claude получит чат как доп. контекст, без отдельной обработки.

`backend/src/modules/ai/services/prompts/common.ts` — дописать пояснение в system: «В контексте может быть блок `roomChat` — это переписка участников в чате во время встречи. Используй её как доп. источник для решений и ссылок».

### ENV (для `.env`)

Новые ключи (добавлю в `.env.example`):
- `MAX_ROOM_MESSAGE_CHARS=2000`
- `INCLUDE_ROOM_CHAT_IN_AI=true`

Без секретов. Можно не задавать — есть defaults.

## Критерии готовности (DoD)

- [ ] Prisma schema расширена `MeetingRoomMessage`, `bunx prisma generate` зелёный.
- [ ] Backend: POST/GET endpoints работают, защищены auth, идемпотентны, throttle.
- [ ] Backend unit-тесты на `RoomMessagesService` (ownership, идемпотентность, лимит длины).
- [ ] Frontend `ChatPanel.tsx` загружает историю при join, POST'ит при send, не дублирует.
- [ ] Гость, опоздавший на 5 минут, видит сообщения, отправленные до его прихода.
- [ ] Завершилась встреча → на странице результата таб «Чат» показывает всё, что было в чате.
- [ ] Диалог Share позволяет открыть чат публично (через `allowChat`).
- [ ] При завершённой встрече с непустым чатом — AI-отчёт упоминает то, что обсуждалось в чате (вручную проверить на одной встрече).
- [ ] Soft-delete встречи каскадом удаляет MeetingRoomMessage (ничего отдельно делать не нужно — `onDelete: Cascade`).
- [ ] `bun run typecheck` + `bun run test:unit` зелёные backend и frontend.
- [ ] `bun run build` собирается frontend.
- [ ] Second-brain: `01_projects/meeting-room-chat.md` — новая заметка.

## Риски и ограничения

- **Сетевая ошибка POST'а во время отправки**. Сообщение участники увидели через DataChannel, но в БД не сохранилось. Митигация: toast пользователю + сохраняем сообщение в IndexedDB локально как «не доставлено» + retry при reconnect. На MVP — пропускаем retry, только toast и попытка сохранить локально.
- **Дублирование при двух девайсах одного юзера**. Если человек отправил с десктопа и лагает — повторил с телефона: оба POST'а с разными `clientMessageId` → сохранятся два сообщения. Это OK для MVP (он сам видит дубль и поймёт). Реальная защита — debounce input на стороне юзера.
- **Race condition GET history vs realtime**. Юзер join'ится, GET history возвращает 100 сообщений. Параллельно прилетает 101-е через DataChannel. UI должен дедупить по `clientMessageId`. Если LiveKit DataChannel-сообщение не несёт `clientMessageId` — дедуп по `(authorIdentity, content, sentAt±2s)`. Решение: в send() передаём `clientMessageId` через `topic` или `messagePayload` поле — LiveKit Chat-сообщение передаёт metadata.
- **Гость без userId**. Backend не может проверить ownership через `userId`. Полагаемся на `livekitIdentity` в JWT — нужно проверить, что `JwtService.signAccess` его кладёт. Если нет — добавляем.
- **Privacy опоздавшего гостя**. Если в чате до его прихода обсуждали приватное — он это увидит. **Это by-design**: чат внутри встречи общий. В UI — серый divider «До твоего присоединения», чтобы было понятно. Если хост хочет приватности — пусть пишет в Slack.
- **Размер БД**. 100 встреч × 200 сообщений × 200 символов = ~4 МБ. Не проблема.
- **AI-pipeline стоимость**. Подмешивание чата в merged-context увеличивает входной токен-counter на ~5–10% для разговорной встречи. Acceptable. Если станет дорого — флаг `INCLUDE_ROOM_CHAT_IN_AI=false`.

## Фазы реализации

- [ ] **Фаза 1 — Prisma + Backend**
  - `MeetingRoomMessage` в schema.prisma + relations в Meeting/Participant
  - `prisma generate`
  - Модуль `room-messages/` (controller/service/repository/dto/spec)
  - Регистрация в AppModule + Throttler
  - ENV `MAX_ROOM_MESSAGE_CHARS`, `INCLUDE_ROOM_CHAT_IN_AI`
  - typecheck + test:unit зелёные

- [ ] **Фаза 2 — Frontend in-room**
  - API-обёртка `room-messages.api.ts` + domain `room-message.ts`
  - Перепиcaть `ChatPanel.tsx` поверх `useChat()` с history+POST
  - Дедуп через `clientMessageId` в metadata DataChannel-сообщения
  - Tooltip «До твоего присоединения» divider
  - Toast на ошибку POST

- [x] **Фаза 3 — Frontend результат + share**
  - [x] 6-й таб «Чат» в `MeetingResultPageReal.tsx` (между Transcript и Action items, с поиском и группировкой)
  - [x] Поиск по чату (client-side filter)
  - [x] `allowChat` в `MeetingShare` (Prisma + DTO + ShareDialog Switch + PublicShareController)
  - [x] Public share с allowChat — отдаёт `messages[]` в payload, `/share/[token]` рендерит блок чата

- [x] **Фаза 4 — AI-pipeline**
  - [x] `merger.ts` подмешивает roomChat в merged-объект (`loadRoomChatForMerge` + ключ `roomChat?` в payload `merge.worker`)
  - [x] Промпт `prompts/common.ts` объясняет roomChat (`RoomChatMessage` + `withRoomChatNote` + `turnsToText` с блоком «Чат встречи»)
  - [x] `analyze.worker` пробрасывает `roomChat` во все 5 prompt builders (summary, custom, structured-by-type, follow-up, tasks)
  - [x] Тесты merger.spec.ts: 3 кейса для `loadRoomChatForMerge` (true+rows / true+empty / false)
  - [ ] Ручная проверка на одной встрече: AI-отчёт упоминает то, что обсуждалось в чате (после Phase 1-3)
  - Отложено: подмешивание чата в parallel post-analyze стадии (chapters / tasks-extract / regenerate-section) — out of scope текущего ТЗ, отдельные builders с собственными `*PromptInput`

- [x] **Фаза 5 — Регрессии и second-brain**
  - [x] Backend typecheck=0, **357/357 unit-тестов passed**, build success
  - [x] Frontend typecheck=0, **lint=0**, build success (29 страниц, `/m/[id]` 161kB, `/share/[token]` 3.77kB)
  - [x] Заметка `second-brain/01_projects/meeting-room-chat.md` создана
  - [x] Существующие spec'и шейров и accounts не сломаны после расширения `allowChat`
  - Ручные регрессии (Crossmark deep-link / гостевой join / `INCLUDE_ROOM_CHAT_IN_AI=false`) — требуют живой БД и LiveKit, делает пользователь после `prisma db push`

## Итог

**Реализовано целиком (2026-05-09).** Все 5 фаз закрыты.

### Что вошло
- **Backend (M-rc1):** Prisma `MeetingRoomMessage` + `Meeting.roomMessages` + `Participant.roomMessages`. Модуль `room-messages/` с POST/GET, идемпотентностью через `clientMessageId @@unique`, throttle 30/мин, собственный `MeetingMemberGuard` поверх `z_session` + `guest_session_<meetingId>`. ENV `MAX_ROOM_MESSAGE_CHARS=2000`. 14 unit-тестов.
- **Backend extras (M-rc1.5):** `MeetingShare.allowChat: Boolean @default(false)`, расширен `CreateMeetingShareSchema`, `SharesService.createMeetingShare`, `PublicMeetingSharePayload.messages?[]`. `SharesRepository.listRoomMessages`. Audit-log получает `allowChat` в metadata.
- **Frontend (M-rc2):** `room-messages.api.ts` + `domain/room-message.ts` + `use-meeting-room-messages.ts`. ChatPanel переписан с `<Chat />` на `useChat() + useLocalParticipant()` с history POST/GET, дедупом через `Set<clientMessageId>`, sticky-bottom скроллом, divider «До твоего присоединения», counter символов >1800, маркером ⚠ при `notPersisted`. 6-й таб «Чат» (Transcript → Чат → Задачи) с поиском и группировкой. `ShareDialog` тумблер «Чат участников». Public share `/share/[token]` рендерит блок чата.
- **AI-pipeline (M-rc3):** `merger.ts` экспортирует `loadRoomChatForMerge({prisma, cfg, meetingId})`. `merge.worker` дописывает `roomChat?` в S3 merged.json. `prompts/common.ts` — `RoomChatMessage` тип + `ROOM_CHAT_SYSTEM_NOTE` + `withRoomChatNote()` + `turnsToText` дописывает блок «Чат встречи». Все 9 type-prompts + system-summary + follow-up + tasks обновлены через единый helper. `analyze.worker` пробрасывает `roomChat` во все 5 run* методов. ENV `INCLUDE_ROOM_CHAT_IN_AI=true`. +3 unit-теста.

### Что осталось
- **`prisma db push` на dev/prod БД** — пользователь.
- **Подмешивание чата в parallel post-analyze стадии** (`chapters.worker`, `task-extraction.service`, `regenerate.service`) — out of scope: у них собственные `*PromptInput` интерфейсы, не общий `PromptInput`. Если потребуется — отдельный мини-ТЗ.
- **Ручная проверка** на одной живой встрече, что AI-отчёт упоминает чат — пользователь после `db push`.

### Финальные метрики
- Backend: **357/357 unit-тестов passed**, typecheck=0, build success.
- Frontend: typecheck=0, lint=0, build success.
- Новых ENV-ключей в `.env.example`: 2 (`MAX_ROOM_MESSAGE_CHARS`, `INCLUDE_ROOM_CHAT_IN_AI`) — оба с дефолтами, заполнять необязательно.
