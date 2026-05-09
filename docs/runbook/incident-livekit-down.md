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
   docker ps | grep livekit
   docker logs --tail 200 livekit
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
   docker logs --tail 100 egress
   ```

## Recovery

### Шаг 1: рестарт LiveKit

```bash
ssh vm-livekit
docker restart livekit
sleep 5
docker logs --tail 50 livekit  # «started serving on...»
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
cd /opt/livekit
docker-compose down
docker-compose pull
docker-compose up -d
```

Конфиг — `infra/livekit/livekit.yaml`. Если он повреждён, восстановить из git.

## Escalation

- Простой > 15 минут → @lead-engineer + @cto.
- Если LiveKit стабильно падает на одной нагрузке — открыть issue в их Github и зафиксировать в `second-brain/02_architecture/code-pitfalls.md`.

## Митигации (planned)

- V1.1: standby LiveKit на отдельной VM с failover через nginx upstream.
- Сейчас: single-node, RTO ~5 минут.
