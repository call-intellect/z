# Runbook: восстановление после краха

## Severity

- SEV-1: полная потеря данных или > 1 час downtime.
- SEV-2: один компонент упал, остальные работают.

## Сценарии

### 1. Краш PostgreSQL без потери диска

```bash
docker compose restart postgres
docker compose logs postgres --tail 50
```

Если данные на месте — обычно стартует за минуту.

### 2. Краш PostgreSQL с повреждением

```bash
# 1. Остановить postgres
docker compose stop postgres

# 2. Сохранить текущее состояние (вдруг пригодится)
sudo cp -r /var/lib/docker/volumes/secondbrain_postgres-data /tmp/postgres-corrupted

# 3. Восстановить из backup до точки T
./scripts/restore-postgres.sh \
    --target-time="2026-05-10 11:00:00 UTC" \
    --confirm

# 4. Запустить
docker compose start postgres

# 5. Проверить
./scripts/health.sh
```

### 3. Краш FalkorDB

FalkorDB восстанавливается из RDB + AOF в первую очередь:

```bash
docker compose stop falkordb
sudo cp -r /var/lib/docker/volumes/secondbrain_falkordb-data /tmp/falkordb-corrupted

# Если AOF есть и валиден — стартует автоматом
docker compose start falkordb
docker compose logs falkordb --tail 50

# Если AOF битый
./scripts/restore-falkordb.sh --target-time="2026-05-10 11:00:00 UTC"
```

После восстановления FalkorDB — обязательно прогнать consistency check:

```bash
./scripts/check-consistency.sh --postgres-vs-falkordb
```

Если расхождения — пересоздать узлы из PostgreSQL (PostgreSQL — source of truth):

```bash
./scripts/rebuild-falkordb-from-postgres.sh
```

### 4. Краш MinIO с потерей данных

```bash
./scripts/restore-minio.sh --target-time="2026-05-10 03:00:00 UTC"
```

Если MinIO secondary доступен — переключение через DNS:

```bash
# 1. Обновить DNS A-запись minio.example.ru → secondary IP
# 2. Обновить env в compose
# 3. Перезапустить сервисы, использующие MinIO
docker compose restart api-gateway ingest-api whisper-service
```

### 5. Полная потеря сервера

См. `dr-drill.sh` flow в `backup.md`. Восстановление на новый сервер:

```bash
# На новом сервере
git clone https://repo.../delivery-installer.git
cd delivery-installer

# Восстановить .env из git private repo (config backup)
git clone https://gitea.local/admin/secondbrain-config.git
cp secondbrain-config/.env .

# Восстановить secrets из off-site backup OpenBao
./scripts/restore-openbao.sh --target-time="..."

# Запустить инсталляцию
./scripts/install.sh --restore-mode --backup-source=s3://...

# Дождаться завершения, проверить
./scripts/health.sh
./scripts/check-consistency.sh
```

RTO: 1 час для single-node setup.
RPO: 15 минут (благодаря WAL).

## После восстановления

1. **Не объявлять «всё нормально»** до прохождения smoke tests.
2. **Postmortem обязателен** — почему упало, как избежать в будущем.
3. **Проверить, что backup продолжает работать.**
4. **Пересмотреть мониторинг** — почему не предсказали.

## Edge cases

### LiteLLM cache corrupted

```bash
docker compose restart valkey  # очистит in-memory cache
```

Это безопасно — пересчитается за несколько часов работы.

### Kafka lost messages

Outbox pattern гарантирует at-least-once. Поэтому потерю сообщений можно «переиграть»:

```bash
./scripts/replay-outbox.sh --from="2026-05-10 11:00:00 UTC"
```

Скрипт перепубликует все события из outbox от указанного времени. Consumer'ы — идемпотентны, дублирование безвредно.

### Embedding service не стартует

Без эмбеддингов система деградирует, но не падает:
- Новые сигналы попадают в `signals_pending_embedding`.
- M-08 theme matching без эмбеддингов → fallback на keyword match.
- M-11 linker без эмбеддингов → fallback на graph traversal.

После восстановления — batch backfill:

```bash
./scripts/backfill-embeddings.sh
```

### LLM-провайдеры все недоступны

Архитектурно невозможно (есть локальный fallback). Но если каскадно:
- Новые сигналы попадают в `signals_pending_analysis`.
- Чат — деградация UX (медленнее, на cached responses).

После восстановления:

```bash
./scripts/process-pending-llm.sh
```

## Эскалация

Если восстановление занимает > 30 минут — эскалировать к старшему инженеру.
Если > 2 часов — внешняя помощь (vendor / consultant).
Если > 24 часа — официальное уведомление клиента + публичное postmortem.
