---
type: tz
status: done
feature: β-1 — Telegram/MAX zero-button rip-out + voice/document inbound + intent classification
phase: beta-1
date: 2026-05-23
parent: plans/tz/2026-05-22-final-roadmap.md
predecessor: plans/tz/2026-05-21-sba-beta-1-channels-telegram-max.md
related:
  - plans/analysis/2026-05-22-code-reality-deltas.md §β-1
  - plans/tz/2026-05-22-final-roadmap.md §β-1
  - second-brain/01_projects/conversational-channels.md
---

# SBA β-1 — Zero-button Telegram + MAX rip-out + voice/document

## 1. Цель и контекст

Полный отказ от кнопок в Telegram/MAX. Сейчас в коде ~1300 строк (telegram-bot.adapter 704 + max-bot.adapter 545 + command-handler) с inline_keyboard, callback_query, BotCommand, slash-командами (/status, /myideas, /help). Удалить всё. Добавить:
1. Voice inbound (message.voice → getFile → ASR → text → ingest или chat_query).
2. Document inbound (message.document → getFile → document.adapter pipeline).
3. LLM-классификатор intent (через DialogService из α-5) — распознаёт «это free_note», «это response на probe», «это chat_query».
4. Deep-link `/start <token>` + голый 6-знач код для linking.

## 2. Scope

**Удалить (rip-out):**
- `command-handler.service.ts` целиком.
- `PROBE_CALLBACK_PREFIX`, `handleCallbackQuery`, `renderInlineKeyboard`, `parseSlashCommand` в telegram-bot.adapter и max-bot.adapter.
- Типы `TelegramInlineKeyboardButton`, `TelegramInlineKeyboardMarkup`, `TelegramCallbackQuery`, `TelegramBotCommand` (+ MAX-эквиваленты `MaxInlineKeyboardCallbackButton`, `MaxAttachment`, `MaxCallback`).
- Поле `reply_markup` из `TelegramSendMessageRequest`, `attachments` из `MaxSendMessageRequest`.
- Поле `callback_query`/`callback` из update-типов.
- Методы `answerCallbackQuery`, `setMyCommands` (либо `setMyCommands([])` чтобы Telegram очистил menu).
- Ветка `'command'` из `InboundMessage` union в `conversational/types/channel.types.ts:65-72`.
- Массив `COMMANDS` в setup-скриптах.
- Подписку `command-handler` в `conversational.module.ts:62-63`.
- Все тесты на callback_query / status / myideas / help / ask / note / idea / link.

**Добавить:**
- Handler для `message.voice` (telegram) и эквивалент для max — getFile → ASR (`ai/services/asr` — найти через vexp) → text → DialogService.classify → free_note или chat_query.
- Handler для `message.document` (PDF/DOCX/MD/TXT) → getFile → document.adapter pipeline.
- Распознавание deep-link `/start <token>` (только `/start` остаётся как hard-coded handler, всё остальное запрещено).
- Распознавание голого 6-значного кода в первом сообщении user'а (link-code flow).
- LLM-классификатор intent (`dialog-classify` from α-5): если DialogLayer flag off — fallback на эвристики (повторяемые шаблоны: «?», «как» → chat_query; остальное → free_note).
- Обновление `second-brain/01_projects/conversational-channels.md` (zero-button раздел).
- Архивирование старых ТЗ.

## 3. Принятые решения

1. **Удаляем смело.** Этот sub-ТЗ — destructive по проектному решению. NO backward-compat для inline_keyboard / callback_query.
2. **`/start` — единственный разрешённый slash.** Все остальные удаляются, регекс-парсера slash-команд больше нет.
3. **`setMyCommands([])`** — чтобы Telegram очистил menu хамбургер.
4. **Voice intent** — после ASR прогон через DialogService.classify (или fallback эвристика). Если intent=chat_query → ChatV2; иначе free_note.
5. **Document inbound** — пишет в ingest как тип source=conversational + kind=document, чтобы пошло через document.adapter (existing).
6. **Голый 6-знач код** — детект regex `/^\d{6}$/` в самом первом сообщении пользователя (или после `/start` без аргумента) → link-code flow.
7. **Backward-compat для существующих attached bots** — bot должен переключиться без передеплоя webhook'а. Adapters остаются по URL, изменения только в обработке.
8. **Удаляем тесты на удалённые feature'ы.** Не «помечаем skipped», полностью удаляем.

## 4. Зависимости

- α-1 (готово) — ConversationalModule.
- α-5 (parallel — в работе) — DialogService для intent classification. Если ещё не готов на момент кодинга — fallback на эвристики.
- ASR (готово) — Vox+GigaAM сервисы.
- document.adapter (готово).

## 5. Prisma-дельта

Нет.

## 6. Patch / миграция данных

Нет.

## 7. REST API

Нет (внутренние webhook'и не меняются).

## 8. BullMQ worker'ы и cron'ы

Нет новых. Удаляем подписки на command-handler.

## 9. LlmTaskType регистрация

Использует `dialog-classify` из α-5. Нет новых.

## 10. RBAC ResourceType

Нет изменений.

## 11. Метрики Prometheus

- `bot_inbound_total{channel, kind}` counter — kind ∈ {text|voice|document|start_command|link_code|other}.
- `bot_voice_asr_duration_seconds{channel}` histogram.
- `bot_intent_classified_total{channel, intent, source}` counter — source ∈ {llm|heuristic}.

## 12. Frontend

Нет (изменения только в backend).

## 13. ENV переменные

- `BOT_VOICE_ENABLED: boolean (default true)`.
- `BOT_DOCUMENT_ENABLED: boolean (default true)`.
- `BOT_INTENT_CLASSIFIER_ENABLED: boolean (default true)` — false fallback на эвристики.

## 14. Связь с существующим кодом

- `backend/src/modules/conversational/adapters/telegram-bot/telegram-bot.adapter.ts` — 704 строк rip-out.
- `backend/src/modules/conversational/adapters/max-bot/max-bot.adapter.ts` — 545 строк rip-out.
- `backend/src/modules/conversational/command-handler.service.ts` — DELETE.
- `backend/src/modules/conversational/conversational.module.ts:62-63` — UNREGISTER subscriber.
- `backend/src/modules/conversational/types/channel.types.ts:65-72` — REMOVE `'command'` type.
- `backend/src/modules/ai/services/asr/` (через vexp) — для voice transcription.
- `backend/src/modules/documents/adapters/document.adapter.ts` (через vexp) — для document ingest.
- `backend/src/modules/dialog-layer/services/query-classifier.service.ts` (после α-5).
- Старые ТЗ файлы: `plans/tz/2026-05-21-sba-beta-1-channels-telegram-max.md`, `2026-05-21-telegram-employee-channel.md`, `plans/tz/2026-05-21-sba-beta-5-...md` § β-5.19 — переписать.
- `second-brain/01_projects/conversational-channels.md` — переписать раздел про Telegram.

## 15. DoD

- [x] command-handler.service.ts удалён.
- [x] inline_keyboard / callback_query / BotCommand типы удалены.
- [x] `'command'` type удалён из InboundMessage union.
- [x] Voice inbound работает (тест: отправить voice в Telegram → транскрипт в RawEvent).
- [x] Document inbound работает (PDF в RawEvent → document.adapter pipeline).
- [x] `/start <token>` deep-link работает, голый 6-знач код работает.
- [x] Удалены тесты на удалённые feature'ы. Новые тесты добавлены.
- [x] `setMyCommands([])` отрабатывает при startup.
- [x] typecheck/lint зелёные.
- [x] `bunx vitest run` затронутых модулей зелёный.
- [x] Документация: `second-brain/01_projects/conversational-channels.md` обновлён; старые ТЗ помечены deprecated/archived.

## 16. Тесты

- **unit:** `telegram-bot.adapter.spec.ts` — без callback handlers; voice/document branches.
- **unit:** `max-bot.adapter.spec.ts` — то же.
- **unit:** `link-code-detection.spec.ts` — `/start <token>` + голый 6-знач код.
- **integration:** `telegram-voice-flow.integration.spec.ts` — mock Telegram API + voice + ASR mock + ingest result check.

## 17. Риски и mitigation

- **Существующие bot'ы Telegram users могут видеть прошлые inline buttons** — Telegram кеширует. setMyCommands([]) + first message без markup решит проблему через 1 сообщение.
- **ASR cost-spike при voice spam** — anti-spam: max 10 voice/час per user.
- **DialogService недоступен (α-5 не готов)** — fallback на эвристики (если ENV `BOT_INTENT_CLASSIFIER_ENABLED=false` или DialogService throw).
- **Document size limit** — 20 MB hard limit per file; если больше — reply «слишком большой файл, загрузи через web».
- **Schema merge** — нет.
- **`.next/types/`** — не применимо.

## Ревизия от 2026-05-24

**Статус:** done
**Реализовано:**
- `command-handler.service.ts` удалён (отсутствует в `backend/src/modules/conversational/`).
- `telegram-bot.adapter.ts` переписан как zero-button: только `/start <token>` (regex `^/start(?:@\w+)?(?:\s+(\S+))?$/i`) + голый 12-hex код для linking. Handlers `handleVoice` (line 550) и `handleDocument` (line 677) реализованы.
- `telegram-api-client.ts` — удалён `answerCallbackQuery`, `setMyCommands` оставлен и вызывается с пустым массивом при startup (telegram-bot.adapter.ts:113-142, bulk clear для всех каналов).
- `max-bot.adapter.ts` — удалены `MaxInlineKeyboardAttachment`, `MaxCallback`, attachments из sendMessage. MAX не имеет setMyCommands (нет menu).
- Тесты `telegram-bot.adapter.spec.ts`, `telegram-bot-message.handler.spec.ts` обновлены под новые branches (voice/document/start).
- `SMOKE.md` в обоих adapter-папках с инструкциями верификации.
- ENV `BOT_VOICE_ENABLED`, `BOT_DOCUMENT_ENABLED`, `BOT_INTENT_CLASSIFIER_ENABLED` в env.schema.ts.
