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

Зависимости (Postgres+pgvector / Redis / MinIO) — `docker compose -f docker-compose.dev.yml up -d`.
LiveKit для локальной разработки — `bun run livekit` (поднимает контейнер из `infra/livekit/`,
конфиг `livekit-dev.yaml`) или dev-инстанс `media-dev.crossmark.ru`.

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

Полная инструкция — корневой [`README.md`](../../README.md) → «Деплой на сервер».
nginx-конфиги — [`deploy/README.md`](../../deploy/README.md). Кратко:

- **Backend + Frontend** — единый `docker-compose.yml` в корне (postgres(pgvector) +
  redis + migrate(one-shot) + backend + frontend), рантайм Bun, без профилей.
  ```bash
  cp .env.example .env                       # заполнить секреты + порты
  docker compose up -d --build backend       # postgres + redis + migrate + backend
  docker compose up -d --build frontend      # Next standalone
  ```
- Порты публикации/приложений — через `.env` (`BACKEND_HOST_PORT`/`PORT`,
  `FRONTEND_HOST_PORT`/`FRONTEND_PORT`). Слушают только 127.0.0.1.
- **nginx** — на хост-машине (`deploy/nginx/*.conf`), TLS через certbot.

> Рантайм везде — Bun (последний). Prod-runner backend больше не на Node.

### LiveKit / Egress

Отдельный compose: [`infra/livekit/docker-compose.yml`](../../infra/livekit/docker-compose.yml)
(network_mode host, Linux-only). Конфиги — `infra/livekit/livekit.yaml`, `egress.yaml`
(прод-шаблоны, заполнить CHANGE_ME). Запуск: `cd infra/livekit && docker compose up -d`.
Обновление: `docker compose pull && docker compose up -d`.

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
