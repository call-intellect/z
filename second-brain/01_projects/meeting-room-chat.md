---
title: In-meeting чат участников (с persist)
status: actual
updated: 2026-05-09
---

# In-meeting чат участников

## Что это

Текстовый чат **внутри** видеовстречи (отдельно от AI-чата по результату). Реализован 2026-05-09 по `plans/tz/2026-05-09-meeting-room-chat.md`. До этого работал только в realtime через LiveKit DataChannel — теперь сохраняется в БД.

## Как работает

### Realtime
LiveKit `useChat()` хук в [frontend/src/ui/components/meeting-room/ChatPanel.tsx](frontend/src/ui/components/meeting-room/ChatPanel.tsx) рассылает сообщения участникам через DataChannel (peer-to-peer через SFU). Это не меняется — это основной канал доставки.

### Persist
**Только отправитель** делает POST `/api/v1/meetings/:id/room-messages` `{ clientMessageId, content }`:
- `clientMessageId = nanoid(20)` — генерируется на фронте, гарантирует идемпотентность POST'а.
- В LiveKit-сообщение прокидывается `attributes.clientMessageId` — получатели дедупят по нему свои сообщения (чтобы не было дубля «прилетело по DC + загружено из истории»).
- На сетевую ошибку POST'а — toast «Сообщение не сохранено в истории, но участники его получили», маркер `⚠` в UI на сообщении.

### History на join
При входе в комнату фронт делает GET `/api/v1/meetings/:id/room-messages` → подгружает историю. В UI — серый divider «До твоего присоединения» между историей и live-сообщениями.

## Авторизация

Гость авторизуется отдельной cookie `guest_session_<meetingId>` (выдаётся при `/access` flow), не `z_session`. Backend имеет собственный [MeetingMemberGuard](backend/src/modules/room-messages/guards/meeting-member.guard.ts) который пробует обе cookie.

`apiClient.credentials: 'include'` шлёт обе автоматически.

## DB

```prisma
model MeetingRoomMessage {
  id              String   @id @default(cuid())
  meetingId       String
  meeting         Meeting  @relation(...)
  participantId   String?              // SetNull если участник удалён
  participant     Participant?
  authorName      String               // денормализация — имя на момент отправки
  authorIdentity  String               // LiveKit identity на момент отправки
  content         String   @db.Text
  clientMessageId String   @unique     // для идемпотентности POST
  sentAt          DateTime @default(now())

  @@index([meetingId, sentAt])
}
```

Каскад: `onDelete: Cascade` на Meeting → soft-delete встречи через 30 дней дотащит и сообщения.

## Backend

| Метод | Путь | Описание |
|---|---|---|
| `POST` | `/api/v1/meetings/:meetingId/room-messages` | `{ clientMessageId, content }`. Throttle 30/мин. Идемпотентно: повтор → 200 с тем же row. |
| `GET` | `/api/v1/meetings/:meetingId/room-messages?since=<ISO>` | История asc, лимит 1000. |

Файлы: [backend/src/modules/room-messages/](backend/src/modules/room-messages/) — controller/service/repository/dto/exceptions/guard.

## Public share — allowChat

`MeetingShare.allowChat: Boolean @default(false)` — тумблер «Чат участников» в [ShareDialog.tsx](frontend/src/ui/components/meeting-result-v2/ShareDialog.tsx). Если true — публичный `GET /api/v1/public/share/:token` отдаёт `messages[]` в payload, страница `/share/[token]` рендерит блок чата.

## AI-pipeline

ENV `INCLUDE_ROOM_CHAT_IN_AI=true` (default true) → [merger.ts](backend/src/modules/ai/services/merger.ts) дописывает в merged-объект ключ `roomChat: [{ sentAt, authorName, content }]`. [prompts/common.ts](backend/src/modules/ai/services/prompts/common.ts) объясняет Claude как использовать чат: цитировать решения, ловить ссылки/ID/имена которые упоминались только в чате.

Метрика стоимости: ~5–10% к input-tokens на разговорной встрече. Если станет дорого — флаг в `false`.

## Страница результата встречи

6-й таб **«Чат»** в [MeetingResultPageReal.tsx](frontend/src/ui/components/meeting-result-v2/MeetingResultPageReal.tsx) между Transcript и Action items: список с группировкой подряд идущих сообщений одного автора, поиск client-side, empty state.

## Лимиты / safety

- `MAX_ROOM_MESSAGE_CHARS=2000` (counter в UI появляется при >1800)
- Throttle 30 send/мин на пользователя
- Idempotency через `clientMessageId @@unique` — повторный POST не плодит дубли при retry/race
- Дедуп фронта между history+live — `Set<clientMessageId>`

## Что НЕ делает (by design)

- Файлы / картинки / реакции — только текст
- Приватные DM между участниками
- Редактирование/удаление после отправки
- E2E-шифрование (тот же уровень доверия, что и видео встречи)
- Threaded replies, mentions с уведомлениями
- Webhook от LiveKit на `data_received` — не существует у LiveKit Server для DataChannel
