# 09 — Observability и SLA

## Стек

| Слой | Инструмент | Лицензия |
|---|---|---|
| Logs | Loki | AGPL-3 |
| Metrics | Prometheus | Apache 2.0 |
| Traces | Tempo | AGPL-3 |
| Errors | GlitchTip | MIT |
| LLM | Langfuse | MIT |
| Дашборды | Grafana | AGPL-3 |
| Алерты | Alertmanager + Telegram | Apache 2.0 |
| Host-метрики | Netdata | GPL-3 |

Всё self-host, никаких SaaS.

Стандарт инструментации: **OpenTelemetry**. Все сервисы экспортируют через OTLP в OTel Collector → разные backend'ы.

---

## Логи

### Формат

JSON-структурированные:

```json
{
  "ts": "2026-05-10T12:34:56.789Z",
  "level": "INFO",
  "service": "ingest-api",
  "version": "1.2.3",
  "instance": "ingest-api-7d8c9f-xyz",
  "trace_id": "01H...",
  "span_id": "01H...",
  "tenant_id": "01H...",
  "user_id": "01H...",
  "event": "raw_event_created",
  "raw_event_id": "01H...",
  "data_class": "internal",
  "duration_ms": 42
}
```

### Правила

- **Без PII в логах.** Только UUID и неличные атрибуты.
- **Уровни:** DEBUG / INFO / WARN / ERROR / FATAL. В production по умолчанию INFO.
- **Один лог-эвент = один JSON.** Никаких многострочных stack traces без оборачивания.
- **Stack traces** — отдельным полем `stack`.
- **Хранение:** 30 дней в Loki, далее архив в MinIO (1 год).
- **Запросы по логам:** через Grafana Explore с LogQL.

---

## Метрики

### Бизнес-метрики (per-tenant)

| Метрика | Описание |
|---|---|
| `ingest_events_total` | Counter, labels: source_class |
| `ingest_events_failed_total` | Counter |
| `signals_extracted_total` | Counter, labels: signal_type |
| `themes_total` | Gauge, labels: status |
| `themes_weight_distribution` | Histogram |
| `links_proposed_total` | Counter |
| `links_confirmed_total` | Counter |
| `links_rejected_total` | Counter |
| `chat_messages_total` | Counter |
| `chat_first_token_latency_ms` | Histogram |
| `chat_total_latency_ms` | Histogram |
| `alignment_score` | Gauge |
| `mood_avg_response` | Gauge, labels: department, period |
| `llm_tokens_input_total` | Counter, labels: model |
| `llm_tokens_output_total` | Counter, labels: model |
| `llm_cost_rub_total` | Counter |
| `dau` / `mau` | Gauge, расчёт из chat_messages.user_id |

### Инфра-метрики

- API Gateway: `http_requests_total`, `http_request_duration_seconds`, `http_5xx_total`.
- DB: `pg_stat_*`, connection pool size, transaction lag.
- FalkorDB: query latency, memory usage.
- Kafka: lag per consumer group, throughput per topic.
- MinIO: object count, storage GB, requests/sec.
- Temporal: workflow runs, failures, latency.
- Langfuse: LLM calls, latency, cost.

### Сборка

- Все сервисы экспортируют `/metrics` (Prometheus format).
- Prometheus scrape каждые 15 секунд.
- Long-term storage: 13 месяцев в Mimir или Thanos (для крупных инсталляций).

---

## Traces

### Распространение контекста

- W3C Trace Context (`traceparent`, `tracestate` headers).
- Контекст передаётся через все сервисы + Kafka headers + LLM-вызовы.

### Span'ы

Каждый span содержит:
- `service.name`, `version`.
- `tenant_id`, `user_id`, `session_id`.
- `data_class`.
- При LLM-вызове — `model`, `tokens.in`, `tokens.out`, `cost.rub`.

### Ретеншн

- 14 дней в Tempo.
- Архив в MinIO для критичных трейсов (errors, slow > 10 сек).

---

## Дашборды Grafana

Обязательный набор (в репо `delivery/dashboards/`):

1. **Overview** — основной business + system KPI.
2. **Ingest** — поток входящего, по источникам.
3. **AI** — LLM use, латентность, cost, маршрутизация моделей.
4. **Chat** — пользовательские запросы, latency, satisfaction.
5. **Modules** — состояние каждого модуля (consolidator, reframer, alignment).
6. **Database** — PostgreSQL, FalkorDB, pgvector latency.
7. **Errors** — top errors.
8. **Cost** — runrate, прогноз на месяц.
9. **Mood** — анонимизированный, для админа.
10. **Alignment** — топ-индикатор, тренды.

---

## Алерты

### SEV-1 (критичные, 24/7)

- Любой 5xx-spike > 1% за 5 минут.
- Полная недоступность (probe failed > 3 раза).
- DB connection pool exhausted.
- Backup failure.
- LLM cost runrate × 2 от месячного бюджета (превышение бюджета).
- Целостность Raw Memory (несовпадение SHA-256 чексумм).

### SEV-2 (часовые)

- p95 latency > target × 2 за 15 минут.
- Kafka consumer lag > 10000 сообщений.
- Свободное место на диске < 20%.
- Temporal workflow failure rate > 5%.
- LLM provider failover triggered.

### SEV-3 (рабочее время)

- Ночной reframer (M-14) не запустился.
- Eventual consistency divergence (FalkorDB ≠ PostgreSQL).
- Meilisearch reindex lag > 10 минут.

### SEV-4 (низкий приоритет)

- Disk usage > 80%.
- Long-running query > 10 сек.

### Каналы уведомлений

- Telegram-бот в админ-чате.
- Email админу.
- При SEV-1 — звонок через PagerDuty-аналог (для крупных клиентов).

---

## SLA

### По нашим компонентам

| Метрика | Цель | Оценка |
|---|---|---|
| API доступность | 99.5% | За месяц |
| Чат p50 latency (до первого токена) | 1.5 сек | За день |
| Чат p95 latency | 4 сек | За день |
| Ingest p99 latency | 500 ms | За час |
| Recovery time objective (RTO) | 1 час | После аварии |
| Recovery point objective (RPO) | 15 минут | После аварии |
| Backup success rate | 100% | За месяц (≥1 в день) |

### По LLM-провайдерам

LLM — внешние, поэтому SLA через fallback:
- Если основной провайдер недоступен — fallback в течение 5 секунд.
- Если все внешние недоступны — переход на локальные модели в течение 30 секунд.
- Если локальные тоже — деградация UX (latency растёт), но система продолжает работать на cached responses.

### По compliance

- Forget-request — выполнен в течение 30 дней.
- Audit-логи доступны для запроса в течение 1 рабочего дня.

---

## Health checks

Каждый сервис экспортирует:
- `GET /health/live` — процесс жив (liveness).
- `GET /health/ready` — готов принимать трафик (readiness).
- `GET /health/start` — стартовая инициализация прошла (startup).

Включает проверки:
- DB connection.
- Kafka connection.
- Vault/OpenBao reachable.
- Embedding service reachable.
- Local LLM (если используется) — heartbeat ping.

---

## Cost tracking

В реалтайме считается:
- LLM tokens × tariff = ₽ → в Prometheus как counter.
- Embeddings, transcription, storage — оцениваются через периодические снапшоты.

Дашборд cost:
- Runrate за день / неделю / месяц.
- Прогноз до конца месяца.
- Бюджет и % использования.
- Breakdown по моделям и категориям (анализ / линкование / чат / reframing).

При 80% бюджета — предупреждение админу.
При 95% — переключение на локальные модели для несрочных задач.
При 100% — блокировка LLM-вызовов кроме критичных (chat).

---

## Что **не** делаем

- **Не отправляем telemetry в SaaS.** Никакого Sentry SaaS, Datadog, New Relic.
- **Не логируем content** сырых событий. Только метаданные.
- **Не используем cookie-tracking** на frontend.
- **Не собираем pii в анонимной телеметрии.**
