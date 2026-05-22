# SBA β-1 — Telegram Bot smoke-тест (ручной)

Этот файл — инструкция для ручного smoke-теста Telegram Bot канала на dev/prod.
Реальный E2E прогон делается оператором после деплоя (β-1 sub-ТЗ §11.13).

## Что проверяем
1. Setup script регистрирует webhook + commands + создаёт `Channel`.
2. `/link <код>` создаёт `ChannelBinding`.
3. Inbound `/ask`/`/note`/`/idea`/`/status` маршрутизируется по типам.
4. Outbound notification (`probe.question` с `options`) приходит в чат
   с inline-кнопками.
5. Нажатие inline-кнопки создаёт `Notification.responseStatus='answered'`.

## Подготовка
1. Создать тест-бота через [@BotFather](https://t.me/BotFather) → команда
   `/newbot`. Сохранить полученный `BOT_TOKEN`.
2. Выяснить tenantId тестовой Org (Z админка → orgs).
3. Убедиться, что `PUBLIC_HOST_URL` в `.env` указывает на доступный
   снаружи URL backend'а (HTTPS обязателен — Telegram требует TLS).
4. Убедиться, что `CRYPTO_MASTER_KEY` задан в `.env` (32-байтовый base64).

## Setup
```bash
cd backend
bun run setup:telegram-bot -- \
    --token <BOT_TOKEN> \
    --tenant-id <tenantId> \
    --public-host-url https://<your-host>
```
Ожидаемый вывод:
```
[setup-telegram-bot] tenantId=<tenantId>
[setup-telegram-bot] webhookUrl=https://.../api/v1/webhooks/telegram-bot/<tenantId>
[setup-telegram-bot] getMe ok, username=@<bot_username>
[setup-telegram-bot] setWebhook ok
[setup-telegram-bot] setMyCommands ok
[setup-telegram-bot] Channel upserted id=... tenantId=<tenantId>
[setup-telegram-bot] DONE.
```

## Шаги smoke

### 1. Linking
1. Зайти в ЛК Коры: `POST /api/v1/me/channels/telegram_bot/link-code`
   (или через UI «Каналы → Telegram → Получить код»). Сохранить `code`.
2. Открыть чат с ботом в Telegram. Отправить `/link <code>`.
3. Ожидание: бот отвечает «Готово! Аккаунт привязан...».
4. В БД: `SELECT * FROM channel_bindings WHERE channel_id=<channelId>;`
   — должна появиться запись с `verifiedAt=NOT NULL`.

### 2. /ask (chat_query)
1. Отправить боту: `/ask какой бюджет на Q4?`.
2. Ожидание: ChatV2Service (α-5) обрабатывает вопрос, ответ приходит в
   тот же чат (через `sendChatReply` с originChannelBindingId).

### 3. /note (free_note)
1. Отправить: `/note встреча с Иваном перенесена на пятницу`.
2. В БД: появится `RawEvent(source.type='conversational')`.

### 4. /idea
1. Отправить: `/idea новая фича — авто-перевод транскрипций`.
2. В БД: `RawEvent` с `payload.metadata.tag='idea'`.

### 5. /status, /help
1. Отправить `/status`. Бот отвечает количеством pending probe / unread.
2. Отправить `/help`. Бот отвечает списком команд.

### 6. Inline-кнопки (probe.question)
1. Через API: `POST /api/v1/some-internal` или прямой вызов
   `ConversationalService.sendNotification` с
   `{eventType:'probe.question', payload:{question:'Тест?', options:['Да','Нет']}}`.
2. Ожидание: сообщение приходит в Telegram с двумя кнопками «Да» / «Нет».
3. Нажать «Да». Notification переходит в `responseStatus='answered'`,
   `responsePayload={kind:'option', optionIndex:0, optionText:'Да'}`.

## Что проверять в метриках
- `conversational_deliveries_total{kind='telegram_bot', status='delivered'}` ↑
- `telegram_bot_webhook_received_total{type='message'|'callback_query'|'command'}` ↑
- `conversational_inbound_total{kind='in_app', type='chat_query'}` ↑ (после `/ask`)
- `telegram_bot_api_errors_total{...}` — должен оставаться 0 при штатной работе.

## Откат
```bash
# Удалить webhook у Telegram (вручную):
curl -X POST "https://api.telegram.org/bot<TOKEN>/deleteWebhook"

# Удалить Channel:
DELETE FROM channels WHERE tenant_id='<tenantId>' AND kind='telegram_bot';
```
