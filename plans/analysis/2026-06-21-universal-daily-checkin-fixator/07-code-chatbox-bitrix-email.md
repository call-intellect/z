---
type: analysis
status: research-input
feature: universal-daily-checkin-fixator
date: 2026-06-21
snapshot_date: 2026-06-21
segment: код — каналы-переписки chatbox / Bitrix / email как источники чек-инов + атрибуция автор-сотрудник
---
# Код Z: chatbox / Bitrix / email — переписки как источник дневных сигналов

Уточнение владельца (2026-06-21): фиксатор должен доставать план/отчёт не только из telegram-лички, но из ЛЮБОГО канала с перепиской — Bitrix, почта через chatbox, прочие. Если в переписке за день есть план на день И отчёт — учитывать. Эта карта проверяет, реально ли это и при каких условиях.

## 1. chatbox-ingest.service.ts — структура переписки
**Файл:** `backend/src/modules/chatbox/chatbox-ingest.service.ts:304-322`
```ts
payload = { kind:'chatbox_chat_session', chatExternalId, sessionId, sessionSeq, channelType,
  customer{externalId,name}|null, responsible{externalId,name,personId}|null,
  messages:[{ at, from: senderType==='CLIENT'?'client':'manager', name, text }],
  fullText, transcript:{turns} }
```
`ChatboxMessage`: `senderType: ChatboxSenderType (CLIENT|USER|ASSISTANT|QUALITY_CONTROL)`, `senderExternalId`, `senderName`, `text`, `externalCreatedAt`, `isOutboundFromKora`. Группировка: по сессии (день/период) → чату (диалог customer↔manager). **chatbox = клиентские переписки**, есть явный признак CLIENT vs manager.

## 2. Bitrix — ВНУТРЕННИЕ диалоги сотрудников
**Файлы:** `bitrix/bitrix-sync.service.ts`, `bitrix-ingest.service.ts`, `bitrix-integration.controller.ts`. OAuth → `im.recent.get` (type `user`=private, `chat`=групповой) → `im.message.get`.
`bitrix-ingest.service.ts:228-319`:
```ts
payload = { kind:'bitrix_dialog_session', dialogExternalId, dialogTitle, dialogType,
  messages:[{ at, from: authorMap.get(authorExternalId)?.name, authorExternalId, text }],
  transcript:{ turns:[{ speaker, text, authorPersonId: author?.personId ?? null }] } }
```
`enum BitrixDialogType`: `chat` (групповая рабочая группа) | `private` (1:1 сотрудник↔сотрудник). **ВЫВОД: Bitrix = только внутренние диалоги сотрудников, не клиенты.** Это и есть «рабочая группа, куда скидывают отчёты».

## 3. email — отдельный source, НЕ через chatbox
`ingest/adapters/email/email-fetch.service.ts`: SourceType `'email'`, payload `{messageId, from{name,address}, to, cc, subject, date, text, fullText, html, attachments}`. Читается из IMAP, в chatbox не втекает. `conversational` (free_note) — отдельный источник свободных заметок сотрудников.

## 4. КРИТИЧНО — атрибуция автор-сотрудник vs внешний контакт
| Источник | Клиент/внешний | Сотрудник | Резолв в Person |
|---|---|---|---|
| chatbox | `senderType='CLIENT'` → senderPersonId=null | `senderType='USER'`+senderExternalId | `ChatboxMember.linkedPersonId` (ручная связь) |
| Bitrix | нет (только internal) | authorExternalId | `BitrixUser.linkedPersonId` (ручная связь) |
| email | from.address внешний | — | нет резолва в Person |

- chatbox: `chatbox-chats.service.ts:265-295` — фильтр `senderType!=='CLIENT' && senderExternalId` → `ChatboxMember.findMany({linkedPersonId:{not:null}})` → `senderPersonId` (может быть null).
- Bitrix: `bitrix-ingest.service.ts:127-142,258-280` — `resolveAuthors` → `BitrixUser.linkedPersonId` → `transcript.turns[].authorPersonId` (может быть null).
- **Авто-связь (linkMode='auto') в enum есть, но В КОДЕ НЕ РЕАЛИЗОВАНА** — связывание только ручное (`linkMode='manual'`). Если `linkedPersonId=null` → `authorPersonId=null` → **сообщение нельзя приписать сотруднику**.

## 5. Нативного team-чата нет
Отдельного «Кора-Чат»/internal messenger в коде нет. Все внутренние чаты сотрудников = Bitrix IM (`private`/`chat`). Грепы team chat / internal messenger / room / channel — пусто.

## 6. История за период доступна для переразбора (в отличие от Telegram Bot API)
`RawEvent` хранит полный payload (inline/S3), `occurredAt`, идемпотентность `sha256(sourceId:dedupBasis:occurredAt)`. Данные chatbox/bitrix/email **уже в БД** → cron может взять «все сообщения автора X за день» переразбором сохранённого. Это снимает ограничение Telegram Bot API (нет истории) — оно касалось ТОЛЬКО сценария «бот в Telegram-группе», но НЕ chatbox/Bitrix/email (втекли через их REST API/IMAP).

## Вывод для решения
- Bitrix (внутренние чаты) — **первоклассный источник дневных сигналов**; chatbox (клиентские) — вторичный/опциональный (там сервис клиента, не план/отчёт сотрудника); email — внешняя переписка.
- **Узкое место — атрибуция:** без связи BitrixUser/ChatboxMember → Person отчёт не припишется. Авто-связь надо достраивать (по email/ФИО), иначе фича не взлетит на 30 сотрудниках.
- «Забор раз в сутки» для этих каналов реален как дневной переразбор сохранённого RawEvent по сотруднику.

Enum SourceType (schema.prisma:251-287): meeting, chat, phone_call, bot, email, web_form, external, conversational, tracker_event, chatbox, daily_checkin, meeting_report, bitrix.
