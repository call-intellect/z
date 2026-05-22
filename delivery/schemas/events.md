# События event bus (Kafka)

Все события идут в Kafka (`bootstrap.servers=kafka:9092`). Топики per-tenant с префиксом `<tenant_id>.`.

## Формат сообщения

```json
{
  "event_id": "01H...",
  "tenant_id": "01H...",
  "occurred_at": "2026-05-10T12:34:56Z",
  "schema_version": "1.0",
  "data_class": "internal",
  "trace_id": "...",
  "produced_by": "service-name",
  "payload": { ... }
}
```

Сериализация — JSON. На крупных инсталляциях можно перевести в Protobuf через Schema Registry.

## Топики

### `ingest.raw.events`

Создан новый RawEvent.

```json
"payload": {
  "raw_event_id": "01H...",
  "source_id": "01H...",
  "content_type": "text",
  "data_class": "internal",
  "size_bytes": 1234,
  "has_attachments": false
}
```

### `signals.extracted`

M-05 закончил первичный анализ.

```json
"payload": {
  "raw_event_id": "01H...",
  "signals_count": 3,
  "signal_ids": ["01H...", "01H...", "01H..."],
  "topics_hint": ["медленная поддержка", "интеграция"],
  "language": "ru"
}
```

### `themes.changed`

Тема создана / изменена / merged / split.

```json
"payload": {
  "theme_id": "01H...",
  "change_type": "created" | "updated" | "merged" | "split" | "archived",
  "previous_state": { ... },
  "new_state": { ... },
  "actor": "agent:m14_reframer" | "user:01H..."
}
```

### `links.proposed`

M-11 предложил связь.

```json
"payload": {
  "link_id": "01H...",
  "from_node": {"type": "theme", "id": "01H..."},
  "to_node": {"type": "decision", "id": "01H..."},
  "relation_type": "помогает",
  "confidence": 0.83,
  "explanation": "...",
  "evidence_signal_ids": ["01H..."]
}
```

### `links.confirmed`

Человек подтвердил связь через M-26.

```json
"payload": {
  "link_id": "01H...",
  "confirmed_by": "user:01H...",
  "confirmation_level": "confirmed"
}
```

### `goals.changed`

Изменение цели.

```json
"payload": {
  "goal_id": "01H...",
  "change_type": "created" | "updated" | "achieved" | "abandoned",
  "actor": "user:01H..."
}
```

### `decisions.recorded`

Зафиксировано решение.

```json
"payload": {
  "decision_id": "01H...",
  "title": "...",
  "decided_by": "01H...",
  "related_themes": ["01H..."],
  "related_goals": ["01H..."]
}
```

### `mood.checkin_completed`

Сотрудник прошёл активный чек-ин.

**Особенность:** содержит только агрегатные данные. Личные ответы — только в `mood_active_responses`, не публикуются в шину.

```json
"payload": {
  "department_id": "01H...",
  "bucket_date": "2026-05-10",
  "sample_size": 12,
  "avg_mood": 4.1
}
```

### `alignment.computed`

M-16 пересчитал согласованность.

```json
"payload": {
  "score": 72,
  "submetrics": {
    "voices_alignment": 78,
    "actions_to_goals": 65,
    "drift_velocity": 5
  },
  "computed_at": "..."
}
```

### `metrics.anomaly`

Аномалия в timeseries.

```json
"payload": {
  "metric_id": "01H...",
  "metric_code": "conversion_rate",
  "delta": -0.15,
  "direction": "down",
  "explanation": "Падение на 15% за неделю",
  "p_value": 0.02
}
```

### `commitments.detected`

Извлечено обещание из транскрипции.

```json
"payload": {
  "commitment_id": "01H...",
  "person_id": "01H...",
  "deadline": "2026-05-17",
  "source_event_id": "01H..."
}
```

### `agent.actions`

Audit-лог AI (тоже идёт в Kafka для централизации).

```json
"payload": {
  "agent_id": "supervisor",
  "tool_called": "search.signals",
  "duration_ms": 230,
  "cost_tokens_input": 1200,
  "cost_tokens_output": 350,
  "cost_rub": 0.5,
  "confidence_self": 0.85
}
```

### `forget.completed`

Compliance-удаление завершено.

```json
"payload": {
  "request_id": "01H...",
  "target_type": "user",
  "target_id": "01H...",
  "deleted_records": 1234,
  "anonymized_mentions": 56
}
```

## Топики администрирования (только админ-сервисы пишут)

- `admin.sources.changed` — добавили/изменили источник.
- `admin.roles.changed` — RBAC изменения.
- `admin.config.changed` — изменения tenant.yaml.

## Ретеншн

- `ingest.raw.events`, `signals.extracted`, `agent.actions` — 30 дней в Kafka, далее archive в MinIO.
- Остальные — 7 дней.
- Compaction для топиков с key — `cleanup.policy=compact` (для последнего состояния сущности).

## Consumer groups

Каждый сервис — свой consumer group:
- `m05-analyzer` слушает `ingest.raw.events`.
- `m08-theme-matcher` слушает `signals.extracted`.
- `m11-linker` слушает `signals.extracted` + `themes.changed`.
- `m13-consolidator` — cron (Temporal), не consumer.
- `m14-reframer` — cron.
- `m16-alignment` — cron.
- `m22-metrics` слушает `decisions.recorded` + cron.
- `meilisearch-indexer` слушает все `*.changed`.
- `dashboard-cache` слушает все события для invalidation.
- `analytics-warehouse` слушает все для долгосрочного хранилища.

## Идемпотентность consumer'ов

Все consumer'ы должны проверять `event_id` через таблицу `processed_events`:

```sql
INSERT INTO processed_events (consumer_group, event_id, processed_at)
VALUES ('m05-analyzer', '01H...', NOW())
ON CONFLICT (consumer_group, event_id) DO NOTHING;
```

Если `INSERT` не сработал — событие уже обработано, пропускаем.

## Outbox pattern

Все события создаются в одной транзакции с бизнес-изменением через `outbox_events`. Отдельный сервис `outbox-publisher` опрашивает таблицу и публикует в Kafka:

```python
def publish_outbox():
    while True:
        events = db.fetch("SELECT * FROM outbox_events WHERE published_at IS NULL ORDER BY created_at LIMIT 100")
        for event in events:
            kafka.send(event.topic, event.key, event.payload, headers=event.headers)
            db.execute("UPDATE outbox_events SET published_at = NOW() WHERE id = ?", event.id)
        sleep(0.1)
```

Это гарантирует at-least-once delivery без распределённых транзакций.
