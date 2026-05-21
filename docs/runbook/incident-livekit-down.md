# Runbook: LiveKit Server недоступен

## Симптомы

- Алерт **LiveKitDown** в PagerDuty / Slack.
- `/health/ready` backend'а отдаёт `{ "livekit": "fail" }`.
- Активные встречи: участники видят разрыв, не могут переподключиться.
- Новые встречи: гости и хосты получают «Не удалось подключиться к комнате».

## Диагностика

1. Status сервиса:

   ```bash
   ssh vm-livekit
   cd /home/docker/z/infra/livekit
   docker compose ps
   docker compose logs --tail 200 livekit
   ```

2. Сетевая доступность:

   ```bash
   curl -v https://media.crossmark.ru/healthz
   nc -zv media.crossmark.ru 443
   nc -zv media.crossmark.ru 7881   # TURN/UDP fallback
   ```

3. Проверить TURN-сервер (отдельная VM):

   ```bash
   ssh vm-turn
   systemctl status coturn
   ```

4. Проверить, не проблема ли в Egress (он делит инфру):

   ```bash
   docker compose logs --tail 100 egress
   ```

5. Если backend возвращает 500 на `/api/v1/meetings/:id/join`, а в логах LiveKit есть
   `invalid API key`, проверить совпадение ключей:

   ```bash
   grep -A3 '^keys:' livekit.yaml
   grep '^LIVEKIT_API_' /home/docker/z/.env
   ```

   `LIVEKIT_API_KEY` должен быть ключом из `keys:`, а `LIVEKIT_API_SECRET` - его
   значением.

## Recovery

### Шаг 1: рестарт LiveKit

```bash
ssh vm-livekit
cd /home/docker/z/infra/livekit
docker compose restart livekit
sleep 5
docker compose logs --tail 50 livekit  # "starting LiveKit server"
```

### Шаг 2: проверить, что новые встречи поднимаются

```bash
curl -X POST https://z.crossmark.ru/health/ready
# В ответе должен быть `{"livekit":"ok"}`
```

### Шаг 3: оповестить активных хостов (если простой >5 минут)

Список активных встреч:

```bash
psql z_main -c \
  "SELECT id, title, started_at FROM \"Meeting\"
     WHERE status='active' AND started_at > now() - interval '2 hours';"
```

→ Через email-выгрузку (Crossmark) уведомить хостов о перезапуске.

### Шаг 4 (если рестарт не помог): подъём из бэкапа конфига

```bash
ssh vm-livekit
cd /home/docker/z/infra/livekit
docker compose down
docker compose pull
docker compose up -d
```

Реальные `infra/livekit/livekit.yaml` и `infra/livekit/egress.yaml` не хранятся в git.
Если файл повреждён, скопировать `.example`, заполнить реальные секреты из менеджера
секретов/серверного бэкапа и перезапустить media-compose. Не оставлять `CHANGE_ME`:
LiveKit отклонит backend-запросы или упадёт на коротком секрете.

## Escalation

- Простой > 15 минут → @lead-engineer + @cto.
- Если LiveKit стабильно падает на одной нагрузке — открыть issue в их Github и зафиксировать в `second-brain/02_architecture/code-pitfalls.md`.

## Митигации (planned)

- V1.1: standby LiveKit на отдельной VM с failover через nginx upstream.
- Сейчас: single-node, RTO ~5 минут.
