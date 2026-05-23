---
type: tz
status: deprecated
deprecated_at: 2026-05-23
deprecated_by: plans/tz/2026-05-23-sba-beta-1-telegram-max-zero-button-ripout.md
deprecated_reason: |
  Этот ТЗ описывал β-1 с inline-кнопками, callback_query, slash-командами
  (/ask, /note, /idea, /status, /myideas, /help, /link) и CommandHandlerService.
  Решение от 2026-05-23 — отказаться от кнопок и slash-команд полностью.
  Бот теперь zero-button: свободный текст + voice (ASR) + документы. См.
  актуальный ТЗ rip-out'а.
feature: SBA β-1 — Channels Telegram + MAX Adapters (главные probe-каналы β)
date: 2026-05-21
parent_tz: tz/2026-05-21-second-brain-agents-umbrella.md
phase: beta
depends_on:
  - tz/2026-05-21-sba-alpha-1-channels-foundation.md (IChannel + ConversationalModule)
  - tz/2026-05-21-sba-alpha-5-layer5-chat-v2.md (chat-v2 как inbound-handler)
unblocks:
  - tz/2026-05-21-sba-beta-5-specialist-3-6-ideas-and-layer6-probe.md (Probe-Agent шлёт через Telegram)
covers_matrix_rows: [E9, E7 (использование linking flow)]
---

> **DEPRECATED 2026-05-23.** См. `plans/tz/2026-05-23-sba-beta-1-telegram-max-zero-button-ripout.md` —
> бот переведён на zero-button. Этот ТЗ оставлен в архиве для истории решений.

# ТЗ β-1: Channels — Telegram + MAX Adapters

> **Это sub-TZ.** Зонтичный — [`plans/tz/2026-05-21-second-brain-agents-umbrella.md`](2026-05-21-second-brain-agents-umbrella.md). При расхождениях — приоритет у зонтичного.
>
> **Контекст для исполнителя:**
> - Использовать `context7` MCP для актуальной Telegram Bot API + MAX API документации перед реализацией.
> - Inbound webhook-приём — переиспользовать паттерн из существующего [backend/src/modules/ingest/adapters/telegram](../../backend/src/modules/ingest/adapters/telegram) (если есть).
> - Bot-токены — через `TypedConfigService`, в `env.schema.ts`.

---

## 1. Цель

После β-1:
- `TelegramBotChannelAdapter` — outbound + inbound + inline-кнопки + slash-commands.
- `MaxBotChannelAdapter` — то же для MAX (mssgr.ru).
- Linking flow (`/link <code>`) работает для обоих ботов.
- Probe Слоя 6 + AI-чат Слоя 5 + статусы идей 3.6 — все доступны через Telegram и MAX автоматически (без правки этих слоёв).

---

## 2. Зависимости

**Зависит от:** α-1 (IChannel + ConversationalModule + linking infra), α-5 (chat-v2 inbound handler).

**Разблокирует:** β-5 (Probe-Agent эффективно работает только через Telegram).

---

## 3. Scope

### Входит

- 2 адаптера `IChannel`:
  - `TelegramBotChannelAdapter` в `backend/src/modules/conversational/adapters/telegram-bot/`.
  - `MaxBotChannelAdapter` в `backend/src/modules/conversational/adapters/max-bot/`.
- Webhook-эндпоинты для inbound:
  - `POST /api/v1/webhooks/telegram-bot/:tenantId`
  - `POST /api/v1/webhooks/max-bot/:tenantId`
- HMAC-валидация webhook'ов (паттерн как в LiveKit webhooks).
- Inline-кнопки + slash-commands:
  - `/ask <вопрос>` → chat_query
  - `/note <текст>` → free_note
  - `/idea <текст>` → free_note с автоматическим тэгом idea
  - `/status` → ответ ботом: «у тебя N pending probe + M идей со статусом»
  - `/myideas` → список идей пользователя с текущим статусом (через β-5 API)
  - `/link <code>` → linking
- Bot setup scripts:
  - `backend/scripts/setup-telegram-bot.ts` — set webhook, set commands.
  - `backend/scripts/setup-max-bot.ts` — то же для MAX.
- Расширение `ChannelKind` enum значениями `telegram_bot`, `max_bot` (на самом деле уже в α-1 enum, проверить — если нет, добавить здесь).
- UI: `/me/channels` (из α-1) — пополнение списка доступных типов для привязки.
- Метрики `conversational_*{kind='telegram_bot'|'max_bot'}`.

### Не входит

- AI-генерация ответа на free_note (это chat-v2 если `/ask`, или просто ingest если `/note`).
- WhatsApp, Slack, Mattermost, VK Messenger (γ+).
- Голосовухи через ASR (γ+, отдельный sub-TZ).

---

## 4. Конфигурация

```
# Telegram
TELEGRAM_BOT_TOKEN=<token>  # ENV per tenant НЕ скейлится → храним в Channel.config (encrypted)
TELEGRAM_WEBHOOK_SECRET=<random>  # для HMAC

# MAX
MAX_BOT_TOKEN=<token>
MAX_WEBHOOK_SECRET=<random>
MAX_API_BASE_URL=https://api.max.ru  # проверить через context7
```

Per-tenant токены — в `Channel.config` через `CryptoService` (паттерн уже работает).

---

## 5. IChannel implementation — Telegram

```ts
@Injectable()
export class TelegramBotChannelAdapter implements IChannel {
  readonly kind = 'telegram_bot';
  readonly maxDataClass: DataClass = 'confidential';  // не выше — внешний канал

  async send(delivery, notification, binding) {
    // 1. Decrypt bot token из Channel.config
    // 2. Сформировать message text + InlineKeyboardMarkup (если есть payload.options)
    // 3. sendMessage через Telegram Bot API
    // 4. Сохранить external_message_id
  }

  async ingest(rawUpdate) {
    // rawUpdate = Telegram Update object
    // 1. Найти ChannelBinding по from.id (telegram user_id) + tenantId
    // 2. Если не нашёлся И text='/link <code>' — обработать linking
    // 3. Если text начинается с '/ask' / '/note' / '/idea' → известный type
    // 4. Если callback_query (тап по inline-кнопке) → type='response' с notificationId из callback_data
    // 5. Если просто текст в thread, где недавно был probe → type='response' с notificationId из threadContext
    // 6. Default → type='free_note'
  }

  async parseResponse(rawUpdate, openProbes) {
    // Для callback_query — match по callback_data
    // Для reply на сообщение probe — match по reply_to_message.message_id → external_message_id
  }
}
```

MAX — аналогично, с поправкой на специфику MAX API.

---

## 6. Routing inbound — три типа сообщений

| Маркер | Тип | Действие |
|---|---|---|
| `/ask <вопрос>` | chat_query | → ChatV2Service.ask() → ответ обратно в этот же thread |
| `/note <текст>` | free_note | → IngestService через conversational.adapter (создан в α-1) |
| `/idea <текст>` | free_note (с тэгом idea) | → IngestService с metadata.tag='idea' |
| `/status`, `/myideas`, `/link` | command | → специальный handler в адаптере |
| callback_query (inline button) | response | → `ConversationalService.respondToProbe(notificationId, payload)` |
| reply в thread с открытым probe | response | → то же |
| просто текст | free_note | по умолчанию |

---

## 7. Bot setup

`bun run scripts/setup-telegram-bot.ts` — параметры через CLI:
```bash
bun run scripts/setup-telegram-bot.ts \
  --token <token> \
  --webhook-url https://api.kora.ai/api/v1/webhooks/telegram-bot/<tenantId> \
  --tenant-id <tenantId>
```
Что делает:
- `setWebhook` с указанным URL + secret.
- `setMyCommands` с командами `/ask`, `/note`, `/idea`, `/status`, `/myideas`, `/link`.
- Создаёт/обновляет `Channel(kind='telegram_bot', tenantId, config={encrypted token+secret})`.

`setup-max-bot.ts` — аналогично.

---

## 8. RBAC

- Webhook-эндпоинты — без auth, защищены HMAC + per-tenant URL.
- `Channel` — управление через owner/admin (создание/удаление каналов через `/admin/channels` — отдельный sub-TZ, либо CLI scripts).

---

## 9. Метрики

Используются базовые из α-1 (`conversational_*`), label `kind='telegram_bot'|'max_bot'`. Дополнительно:
- `telegram_bot_api_errors_total{api_method, code}` (counter)
- `max_bot_api_errors_total{api_method, code}` (counter)
- `telegram_bot_webhook_received_total{type}` (counter)
- `max_bot_webhook_received_total{type}` (counter)

---

## 10. LLM

Сам по себе адаптер LLM не использует. Только проксирует:
- `/ask` → ChatV2Service (он использует chat-v2-synthesize LLM)
- inbound `/note`/`/idea` → ingest → block-ingest (использует block-ingest LLM)

---

## 11. Фазы реализации

- [ ] **β-1.0** Проверить актуальную Telegram Bot API и MAX API через `context7`. Зафиксировать версии в second-brain.
- [ ] **β-1.1** Расширение `ChannelKind` enum (если в α-1 не было) + `bun run prisma:push`.
- [ ] **β-1.2** `TelegramBotChannelAdapter` — send (outbound с inline keyboards).
- [ ] **β-1.3** `TelegramBotChannelAdapter` — ingest (полный handler trigger'ов из §6).
- [ ] **β-1.4** `TelegramBotChannelAdapter` — parseResponse + thread tracking.
- [ ] **β-1.5** Webhook-эндпоинт `POST /webhooks/telegram-bot/:tenantId` + HMAC валидация.
- [ ] **β-1.6** Bot setup script `setup-telegram-bot.ts`.
- [ ] **β-1.7** `MaxBotChannelAdapter` — параллельная реализация по тому же шаблону.
- [ ] **β-1.8** Webhook MAX + setup script.
- [ ] **β-1.9** Slash-command handlers: `/status`, `/myideas` (через β-5 API), `/link` (через α-1 linking).
- [ ] **β-1.10** Метрики, error handling, retry logic.
- [ ] **β-1.11** Глоссарий UI: «бот», «привязать аккаунт», «ответить через бот» — русские термины.
- [ ] **β-1.12** Интеграционные тесты на mock-Telegram updates.
- [ ] **β-1.13** Smoke на реальном Telegram-аккаунте (dev) → отправить probe → нажать кнопку → проверить response.
- [ ] **β-1.14** Smoke MAX — аналогично.
- [ ] **β-1.15** second-brain: новый файл `01_projects/conversational-channels.md` (или расширение из α-1).

---

## 12. Открытые вопросы

1. **MAX API** — есть ли публичная Bot API? (см. зонтичный §11.3) Если нет — переносим MAX в γ+ и используем email-bridge как временное решение.
2. **Per-tenant токены vs single bot** — в Telegram бот привязан к токену, токен — к боту. Для каждого Org нужен свой бот? Или мульти-tenancy через single bot с маршрутизацией по chat_id? Рекомендация — single bot per tenant (admin создаёт бота, добавляет в Z через `/admin/channels`). Это упрощает linking и privacy.
3. **Голосовухи в Telegram** → ASR → text → ingest. Это отдельный sub-TZ в γ+. Здесь — ignore voice messages с уведомлением «голос пока не поддерживается».
4. **Rate limits Telegram** (30 messages/sec global) — нужен throttling в `conversational.send` worker.

---

## 13. DoD

- 2 адаптера в коде, оба регистрируются в `ChannelRegistry`.
- Webhook-эндпоинты работают, HMAC валидация проходит.
- Setup-script для Telegram отрабатывает на dev-боте.
- Linking flow `/link <code>` работает end-to-end.
- Probe из Слоя 4 (α-4 stale-detection) приходит в Telegram, нажатие кнопки → response → `ConversationalService.respondToProbe` → notification.status='responded'.
- `/ask` в Telegram → chat-v2 → ответ возвращается в тот же thread с цитатами.
- `/note` в Telegram → новый RawEvent → block-ingest → блок в knowledge-core.
- Метрики `conversational_*{kind='telegram_bot'}` экспортируются.
- (если применимо) MAX — то же.
- second-brain.

---

## 14. Итог

**Реализовано целиком:** нет (draft).

**Что осталось:** вся реализация.

**Что меняет в продукте:** Кора живёт в Telegram/MAX, пользователь не должен открывать ЛК для основных взаимодействий.
