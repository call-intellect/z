# Telegram Bot smoke-тест

Этот файл — инструкция для ручного smoke-теста Telegram-канала на dev/prod.
Реальный E2E прогон делается оператором после деплоя.

> **β-9 (2026-05-25, актуально):** Telegram-бот стал **глобальным** — один на
> всю платформу Кора, без `tenantId`. Главный администратор Z настраивает
> токен через админ-панель `/admin/system/telegram-bot` (или через CLI
> `bun run setup:telegram-bot --token ...` — резервный путь). Сотрудники
> разных компаний различаются через `ChannelBinding.externalId` (внутренний
> `user.id` Telegram). Контекст Org выводится из `Membership(userId)`.
> Подробности — `plans/tz/2026-05-25-telegram-bot-global-and-invites.md`.
>
> **Команда `/login`** — выдаёт magic-link в чат бота для одноразового входа
> в веб-кабинет (15 мин TTL). Работает только для уже привязанных юзеров.
>
> **β-1 zero-button (2026-05-23):** inline-кнопки, callback_query и
> slash-команды удалены. Разрешены только `/start <token>` (deep-link
> привязка) и `/login` (β-9). Бот принимает свободный текст, голос (через
> ASR) и документы (PDF/DOCX/MD/TXT через DocumentsService).

## Что проверяем
0. (β-9) Миграция per-tenant каналов в глобальный — `migrate-telegram-channels-to-global.ts`.
1. (β-9) Setup script ИЛИ админ-панель регистрирует webhook + очищает menu + создаёт/обновляет глобальный `Channel` (`tenantId IS NULL`).
2. `/start <token>` или голый код создаёт `ChannelBinding` на глобальном канале.
3. (β-9) Свободный текст от привязанного юзера — резолв `Membership` → определяется `orgId` → дальше как раньше.
4. (β-9) `/login` от привязанного юзера → magic-link в чат бота.
5. (β-9) GitHub-style приглашение через `/orgs/:orgId/invitations` → письмо с magic-link + Telegram deep-link.
6. Свободный текст вопросом → `chat_query` → ChatV2.
7. Свободный текст утверждением → `free_note` → `ConversationalIngestAdapter`.
8. Voice → ASR → intent classify → `free_note`|`chat_query`.
9. Document → DocumentsService.upload → document.adapter pipeline.

## Подготовка
1. Создать **один** глобальный бот через [@BotFather](https://t.me/BotFather)
   (например `@kora_bot`) → сохранить `BOT_TOKEN`. **Per-tenant ботов больше
   не заводим** (β-9).
2. Убедиться, что `PUBLIC_HOST_URL` в `.env` указывает на доступный
   снаружи URL backend (HTTPS обязателен).
3. Убедиться, что `CRYPTO_MASTER_KEY` задан в `.env` (32-байтовый base64).
4. ENV (β-9): `KORA_BOT_USERNAME=kora_bot` (без `@`), `INVITE_TTL_DAYS=14`,
   `INVITE_REMINDER_DAYS=7`, `MAGIC_LINK_TTL_MINUTES=15`,
   `MAGIC_LINK_RATE_LIMIT_PER_HOUR=5`, `INACTIVE_BINDING_DAYS=30`.
5. Frontend ENV: `NEXT_PUBLIC_KORA_BOT_USERNAME=kora_bot`.
6. Опционально проверить флаги: `BOT_VOICE_ENABLED`, `BOT_DOCUMENT_ENABLED`,
   `BOT_INTENT_CLASSIFIER_ENABLED` (все default = true).

## Setup (β-9 актуальное)

**Если на проде уже были per-tenant каналы — сначала миграция:**
```bash
cd backend
bun run scripts/migrate-telegram-channels-to-global.ts --dry-run
# изучить вывод, потом без --dry-run:
bun run scripts/migrate-telegram-channels-to-global.ts
```
Это даст одну глобальную запись `Channel` (`tenantId IS NULL`), все
существующие `ChannelBinding`-и переедут на неё; per-tenant Telegram-каналы
будут помечены `broken/migrated-to-global` (для аудита).

**Партиал unique index** (один глобальный канал на kind) — применяется
автоматически через:
```bash
bun run apply-postgres-init
```

**Регистрация токена + webhook (вариант А — через CLI):**
```bash
cd backend
bun run setup:telegram-bot -- \
    --token <BOT_TOKEN> \
    --public-host-url https://<your-host>
```
Ожидаемый вывод:
```
[setup-telegram-bot] webhookUrl=https://.../api/v1/webhooks/telegram-bot
[setup-telegram-bot] getMe ok, username=@<bot_username>
[setup-telegram-bot] setWebhook ok
[setup-telegram-bot] setMyCommands ok          # пустой массив
[setup-telegram-bot] Channel upserted id=... tenantId=NULL (global)
[setup-telegram-bot] DONE.
```

**Вариант Б — через админ-панель Z (для случая «нет доступа к серверу»):**
1. Зайти в Z super-admin → `/admin/system/telegram-bot`.
2. Вставить токен → «Сохранить токен». Бэкенд зашифрует через `CryptoService`.
3. Жмём «Перенастроить webhook» — бэкенд вызовет Telegram API `setWebhook`.
4. Шапка должна показать «Бот активен, webhook доходит» (зелёный статус).

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
   запись с `verifiedAt=NOT NULL`. `channel_id` — id ГЛОБАЛЬНОГО канала
   (один на всю платформу).

### 1а. Linking — голый код в первом сообщении
1. Получить новый `code` тем же эндпоинтом.
2. Открыть чат с ботом, отправить просто `<code>` (без `/start`).
3. Ожидание: тот же результат — binding создан, ответ «Готово!».

### 1б. (β-9) Linking из письма приглашения — GitHub-style
1. Директор в кабинете компании → «Сотрудники» → «Пригласить»: указывает
   имя + опц. email + роль. Жмёт «Отправить приглашение».
2. Если email есть → сотруднику приходит письмо с двумя кнопками:
   «Открыть кабинет» (magic-link `https://<host>/invite/<magicToken>`) и
   «Открыть @kora_bot» (deep-link `https://t.me/kora_bot?start=<linkCode>`).
3. Если email пуст → директор копирует ссылку из модала и пересылает сам.
4. Сотрудник кликает «Открыть @kora_bot» → бот получает `/start <linkCode>`
   → создаётся `ChannelBinding`, ответ «Здравствуйте, [Имя]! Вы привязаны».

### 2. (β-9) `/login` — magic-link из бота
1. Привязанный сотрудник пишет боту `/login` (или `/login@kora_bot` в
   group-chat).
2. Ожидание: бот отвечает «Перейдите по ссылке для входа в кабинет:
   `https://<host>/accounts/magic-link/consume?token=...`. Ссылка действует
   15 минут.».
3. Клик по ссылке → попадает в кабинет авторизованным.
4. Метрика `bot_login_command_total{outcome='ok'}` ↑.

### 3. Свободный текст-вопрос → chat_query
1. Отправить боту: `Какой бюджет на Q4?`.
2. Ожидание: ChatV2Service обрабатывает, ответ возвращается через
   `sendChatReply` в этот же чат.
3. (β-9) Org-контекст резолвится из `Membership(userId)`.

### 4. Свободный текст-утверждение → free_note
1. Отправить: `Встреча с Иваном перенесена на пятницу`.
2. В БД: `RawEvent(source.type='conversational')` с
   `payload.kind='free_note'`, привязан к Org через `Membership`.

### 5. Voice → ASR → intent
1. Записать голосовое: «Какой план продаж на следующий квартал?».
2. Ожидание: транскрипт пройдёт через `QueryClassifierService`,
   итог — `chat_query` → ChatV2.
3. Метрика `bot_voice_asr_duration_seconds{channel='telegram_bot'}` ↑.

### 6. Document → upload
1. Отправить PDF/DOCX/MD/TXT (≤20 МБ) в чат.
2. Ожидание: бот отвечает «Документ принят…».
3. В БД: `SELECT * FROM documents ORDER BY created_at DESC LIMIT 1;` —
   статус начинается с `uploaded`, через несколько секунд → `parsed`.

### 6а. Document > 20 МБ — отказ
1. Отправить файл >20 МБ.
2. Ожидание: «Файл слишком большой (>20 МБ)…», `DocumentsService.upload`
   НЕ вызывается.

### 7. Voice spam (anti-abuse)
1. Отправить 11 голосовых подряд за минуту.
2. Ожидание: первые 10 обработаны, 11-е — «Слишком много голосовых
   сообщений за час. Попробуйте чуть позже».

### 8. (β-9) Незнакомый отправитель
1. Кто-то, у кого нет `ChannelBinding`, пишет боту.
2. Ожидание: бот отвечает «Вы не привязаны к компании, попросите ссылку у
   руководителя».
3. Метрика `telegram_bot_unknown_sender_total` ↑.

### 9. (β-9) Глобальный kill-switch
1. Super-admin в `/admin/system/telegram-bot` → выключает тумблер.
2. Backend: `Channel.status = 'global_disabled'`.
3. Любое входящее сообщение → бот молчит (или короткое «Сервис временно
   недоступен, попробуйте позже»).
4. Включаем обратно → бот снова работает.

## Что проверять в метриках
- `bot_inbound_total{channel='telegram_bot', kind='text'|'voice'|'document'|'start_command'|'link_code'}` ↑
- `bot_voice_asr_duration_seconds{channel='telegram_bot'}` — histogram, p95 ~ 5-15с.
- `bot_intent_classified_total{channel='telegram_bot', intent='chat_query'|'free_note', source='llm'|'heuristic'}` ↑
- (β-9) `telegram_bot_global_webhook_received_total{type}` ↑
- (β-9) `telegram_bot_unknown_sender_total{reason}` — растёт только когда пишет незнакомец.
- (β-9) `bot_login_command_total{outcome}` ↑ при использовании `/login`.
- (β-9) `invite_created_total{has_email}` / `invite_accepted_total{path}` —
  при работе с приглашениями из кабинета компании.
- `conversational_deliveries_total{kind='telegram_bot', status='delivered'}` ↑
- `telegram_bot_api_errors_total{...}` — должен оставаться 0 при штатной работе.

## Откат (β-9)

**Полный откат глобального бота к per-tenant модели:**
```bash
cd backend
bun run scripts/migrate-telegram-channels-back.ts --dry-run
bun run scripts/migrate-telegram-channels-back.ts
# После этого вернуть код на ветку до β-9 (git revert d011831 913dd1e).
```

**Точечно — снять токен/выключить бота без отката кода:**
1. Super-admin → `/admin/system/telegram-bot` → выключить.
2. Или вручную: `UPDATE channels SET status='global_disabled' WHERE tenantId IS NULL AND kind='telegram_bot';`

**Удалить webhook у Telegram (если меняется хост):**
```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/deleteWebhook"
```
