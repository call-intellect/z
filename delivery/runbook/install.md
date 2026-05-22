# Runbook: установка с нуля

## Предусловия

- Сервер с минимальными требованиями (см. [11-deployment.md](../11-deployment.md)).
- Ubuntu 24.04 LTS с обновлениями.
- Domain name указывает на сервер.
- API-ключи к LLM-провайдерам (если используются cloud).
- Доступ к репозиторию `delivery-installer`.

## Шаги

### 1. Подготовка ОС

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y docker.io docker-compose-v2 git curl wget jq
sudo usermod -aG docker $USER
newgrp docker
```

### 2. Шифрование диска (LUKS)

Если диск ещё не зашифрован — настройте перед продолжением. Это критично для production.

### 3. Клонирование репозитория

```bash
cd /opt
sudo git clone https://repo.../delivery-installer.git secondbrain
cd secondbrain
```

### 4. Настройка `.env`

```bash
cp .env.example .env
nano .env
```

Минимально нужно:

```
TENANT_ID=<uuid>
TENANT_DOMAIN=company.example.ru
ADMIN_EMAIL=admin@company.ru

# LLM (опционально)
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
GEMINI_API_KEY=...

# DB (генерируется install.sh, можно оставить пустым)
DB_PASSWORD=
KEYCLOAK_DB_PASSWORD=
TEMPORAL_DB_PASSWORD=
LANGFUSE_DB_PASSWORD=
GLITCHTIP_DB_PASSWORD=
OPENFGA_DB_PASSWORD=

# MinIO
MINIO_ROOT_USER=admin
MINIO_ROOT_PASSWORD=

# Valkey
VALKEY_PASSWORD=

# Meilisearch
MEILI_MASTER_KEY=

# LiteLLM
LITELLM_MASTER_KEY=
LITELLM_UI_PASSWORD=

# Grafana
GRAFANA_ADMIN_PASSWORD=

# Langfuse
LANGFUSE_SECRET=
```

### 5. Запуск установщика

```bash
sudo ./scripts/install.sh \
    --tenant-id=$TENANT_ID \
    --domain=$TENANT_DOMAIN \
    --admin-email=$ADMIN_EMAIL \
    --llm-mode=hybrid
```

Скрипт:
1. Сгенерирует все недостающие пароли в `.env`.
2. Создаст `secrets/` файлы из `.env`.
3. Запустит OpenBao и инициализирует.
4. Загрузит все секреты в OpenBao.
5. Запустит docker compose.
6. Дождётся healthcheck'ов.
7. Применит миграции PostgreSQL.
8. Инициализирует FalkorDB.
9. Создаст buckets MinIO.
10. Зарегистрирует тенанта в OpenFGA.
11. Создаст admin-пользователя в Keycloak с временным паролем.
12. Отправит password reset на email.

### 6. Проверка

```bash
docker compose ps   # все сервисы должны быть Up (healthy)
./scripts/health.sh # запускает все healthcheck'и

# В браузере: https://${TENANT_DOMAIN}
# Должен открыться Keycloak login.
```

### 7. Первый вход

1. Открыть `https://${TENANT_DOMAIN}` в браузере.
2. Войти как admin (письмо с magic-link на ADMIN_EMAIL).
3. Сменить пароль на надёжный.
4. Включить MFA (TOTP или passkeys).
5. Открыть Wizard первоначальной настройки → пройти онбординг.

### 8. Подключение источников

См. `connect-source.md`.

### 9. Backup конфигурация

```bash
sudo ./scripts/setup-backups.sh \
    --restic-repo=s3:https://backup.example.ru/secondbrain-${TENANT_ID} \
    --schedule=daily
```

Проверить, что первый backup прошёл:

```bash
./scripts/backup-now.sh
./scripts/list-backups.sh
```

## Troubleshooting

### Контейнер не стартует

```bash
docker compose logs <service-name> --tail 100
```

Типичные ошибки:
- DB unreachable → проверить `postgres` healthy.
- Missing secret → проверить, что `.env` заполнен и `./secrets/` файлы существуют.
- Out of memory → увеличить RAM или отключить vLLM (без локальных LLM).

### TLS не работает

```bash
docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile
docker compose logs caddy --tail 50
```

Убедиться, что domain указывает на сервер (DNS `A` запись).

### Миграции упали

```bash
./scripts/migrations.sh --dry-run    # показать что будет применено
./scripts/migrations.sh --apply       # применить
./scripts/migrations.sh --rollback    # откат последней
```

## Что дальше

- `connect-source.md` — подключить первый источник.
- `add-role.md` — настроить роли сотрудников.
- `cold-start.md` — запустить начальный квиз.
