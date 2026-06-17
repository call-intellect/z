# Runbook: LiveKit Server недоступен

## Симптомы

- Алерт **LiveKitDown** в PagerDuty / Slack.
- `/health/ready` backend'а отдаёт `{"ok":false,"checks":{...,"livekit":"fail:..."}}`.
- Активные встречи: участники видят разрыв, не могут переподключиться.
- Новые встречи: гости и хосты получают «Не удалось подключиться к комнате».

## Диагностика

Медиа-стек — отдельный docker-compose проект `z-media` (`infra/livekit/docker-compose.yml`):
сервисы `livekit`, `egress`, `redis`; `livekit`/`egress` идут в `network_mode: host`. Все
команды диагностики выполняй из каталога `infra/livekit`.

1. Status сервиса:

   ```bash
   docker compose -f infra/livekit/docker-compose.yml ps
   docker compose -f infra/livekit/docker-compose.yml logs --tail 200 livekit
   ```

2. Сетевая доступность (домен из `webhook`/nginx — `wss://media.example.com` → 127.0.0.1:7880):

   ```bash
   curl -v http://127.0.0.1:7880/    # LiveKit на host-сети, порт 7880
   nc -zv 127.0.0.1 7881             # RTC TCP fallback (rtc.tcp_port)
   ```

3. Проверить TURN: TURN встроен в LiveKit и по умолчанию **выключен** (`turn.enabled: false`
   в `livekit.yaml`) — медиа идёт по UDP-портам (`rtc.port_range_start..end` = 50000-60000)
   и `rtc.tcp_port` напрямую. Отдельной TURN-VM/coturn нет. Если включён TURN/TLS — проверить
   секцию `turn:` в `livekit.yaml` и логи livekit на `TURN tls cert required`.

4. Проверить, не проблема ли в Egress (тот же media-compose):

   ```bash
   docker compose -f infra/livekit/docker-compose.yml logs --tail 100 egress
   ```

5. Если backend возвращает 500 на `/api/v1/meetings/:id/join`, а в логах LiveKit есть
   `invalid API key`, проверить совпадение ключей. Ключ:секрет лежат в `keys:` в
   `infra/livekit/livekit.yaml` (на media-хосте), а `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` —
   в корневом `.env` backend-стека (на backend-хосте):

   ```bash
   grep -A3 '^keys:' infra/livekit/livekit.yaml   # на media-хосте
   grep '^LIVEKIT_API_' .env                       # на backend-хосте
   ```

   `LIVEKIT_API_KEY` должен быть ключом из `keys:`, а `LIVEKIT_API_SECRET` - его
   значением.

## Recovery

### Шаг 1: рестарт LiveKit

```bash
docker compose -f infra/livekit/docker-compose.yml restart livekit
sleep 5
docker compose -f infra/livekit/docker-compose.yml logs --tail 50 livekit  # "starting LiveKit server"
```

### Шаг 2: проверить, что новые встречи поднимаются

```bash
curl https://z.crossmark.ru/health/ready   # GET (health-эндпоинты только GET)
# В ответе `checks.livekit` должен быть `"ok"`, а `ok` — `true`
```

### Шаг 3: оповестить активных хостов (если простой >5 минут)

Список активных встреч (БД — в backend-стеке, запрос через backend-контейнер):

```bash
docker compose exec backend psql "$DATABASE_URL" -c \
  "SELECT id, title, started_at FROM \"Meeting\"
     WHERE status='active' AND started_at > now() - interval '2 hours';"
```

→ Через email-выгрузку (Crossmark) уведомить хостов о перезапуске.

### Шаг 4 (если рестарт не помог): подъём из бэкапа конфига

```bash
docker compose -f infra/livekit/docker-compose.yml down
docker compose -f infra/livekit/docker-compose.yml pull
docker compose -f infra/livekit/docker-compose.yml up -d
```

Реальные `infra/livekit/livekit.yaml` и `infra/livekit/egress.yaml` не хранятся в git
(в `.gitignore`). Если файл повреждён, скопировать из шаблона
(`cp infra/livekit/livekit.yaml.example infra/livekit/livekit.yaml`, аналогично
`egress.yaml.example`), заполнить реальные секреты из менеджера секретов/серверного
бэкапа, выставить `chmod 0640` и перезапустить media-compose. Не оставлять `CHANGE_ME`:
LiveKit отклонит backend-запросы или упадёт на коротком секрете.

## Escalation

- Простой > 15 минут → @lead-engineer + @cto.
- Если LiveKit стабильно падает на одной нагрузке — открыть issue в их Github и зафиксировать в `second-brain/02_architecture/code-pitfalls.md`.

## Митигации (planned)

- V1.1: standby LiveKit на отдельной VM с failover через nginx upstream.
- Сейчас: single-node, RTO ~5 минут.
