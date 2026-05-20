# Deployment guide

## Локальная разработка

Рантайм — **Bun** (Node не требуется). Полная пошаговая инструкция (без контейнеров,
с локальными Postgres+pgvector / Redis) — в [`docs/dev/onboarding.md`](../dev/onboarding.md).

Кратко (три процесса):
```bash
# backend (HTTP + воркеры BullMQ in-process) + frontend — два процесса
cd backend && bun run dev          # :3000 (включает воркеры)
cd frontend && bun run dev         # :3001
```

LiveKit для локальной разработки — `docker compose --profile livekit up`
(`infra/livekit/`) или dev-инстанс `media-dev.crossmark.ru`.

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

### Docker Compose деплой (актуальный путь)

Полная инструкция — [`deploy/README.md`](../../deploy/README.md). Кратко:

- **Backend** (контейнеры): postgres(pgvector)+redis+migrate+backend (воркеры BullMQ in-process), рантайм Bun.
  ```bash
  cd deploy/backend && cp backend.env.example backend.env   # заполнить
  docker compose --env-file backend.env up -d --build
  ```
- **Frontend** (контейнер): Next `output: 'standalone'`, `bun server.js` в контейнере,
  слушает 127.0.0.1:3001, nginx на хосте проксирует.
  ```bash
  cd deploy/frontend && cp frontend.env.example frontend.env
  docker compose --env-file frontend.env up -d --build
  ```
- **nginx** — на хост-машине (`deploy/nginx/*.conf`), TLS через certbot.

> Рантайм везде — Bun (последний). Prod-runner backend больше не на Node.

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
