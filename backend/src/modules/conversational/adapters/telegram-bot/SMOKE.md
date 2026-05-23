# SBA β-1 — Telegram Bot smoke-тест (zero-button, 2026-05-23)

Этот файл — инструкция для ручного smoke-теста Telegram Bot канала на dev/prod.
Реальный E2E прогон делается оператором после деплоя (см. zero-button rip-out ТЗ §11).

> β-1 zero-button (2026-05-23): inline-кнопки, callback_query и slash-команды
> удалены. Бот принимает свободный текст, голос (через ASR) и документы
> (PDF/DOCX/MD/TXT через DocumentsService). Единственная команда `/start <token>` —
> deep-link привязка; голый код привязки тоже работает.

## Что проверяем
1. Setup script регистрирует webhook + очищает menu (`setMyCommands([])`) + создаёт `Channel`.
2. `/start <token>` или голый 12-hex код создаёт `ChannelBinding`.
3. Свободный текст вопросом → `chat_query` → ChatV2 (α-5).
4. Свободный текст утверждением → `free_note` → `ConversationalIngestAdapter`.
5. Voice → ASR через Vox → intent classify → `free_note`|`chat_query`.
6. Document → DocumentsService.upload → document.adapter pipeline.

## Подготовка
1. Создать тест-бота через [@BotFather](https://t.me/BotFather) → команда
   `/newbot`. Сохранить полученный `BOT_TOKEN`.
2. Выяснить tenantId тестовой Org (Z админка → orgs).
3. Убедиться, что `PUBLIC_HOST_URL` в `.env` указывает на доступный
   снаружи URL backend'а (HTTPS обязателен — Telegram требует TLS).
4. Убедиться, что `CRYPTO_MASTER_KEY` задан в `.env` (32-байтовый base64).
5. Опционально проверить флаги: `BOT_VOICE_ENABLED`, `BOT_DOCUMENT_ENABLED`,
   `BOT_INTENT_CLASSIFIER_ENABLED` (все default = true).

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
[setup-telegram-bot] setMyCommands ok          # вызывается с пустым массивом
[setup-telegram-bot] Channel upserted id=... tenantId=<tenantId>
[setup-telegram-bot] DONE.
```

В Telegram после этого menu-хамбургер у бота должен быть пустым (через
несколько минут — Telegram кеширует).

## Шаги smoke

### 1. Linking — `/start <token>` (deep-link)
1. Зайти в ЛК Коры: `POST /api/v1/me/channels/telegram_bot/link-code`
   → сохранить `code`.
2. Открыть `https://t.me/<bot_username>?start=<code>` (Telegram сам пришлёт
   `/start <code>` боту).
3. Ожидание: бот отвечает «Готово! Аккаунт привязан…».
4. В БД: `SELECT * FROM channel_bindings WHERE channel_id=<channelId>;` —
   запись с `verifiedAt=NOT NULL`.

### 1а. Linking — голый код в первом сообщении
1. Получить новый `code` тем же эндпоинтом.
2. Открыть чат с ботом, отправить просто `<code>` (без `/start`).
3. Ожидание: тот же результат — binding создан, ответ «Готово!».

### 2. Свободный текст-вопрос → chat_query
1. Отправить боту: `Какой бюджет на Q4?`.
2. Ожидание: ChatV2Service (α-5) обрабатывает, ответ возвращается через
   `sendChatReply` в этот же чат.

### 3. Свободный текст-утверждение → free_note
1. Отправить: `Встреча с Иваном перенесена на пятницу`.
2. В БД: `RawEvent(source.type='conversational')` с
   `payload.kind='free_note'`.

### 4. Voice → ASR → intent
1. Записать голосовое: «Какой план продаж на следующий квартал?».
2. Ожидание: транскрипт пройдёт через `QueryClassifierService`,
   итог — `chat_query` → ChatV2.
3. Метрика `bot_voice_asr_duration_seconds{channel='telegram_bot'}` ↑.

### 5. Document → upload
1. Отправить PDF/DOCX/MD/TXT (≤20 МБ) в чат.
2. Ожидание: бот отвечает «Документ принят…».
3. В БД: `SELECT * FROM documents ORDER BY created_at DESC LIMIT 1;` —
   статус начинается с `uploaded`, через несколько секунд → `parsed`.
4. Дальше — стандартный document.adapter pipeline (RawEvent →
   IdeaBlock).

### 5а. Document > 20 МБ — отказ
1. Отправить файл >20 МБ.
2. Ожидание: «Файл слишком большой (>20 МБ)…», `DocumentsService.upload`
   НЕ вызывается.

### 6. Voice spam (anti-abuse)
1. Отправить 11 голосовых подряд за минуту.
2. Ожидание: первые 10 обработаны, 11-е — «Слишком много голосовых
   сообщений за час. Попробуйте чуть позже».

## Что проверять в метриках
- `bot_inbound_total{channel='telegram_bot', kind='text'|'voice'|'document'|'start_command'|'link_code'}` ↑
- `bot_voice_asr_duration_seconds{channel='telegram_bot'}` — histogram, p95 ~ 5-15с.
- `bot_intent_classified_total{channel='telegram_bot', intent='chat_query'|'free_note', source='llm'|'heuristic'}` ↑
- `conversational_deliveries_total{kind='telegram_bot', status='delivered'}` ↑
- `telegram_bot_api_errors_total{...}` — должен оставаться 0 при штатной работе.

## Откат
```bash
# Удалить webhook у Telegram (вручную):
curl -X POST "https://api.telegram.org/bot<TOKEN>/deleteWebhook"

# Удалить Channel:
DELETE FROM channels WHERE tenant_id='<tenantId>' AND kind='telegram_bot';
```
