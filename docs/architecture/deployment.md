# Deployment guide

## Локальная разработка (docker-compose)

```bash
cd backend
docker-compose up -d   # postgres + redis + minio
cp .env.example .env   # подставить DATABASE_URL, REDIS_URL, S3_*

bun install
bun run prisma:push
bun run prisma:seed    # промпты + дефолтные шаблоны

# В первом терминале:
bun run dev            # NestJS на :3000

# Во втором терминале:
bun run worker:dev     # AI-воркеры (transcribe/merge/analyze/notify)

# В третьем терминале:
cd ../frontend
bun install
bun run dev            # Next.js на :3001
```

LiveKit для локальной разработки можно поднять отдельным docker-compose
(`infra/livekit/`) или подключиться к dev-инстансу `media-dev.crossmark.ru`.

## Production

### Топология (см. `second-brain/02_architecture/`)

| VM             | Сервисы                                                    |
|----------------|------------------------------------------------------------|
| vm-backend     | NestJS HTTP, NestJS Workers (BullMQ), nginx upstream       |
| vm-livekit     | LiveKit Server                                             |
| vm-egress      | LiveKit Egress                                             |
| vm-turn        | coturn (TURN/STUN fallback)                                |
| vm-postgres    | PostgreSQL 16                                              |
| vm-redis       | Redis 7                                                    |
| vm-system-b    | cron (бэкапы), мониторинг (Prometheus + Grafana + Alertmanager) |

### Деплой (Ansible — TBD, для MVP — вручную)

Каждая VM получает:
- Docker / Bun / Node 20 (там, где нужно).
- systemd-юнит для своего сервиса.
- nginx-конфиг для TLS-терминации (certbot autorenew).
- ENV-файл `/etc/z/<service>.env` (mode 0600).

### Backend деплой

```bash
ssh root@vm-backend
cd /opt/z/backend
git pull
bun install --frozen-lockfile
bun run build
bun run prisma:push
systemctl restart z-backend z-workers
```

### Frontend деплой

Next.js — статический build + Node runtime для RSC:

```bash
ssh root@vm-frontend
cd /opt/z/frontend
git pull
bun install --frozen-lockfile
bun run build
systemctl restart z-frontend
```

### LiveKit / Egress

Стандартные docker-compose из `infra/livekit/livekit.yaml` и `infra/livekit/egress.yaml`.
Обновляются вручную: `docker-compose pull && docker-compose up -d`.

## Бэкапы

Cron на vm-system-b: см. `infra/scripts/README.md` и
`docs/runbook/restore-from-backup.md`.

## Мониторинг

- Prometheus scrape конфиг: `infra/prometheus/prometheus.yml`.
- Grafana дашборды: `infra/grafana/dashboards/*.json`.
- Алерты: `infra/grafana/alerts/*.yml`.
- Alertmanager → Slack `#z-alerts` (TBD).

## Smoke-тест после деплоя

```bash
cd infra/smoke
BACKEND=https://z.crossmark.ru ./smoke-test.sh
```
