# SBA β-1 — MAX Bot smoke-тест (ручной)

Инструкция для ручного smoke-теста MAX Bot канала. MAX Bot API
(dev.max.ru/docs-api, context7 verified 2026-05-22).

## Подготовка
1. Создать бота в платформе MAX (Chatbots → Create). Получить
   `accessToken` (раздел Integration → Get Token).
2. Выяснить `tenantId` тестовой Org.
3. `PUBLIC_HOST_URL` должен указывать на HTTPS-доступный backend.
4. `CRYPTO_MASTER_KEY` задан в `.env`.

## Setup
```bash
cd backend
bun run setup:max-bot -- \
    --token <ACCESS_TOKEN> \
    --tenant-id <tenantId> \
    --public-host-url https://<your-host>
```
Ожидаемый вывод:
```
[setup-max-bot] tenantId=<tenantId>
[setup-max-bot] webhookUrl=https://.../api/v1/webhooks/max-bot/<tenantId>/<secret>
[setup-max-bot] /me ok, botName=...
[setup-max-bot] /subscriptions ok
[setup-max-bot] Channel upserted id=... tenantId=<tenantId>
[setup-max-bot] DONE.
```

## Шаги smoke

### 1. Linking
1. ЛК Коры: `POST /api/v1/me/channels/max_bot/link-code`. Получить `code`.
2. В MAX: открыть чат с ботом, отправить `/link <code>`.
3. Ожидание: бот отвечает «Готово! Аккаунт привязан...».

### 2. /ask, /note, /idea, /status, /help
Идентично Telegram (см. `telegram-bot/SMOKE.md`).

### 3. Inline-кнопки
1. Trigger `probe.question` с options.
2. Кнопки рендерятся через `attachments[type='inline_keyboard']`.
3. Callback от нажатия должен прийти в webhook
   `POST /api/v1/webhooks/max-bot/<tenantId>/<secret>` с
   `update_type='message_callback'`.

## ВАЖНО — формат update'ов MAX
Документация MAX (context7 источник) лаконична относительно полей
webhook-update'а. Парсер `MaxBotChannelAdapter.ingestUpdate` сейчас
ориентируется на:
- `update_type` ∈ {`message_created`, `message_callback`}
- `message.sender.user_id`, `message.recipient.chat_id`, `message.body.text`
- `callback.user.user_id`, `callback.payload`

**При первом smoke зайти в логи backend'а и проверить реальные поля
update'а.** Если структура отличается — обновить `MaxUpdate` /
`handleMessage` / `handleCallback` в `max-bot.adapter.ts`. Это
ожидаемый шаг, отмеченный в β-1 final-отчёте.

## Откат
```bash
# Удалить webhook у MAX:
curl -X DELETE "https://platform-api.max.ru/subscriptions?url=<URL>" \
    -H "Authorization: <ACCESS_TOKEN>"

# Удалить Channel:
DELETE FROM channels WHERE tenant_id='<tenantId>' AND kind='max_bot';
```
