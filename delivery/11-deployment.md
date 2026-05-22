# 11 — Deployment, DevOps, Runbook

## Профили деплоя

| Профиль | Размер клиента | Стек |
|---|---|---|
| Single-node | До 50 человек | Docker Compose, 1 сервер 16 vCPU / 64 GB |
| Multi-node | 50-200 человек | Docker Swarm или k3s, 3-4 сервера |
| Kubernetes | 200+ человек | Kubernetes (kubeadm/Rancher), 6+ нод |

В первом релизе — все три профиля поддерживаются одной кодовой базой через разные Helm charts / compose-файлы.

---

## Минимальные требования (single-node, до 50 чел)

| Компонент | Минимум | Рекомендуется |
|---|---|---|
| CPU | 16 vCPU | 32 vCPU |
| RAM | 64 GB | 128 GB |
| Disk SSD | 500 GB | 2 TB NVMe |
| GPU (для локальных LLM) | Не обязателен | RTX 4090 24 GB или A100 |
| OS | Ubuntu 24.04 LTS | Ubuntu 24.04 LTS |
| Docker | 27+ | latest |
| Сеть | 1 Gbps | 10 Gbps |

### Без GPU

Если у клиента нет GPU:
- LLM — только через внешних провайдеров.
- Embeddings — через CPU (медленнее, ~30 ms на эмбеддинг вместо 3 ms).
- Whisper — через CPU faster-whisper (медленнее, 1× real-time vs 10×).

Это допустимо, но снижает качество приватного режима (sensitive data → требуют локальной LLM).

---

## Docker Compose (single-node)

### Структура

```
deploy/
├── compose/
│   ├── docker-compose.yml             # production
│   ├── docker-compose.dev.yml         # dev overrides
│   ├── .env.example
│   └── secrets/                       # пустая, заполняется из OpenBao
├── helm/                              # Kubernetes
└── scripts/
    ├── install.sh
    ├── backup.sh
    ├── restore.sh
    └── upgrade.sh
```

### Сервисы (упрощённо)

```yaml
# delivery/schemas/docker-compose.example.yml — здесь только outline
services:
  caddy:                # reverse proxy + TLS
  keycloak:             # IdP
  api-gateway:          # FastAPI основная точка входа
  ingest-api:           # M-02 endpoint
  whisper-service:      # M-04 транскрипция
  query-agent:          # M-23 чат
  m05-analyzer:         # фоновый
  m11-linker:           # фоновый
  m13-consolidator:     # фоновый Temporal worker
  m14-reframer:         # фоновый Temporal worker
  m16-alignment:        # фоновый
  m19-mood:             # фоновый
  m22-metrics:          # фоновый
  m38-supervisor:       # AI-команда
  postgres:             # с pgvector
  falkordb:
  meilisearch:
  minio:
  valkey:               # Redis-fork
  kafka:
  temporal:
  langfuse:
  prometheus:
  grafana:
  loki:
  tempo:
  alertmanager:
  openbao:              # secrets
  glitchtip:            # error tracking
  vllm:                 # для локальных LLM (если есть GPU)
  ollama:               # лёгкая альтернатива
  embedding-service:    # bge-m3 через FastAPI обёртка
  rerank-service:       # bge-reranker
```

Полный compose-файл — в `schemas/docker-compose.example.yml`.

### Запуск

```bash
# Первый запуск
./scripts/install.sh

# Команды
docker compose -f compose/docker-compose.yml up -d
docker compose -f compose/docker-compose.yml logs -f service-name
docker compose -f compose/docker-compose.yml ps
```

### Сети

- `front-net` — Caddy ↔ публичная сеть.
- `app-net` — Caddy ↔ API-сервисы.
- `data-net` — приложения ↔ БД (только internal).
- `obs-net` — observability stack.

---

## Kubernetes (200+)

### Helm

Каждый компонент — отдельный chart в `helm/`. Корневой chart — `helm/secondbrain`, агрегирует subcharts.

Пример values.yaml:

```yaml
global:
  tenant:
    id: 01H...
    domain: company.example.ru

  llm:
    providers:
      anthropic:
        enabled: true
      openai:
        enabled: true
      local:
        enabled: true
        gpu: true

  storage:
    postgres:
      replicas: 3
      storageGB: 500
    falkordb:
      replicas: 1
      storageGB: 100
    minio:
      replicas: 4

  observability:
    retention:
      logsDays: 30
      metricsDays: 395
      tracesDays: 14
```

### Namespaces

- `secondbrain-app` — все приложения.
- `secondbrain-data` — БД.
- `secondbrain-obs` — observability.
- `secondbrain-ai` — vLLM/Ollama.
- `secondbrain-ingress` — Caddy / nginx.

### Storage Classes

- `fast-ssd` — для PostgreSQL, FalkorDB, vLLM model files.
- `bulk` — для MinIO, backups.

---

## CI/CD

### Trunk-based development

- Один долгоживущий branch `main`.
- Feature branches — короткоживущие, < 3 дня.
- PR обязательно проходит quality gates ([10-testing.md](10-testing.md)).
- `main` — всегда production-ready.

### Pipeline

См. [10-testing.md](10-testing.md), раздел CI/CD pipeline.

### Реестр

- **Harbor** self-host.
- Все образы подписаны через **Cosign** (sigstore).
- При pull в production — проверка подписи.

### Окружения

| Окружение | Назначение | Деплой |
|---|---|---|
| local | Разработка | docker compose dev |
| ci | Тесты в CI | ephemeral, поднимается per PR |
| staging | Pre-prod проверка | auto-deploy main |
| production | Боевой | manual approval |

---

## Backup и Restore

### PostgreSQL

- **WAL archiving** в MinIO `backups/postgres/wal/`.
- **Базовый бэкап** через `pg_basebackup` раз в сутки в `backups/postgres/base/<date>/`.
- **Restic snapshot** раз в сутки → внешний disaster recovery storage.

Восстановление до момента T:

```bash
./scripts/restore-postgres.sh --target-time "2026-05-10 12:00:00 UTC"
```

### FalkorDB

- RDB snapshot раз в час.
- AOF (append-only file).
- Restic snapshot раз в сутки.

### MinIO

- Bi-directional репликация на secondary MinIO в другом дата-центре (для крупных клиентов).
- Restic snapshot объектов раз в сутки.

### Графовый time-travel

- Graphiti держит историю рёбер встроенно через `valid_from`/`valid_to`.
- Запрос «как было N дней назад» выполняется к актуальной БД с фильтром по времени.

### Disaster Recovery drill

Раз в квартал:
- Полный restore на отдельный стенд.
- Sanity-check всех модулей.
- Verification: cross-checksum с боевой.

---

## Установка у нового клиента

### Day 0: предустановка

1. Клиент получает чек-лист железа и сетевых требований.
2. Заводится репо с конфигом тенанта (домен, branding).
3. Получаются API-ключи к LLM-провайдерам (если нужны).

### Day 1: установка

```bash
# На сервере клиента
git clone https://repo.../delivery-installer.git
cd delivery-installer
./install.sh \
    --tenant-id=01H... \
    --domain=company.example.ru \
    --admin-email=admin@company.ru \
    --llm-mode=hybrid
```

Скрипт:
1. Поднимает Docker Compose со всеми сервисами.
2. Создаёт первого пользователя (admin) и шлёт password reset.
3. Применяет миграции PostgreSQL.
4. Инициализирует FalkorDB schema.
5. Создаёт buckets MinIO.
6. Регистрирует тенанта в OpenFGA.
7. Генерирует и кладёт ключи в OpenBao.
8. Запускает healthcheck'и.

### Day 2-7: онбординг данных

1. Админ через UI подключает источники (M-01, M-40).
2. Запускается historical backfill (cron, 1-2 ночи).
3. Включается активный квиз для cold-start.
4. Первый dump делается AI-разбор всех документов компании, импортированных в МинIO.

### Day 7-30: калибровка

- Веса источников, тем, decay-параметры подкручиваются.
- Назначаются роли сотрудникам.
- Включается M-19 (mood) с двойным opt-in.

---

## Upgrade процесс

### Minor (patch / bugfix)

```bash
./scripts/upgrade.sh --version=1.2.3
```

Скрипт:
1. Pull новых образов.
2. Применение миграций (Alembic).
3. Rolling restart сервисов (zero downtime).
4. Smoke tests.
5. Если падают — auto-rollback на предыдущий compose-файл.

### Major (breaking changes)

- Заранее объявляется в release notes.
- Migration guide в `runbook/migrations/`.
- Maintenance window согласовывается с клиентом.
- Backup перед началом.
- Применение миграций.
- Smoke tests.

### Откат миграций

- PostgreSQL миграции — поддерживают rollback (через Alembic downgrade).
- FalkorDB миграции — only forward. Откат через restore из снапшота.

---

## Runbook (типовые операции)

См. `runbook/`.

| Операция | Файл |
|---|---|
| Запуск с нуля | `runbook/install.md` |
| Backup | `runbook/backup.md` |
| Restore | `runbook/restore.md` |
| Upgrade minor | `runbook/upgrade-minor.md` |
| Upgrade major | `runbook/upgrade-major.md` |
| Подключить источник | `runbook/connect-source.md` |
| Включить новую роль | `runbook/add-role.md` |
| Forget request | `runbook/forget-user.md` |
| Сменить LLM-провайдера | `runbook/switch-llm-provider.md` |
| Восстановиться после краха БД | `runbook/db-disaster.md` |
| Заполнен диск | `runbook/disk-full.md` |
| Высокая стоимость LLM | `runbook/cost-spike.md` |

---

## Конфигурация per-tenant

Файл `tenant.yaml`:

```yaml
tenant:
  id: 01H...
  display_name: "Ромашка ООО"
  domain: company.example.ru
  timezone: Europe/Moscow
  locale: ru

llm:
  routing_policy: hybrid    # cloud / hybrid / local-only
  budget_rub_month: 100000
  providers:
    anthropic:
      enabled: true
      models: [sonnet-4-6, haiku-4-5]
    openai:
      enabled: true
      models: [gpt-4o, gpt-4o-mini]
    local:
      enabled: true
      models: [qwen-2.5-72b, llama-3.3-70b]
  data_class_policy:
    public: [smart-default, fast-default, smart-local]
    internal: [smart-default, smart-local]
    sensitive: [smart-local]
    private: [smart-local]

modules:
  m19_mood: enabled
  m33_external_intelligence: enabled
  m37_commitments_to_tasktracker: disabled

retention:
  ephemeral_days: 7
  session_days: 90
  raw_events_years: 7
  audit_log_years: 3

branding:
  logo_url: /assets/tenant-logo.png
  primary_color: "#2D5BFF"

integrations:
  task_tracker: yougile
  crm: bitrix24
  calendar: google_workspace
```

При изменении — рестарт затронутых сервисов (через ConfigMap reload в k8s или recreate в Compose).

---

## Hardening

### Каждый сервер (Ansible-плейбук)

1. Обновления безопасности (`apt unattended-upgrades`).
2. Firewall — только нужные порты (80/443 наружу, 22 только из bastion).
3. SSH — only key-based, no root login, fail2ban.
4. AppArmor / SELinux профили для контейнеров.
5. Шифрование диска (LUKS).
6. Auto-rotate logs.

### Каждый Docker container

- `read_only: true` где возможно.
- `cap_drop: [ALL]` + явный `cap_add` только нужного.
- `user:` — non-root.
- `security_opt: [no-new-privileges]`.

### Network policies (k8s)

- Default-deny между namespaces.
- Explicit allow только для нужных pair'ов.

---

## Cost optimization (для клиента)

Рекомендации в админке:

- При данных < 100 GB — single-node профиль достаточен.
- При активности < 100 запросов/день — отключить `vllm`/локальные LLM (только cloud).
- При высоких объёмах — сравнить cost cloud LLM vs локальная инфра + GPU. Точка переключения ~1М запросов/мес.
- Включить semantic cache для FAQ-style запросов.
- Архивировать старые `raw_events` в холодное хранилище (после 1 года) — снижает active storage.

---

## Что **не** делаем в продакшне

- `docker-compose.yml` без `restart: unless-stopped` или эквивалентного.
- Запуск контейнеров под root.
- Хранение секретов в `.env` файлах в production.
- Отключение SSL даже на «временных» внутренних endpoints.
- Manual ALTER TABLE без Alembic миграции.
- Push образов в registry без сканирования Trivy.
- Деплой сервиса, у которого нет healthcheck'ов.
- Отключение audit-логирования для performance.
