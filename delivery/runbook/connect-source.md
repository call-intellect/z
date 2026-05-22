# Runbook: подключение источника

## Поддерживаемые источники

См. [03-modules-catalog.md](../03-modules-catalog.md), M-40 + M-01.

## Общие шаги

1. Открыть `/admin/sources`.
2. Нажать «Подключить источник» → выбрать тип.
3. Заполнить параметры (URL, credentials).
4. Тест подключения.
5. Сохранение → запуск historical backfill (если применимо).

## Конкретные источники

### Telegram (chat)

1. Создать бота через @BotFather в Telegram.
2. Получить `BOT_TOKEN`.
3. В админке: тип `chat / telegram`, токен.
4. Добавить бота во все нужные группы.
5. Включить privacy mode у бота: `/setprivacy → Disable` (чтобы бот видел все сообщения, а не только команды).
6. Backfill: историю Telegram через @SomeRandomMessage не получим (Telegram API не отдаёт). Только новые сообщения с момента подключения.

### Slack (chat)

1. Создать Slack app в workspace.
2. Запросить scopes: `channels:history`, `groups:history`, `users:read`.
3. Установить app, получить `Bot Token`.
4. В админке: тип `chat / slack`, токен.
5. Добавить bot в нужные channels.
6. Backfill: 90 дней истории через `conversations.history` API.

### Email (IMAP)

1. Получить access к корпоративной почте (приоритет — отдельный read-only ящик).
2. В админке: тип `email`, IMAP host, login, password.
3. Backfill: настраивается период (7 дней / 90 дней / весь архив).
4. **PII-флаг автоматически** — content класс минимум `internal`.

### Bitrix24 (CRM)

1. В Bitrix24: «Разработчикам» → «Локальное приложение».
2. Создать приложение с правами: `crm` (read), `disk` (read), `tasks` (read).
3. Получить `client_id`, `client_secret`, OAuth code.
4. В админке: тип `crm / bitrix24`, заполнить.
5. Webhook: настроить outgoing webhook на `/api/v1/ingest/webhooks/bitrix24/${connection_id}` для realtime.
6. Backfill: deals, leads, contacts за выбранный период.

### amoCRM

Аналогично — OAuth flow.

### 1С (Бухгалтерия 8.3 / УТ 11)

1. Получить доступ к OData-сервисам 1С (включается на стороне 1С).
2. URL вида `https://1c.example.ru/odata/standard.odata/`.
3. Учётка с правами на чтение нужных справочников.
4. В админке: тип `erp / 1c`, URL, login, password.
5. Backfill: snapshot ежедневно (раз в сутки в 02:00 локального времени).
6. **Важно:** не делаем live-query через OData (медленно). Snapshot + кэш.

### МойСклад

1. Получить API-токен в МойСклад (settings → user-token).
2. В админке: тип `erp / moysklad`.
3. Snapshot ежедневно.

### Yougile / Kaiten (task tracker)

1. Получить API-токен.
2. В админке: тип `task_tracker / yougile`.
3. **Read-only.** Никогда не пишем в task-tracker (исключение — настраиваемая односторонняя sync M-37, по умолчанию выключена).

### Generic SQL

Для подключения произвольной БД (Postgres, MySQL, MSSQL, ClickHouse):

1. Получить read-only учётку в БД.
2. В админке: тип `database`, dialect, connection string.
3. Настроить расписание запросов (cron + SQL).
4. Каждый запрос — отдельная «логическая таблица» в M-40.

### CSV / Excel

1. Через UI `/admin/sources/upload` — загрузить файл.
2. AI-разборщик определит схему.
3. Можно задать расписание ре-загрузки или одноразово.

### Yandex.Metrica / Google Analytics

1. OAuth flow.
2. Выбор метрик (типа сессии, конверсия, источники трафика).
3. Pull раз в час.

## Безопасность подключения

- Все credentials сохраняются в OpenBao, не в БД.
- Доступ — минимальные права (read-only).
- Каждое подключение проходит security review.
- Audit-лог каждого онлайн-запроса (для ad-hoc query).
- Webhooks проверяют HMAC-подпись.

## Rate-limit

Каждое подключение имеет лимит:
- Snapshot ingest: до 100 000 записей в сутки.
- Real-time webhook: до 1000 событий / минута.
- Online query: до 100 запросов / минута.

При превышении — алерт + автоматическое снижение скорости.

## Что делать, если источник упал

1. Алерт от healthcheck → Telegram админу.
2. Источник переходит в `is_active = false`.
3. Уже накопленные данные продолжают обрабатываться.
4. Новые события не теряются — webhook получает 5xx, источник делает retry.
5. После восстановления — gap-fill через сравнение `last_sync_at` и текущего времени.

## Disconnection источника

В админке: `is_active = false`. Данные остаются в памяти, новые не приходят.

Полное удаление подключения — через DELETE endpoint. Удаляются credentials в OpenBao, но не данные в Raw Memory.

Если нужно удалить данные источника — отдельный flow:

```bash
./scripts/purge-source-data.sh --source-id=${SOURCE_ID}
```

Это **необратимо** (удаляет все RawEvents, signals, etc., связанные с источником).
