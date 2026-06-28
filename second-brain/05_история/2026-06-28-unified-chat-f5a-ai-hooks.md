---
date: 2026-06-28
feature: unified-chat Ф5a — AI-крючки (chat.ingest + voice ASR + системное сообщение закрытия встречи)
branch: feat/unified-chat-kora
distilled: false
---

# Ф5a — AI-крючки единого чата

## Что было поставлено
ТЗ `plans/tz/2026-06-21-unified-chat-kora-tz.md` Ф5, часть «a»: (1) `chat.ingest` — наши сообщения чата кормят граф (R17); (2) voice ASR — `Message.voiceUrl` → `voiceTranscript` через Vox; (3) системное `Message(authorType='system')` в связанный work_chat при закрытии встречи (R20); (4) проверка приватности R18.

## Как решал
- **chat.ingest:** новая очередь `chat.ingest` (`messaging/queue/chat-ingest.queue{,.service,.worker}.ts`) + `services/chat-ingest.service.ts` (`ingestMessage`). Триггер — в `message-outbox.worker.relay()` ПОСЛЕ `markSent` (best-effort try/catch): один источник `Message`, без двойного ingest. Skip: `!feedsGraph` / `authorType='system'` / `deletedAt` / пустой текст. `ingest.ingest(kind='chat_message', sourceExternalId='msg:<id>', dataClass='internal')` под отдельным `Source(type='chat', name='Сообщения Коры')` (мост Ф0 — другое имя 'Внешние чаты (мост)'). Идемпотентно: jobId `chat-ingest:<id>` + RawEvent dedup по `msg:<id>`.
- **voice ASR:** очередь `voice.transcribe` + `VoiceTranscribeWorker` (S3 `extractKeyFromUrl`→`getObject` по образцу `TranscribeWorker`, `Vox.submit`+`poll`). Триггер — `MessageService.sendMessage` на `voiceUrl` (helper `maybeEnqueueVoiceTranscribe`). Транскрипт втекает в граф так: после записи `voiceTranscript` worker пере-enqueue'ит `chat.ingest`, а `chat-ingest.service` берёт `text = decrypt(content) || voiceTranscript` (т.е. пустой content → транскрипт).
- **meeting-close:** в `meetings.service.transitionStatus` после коммита транзакции — на `toStatus ∈ {ai_ready, ai_failed}` (а не `completed`: только там реально есть `Recording.mainVideoUrl` + `AiResult.summaryFast/summary`) зову `postMeetingClosedToLinkedChats`. Для каждой `Issue where linkedMeetingIds has meetingId` → `ensureWorkChat` + `MessageService.appendSystemMessage` (новый метод: `authorType='system'`, `access='normal'`, outbox). Идемпотентно `clientMessageId='meeting-closed:<id>'`. Всё в try/catch — не ломает FSM. Нет задач → no-op.
- **Флаг:** `CHAT_INGEST_ENABLED` (zBool true) в `env.schema` + `chat.ingestEnabled` getter + `KEEP_ENV_KEYS` (рядом с `CHAT_ENABLED`/`EXTERNAL_CHAT_ENABLED`) + `feature-flags.md`.
- **DI:** `MessagingModule` теперь провайдит/экспортит `ChatIngest{Queue,}Service`, `VoiceTranscribeQueueService`, `ChatIngestService`; воркеры `ChatIngestWorker`/`VoiceTranscribeWorker` — в `ai/workers.module`. `MeetingsModule` импортирует `MessagingModule` (цикла нет — messaging не ссылается на meetings).

## Что вышло
- typecheck зелёный, `eslint` 0 errors (1 pre-existing import-order warning автофикснут), `tsc -p tsconfig.build.json` exit 0 (обычный `bun run build` падал на heap — нужен `--max-old-space-size=8192`).
- vitest: messaging+ai 639 passed; +meetings+config 272 passed. Новые/правленые специи: `chat-ingest.service.spec` (7), `voice-transcribe.worker.spec` (4), `meetings.service.meeting-closed-chat.spec` (3), правка `message-outbox.worker.spec` (+4 chat.ingest), правка `message.service.spec`/3 meetings-specs под новые конструкторы.

## Чему научился
- **Грабля конструкторов в unit-специях:** добавление DI-параметра в `MessageService` (+1) и `MeetingsService` (+2) ломает ВСЕ позиционные `new X(...)` в специях — typecheck сразу краснеет десятком TS2554. Лечится массовым `perl -0pi` по стабильному хвосту аргумента.
- **`env-classification.guard.spec`:** ЛЮБОЙ новый ключ в `EnvSchema` обязан попасть в `KEEP_ENV_KEYS` или `ADMIN_FALLBACK_ENV_KEYS`, иначе падает гард. Kill-switch ENV (code-default) → `KEEP_ENV_KEYS`.
- **`new PrismaClient()` тут не нужен** — всё через инжектируемый `PrismaService`; скриптов не добавлял.
- **Точка хука закрытия встречи:** буквальный «completed» из ТЗ беден данными (нет записи/резюме); реальный момент с записью+резюме — `ai_ready`/`ai_failed`. Идемпотентность по `meeting-closed:<id>` страхует от повторов.

## Честный «не сделал / под вопросом»
- Реализована только Ф5a. Ф5b (R19: «Спросить Кору»/сообщение→задача/решение, taskType `chat-summary` «Что пропустил», `seed-llm-task-routes-chat.ts`, `chat-summary.prompt.ts`) — НЕ делал, помечено TODO в статус-таблице ТЗ.
- DI-граф проверен статически (typecheck/build + ручная сверка модулей), но НЕ боотстрапом приложения: локальной БД нет, e2e-специи требуют коннект. Риск низкий — паттерн зеркалит уже работающий `MessageOutboxRelayWorker`/`TranscribeWorker`.
- voice-триггер добавлен только в `sendMessage` (основной путь голосового от пользователя); `insertHistorical` voice не пере-транскрибируется (исторический импорт обычно уже несёт транскрипт) — осознанно.
