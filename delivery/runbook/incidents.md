# Runbook: инцидент-менеджмент

## Severity-классификация

### SEV-1 (критичный, 24/7)

- Утечка ПД.
- Полная недоступность сервиса > 1 час.
- Потеря данных (Raw Memory повреждена, backup тоже).
- Compliance breach.

**SLA реакции:** 15 минут.
**Ответственный:** дежурный инженер + старший инженер + админ клиента.

### SEV-2 (высокий, рабочее время + дежурство)

- Недоступность критичной функции (чат / dashboard) > 30 минут.
- LLM-провайдеры все недоступны > 1 час (даже с fallback).
- Потенциальная утечка (аномалия в audit-логе, не подтверждённая).
- Производительность p95 латентности × 5 от target > 1 час.

**SLA реакции:** 1 час в рабочее время, 2 часа вне.
**Ответственный:** дежурный инженер.

### SEV-3 (средний, рабочее время)

- Деградация одного модуля (например, transcription медленная).
- Eventual consistency divergence не саморезолвится.
- Высокая стоимость LLM (превышение бюджета).
- Backup пропустил один цикл.

**SLA реакции:** 1 рабочий день.
**Ответственный:** инженер по сменам.

### SEV-4 (низкий, плановый)

- Мелкие баги.
- Косметические UI-проблемы.
- Single-user issues.

**SLA реакции:** 1 неделя.
**Ответственный:** ticket queue.

## Процедура реагирования

### 1. Detection

Источники:
- Alertmanager → Telegram админа.
- Healthcheck-зонды.
- Жалобы пользователей через `/admin/feedback`.

Каждый алерт с severity создаёт incident в трекере (Zammad / GLPI / в нашей системе).

### 2. Triage

Дежурный инженер:
- Подтверждает severity.
- Назначает ownership.
- Создаёт incident-channel в Telegram (`#incident-YYYY-MM-DD-<short-name>`).
- Уведомляет админа клиента.

### 3. Diagnosis

Использовать observability stack:
- Grafana → Overview dashboard.
- Loki → последние ERROR логи.
- Tempo → traces с failed requests.
- Langfuse → LLM-related issues.

### 4. Mitigation

Цель — вернуть сервис в рабочее состояние, не обязательно «починить fully».

Готовые runbook'и:
- `restore.md` — восстановление после краха.
- `cost-spike.md` — высокий cost.
- `forget-user.md` — compliance.
- `connect-source.md` — проблемы с источниками.

Если runbook нет — действовать по ситуации, документировать в incident-channel.

### 5. Communication

Каждые 30 минут (или чаще для SEV-1) — апдейт в incident-channel:
- Что обнаружено.
- Что предприняли.
- Текущее состояние.
- ETA.

Для SEV-1 — статус-страница для клиентов / пользователей.

### 6. Resolution

Когда:
- Метрики вернулись к baseline.
- Нет new alerts по 30 минут.
- Smoke tests прошли.

Объявить resolved → закрыть incident-channel (но архив сохранить).

### 7. Postmortem

Обязателен для SEV-1 и SEV-2. Желателен для SEV-3.

Шаблон в `runbook/postmortem-template.md`. Формат blameless:
- Что произошло (timeline).
- Что хорошо.
- Что плохо.
- Что повезло.
- Action items с owner и deadline.

Сохраняется в `runbook/postmortems/YYYY-MM-DD-<title>.md`.

Review postmortem через 1 неделю — все ли action items закрыты.

## Конкретные сценарии

### SEV-1: утечка ПД

```
1. Изоляция: отключить compromised service / endpoint.
2. Audit: что именно утекло, кому, когда.
3. Уведомление РКН в течение 24 часов.
4. Уведомление субъектов в течение 72 часов.
5. Forensics: trace через audit-log.
6. Ротация всех credentials.
7. Postmortem с участием security team.
```

### SEV-1: полная недоступность

```
1. Healthcheck все красные → проверить infra:
   - Хост жив? (SSH / ping)
   - Docker Engine жив?
   - DNS работает?
2. Если проблема в одном сервисе — restart.
3. Если в нескольких — посмотреть зависимости (DB? Kafka?).
4. Если Postgres / FalkorDB упал — restore.md.
5. Если хост умер — DR drill сценарий на новый сервер.
```

### SEV-1: потеря данных

```
1. Не паниковать. Backups должны быть.
2. Изоляция: stop writes на повреждённый storage.
3. Restore из последнего хорошего backup.
4. Если backup тоже плох — попытаться восстановить из off-site.
5. Если совсем потеряно — communication с клиентом + audit о scope потери.
```

### SEV-2: LLM-провайдеры недоступны

```
1. Проверить status pages всех провайдеров.
2. Принудительно переключить на local LLM:
   ./scripts/llm-policy.sh --emergency-mode
3. Если local тоже падает — проверить vLLM/Ollama.
4. Деградация UX: чат медленнее, но работает.
5. После восстановления — replay pending tasks.
```

### SEV-3: cost spike

См. `cost-spike.md`.

### SEV-3: eventual consistency divergence

Выявляется автоматическим check каждые 6 часов:
- PostgreSQL и FalkorDB должны иметь одинаковый набор узлов.
- Если расхождение > 100 узлов или > 1% — алерт.

Fix:
```bash
./scripts/sync-falkordb-from-postgres.sh
```

PostgreSQL — source of truth, FalkorDB пересоздаётся из неё.

## Runbook-инструменты

### Quick health-check

```bash
./scripts/health.sh
```

Скрипт:
- Pings всех сервисов.
- Проверяет healthcheck endpoints.
- Возвращает summary.

### Quick metrics

```bash
./scripts/metrics-snapshot.sh --period=5m
```

Скрипт:
- Собирает ключевые метрики за 5 минут.
- Выводит таблицу: latency p50/p95/p99, error rate, cost rate, throughput.

### Cordon (отключение приёма траффика)

```bash
./scripts/cordon.sh --service=ingest-api
```

Это останавливает приём новых запросов, но continues обрабатывать pending. Для maintenance.

### Drain (ожидание завершения работы)

```bash
./scripts/drain.sh --service=m14-reframer --timeout=300
```

Ждёт завершения текущей задачи перед остановкой.

## Документация инцидентов

Все incidents хранятся в `runbook/incidents/YYYY-MM-DD-<title>/`:
- `summary.md` — краткое описание.
- `timeline.md` — детальная хронология.
- `postmortem.md` (если SEV-1/SEV-2).
- `attachments/` — скриншоты, логи.

Для compliance аудита — incidents по PII доступны 5 лет.
