# Runbook: AI-pipeline упал (status=`failed`)

## Симптомы

- Хост открывает `/meetings/:id/result` и видит «AI-обработка не удалась».
- В БД `Meeting.status = 'failed'`, `failureReason` заполнено.
- Алерт **RecordingsFailing** или **LlmFallbackHigh** или **BullMqFailedJobsHigh** мог сработать раньше.

## Диагностика

1. Найти причину:

   ```bash
   docker compose exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
     -c "SELECT id, status, failure_reason FROM \"Meeting\" WHERE id='<MEETING_ID>';"
   ```

2. Посмотреть последние записи `AiUsageLog`:

   ```bash
   docker compose exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
     "SELECT agent_type, model, provider, status, error_text, created_at
        FROM ai_usage_log
        WHERE meeting_id='<MEETING_ID>'
        ORDER BY created_at DESC LIMIT 20;"
   ```

3. Логи воркеров (BullMQ-воркеры работают in-process внутри контейнера `backend`):

   ```bash
   docker compose logs --since 1h backend | grep -i '<MEETING_ID>'
   ```

4. BullMQ failed jobs — через admin-инспектор очередей (`GET /api/v1/admin/platform/workers/queues`):
   - Очереди: `ai.transcribe`, `ai.merge`, `ai.analyze`, `ai.notify`.
   - Сводка по очереди — counts (waiting/active/failed/delayed/completed/paused).
   - Детали одной очереди (`GET /api/v1/admin/platform/workers/queues/:name`) — последние 20 failed-job с `failedReason`.

## Recovery

### Вариант 1: retry через UI

Хост может нажать **Перезапустить AI** на странице `/meetings/:id/result`.
Внутри это `POST /api/v1/meetings/:id/retry-ai` — rate-limit 3/час на пользователя.

### Вариант 2: retry через админку

`POST /admin/api/v1/meetings/:id/retry-ai` (без лимита).

### Вариант 3: проверить провайдеров

- **Vox/GigaAM down** (ASR) → встречи зависают в `transcription_processing`.
  Митигация: SSH на `vox.agent-lia.ru`, проверить `systemctl status gigaam`. Сейчас fallback не предусмотрен.
- **Anthropic 403/блок** → fallback на MiniMax → OpenAI-via-proxy сработает автоматически.
  Проверить `llm_fallback_total` в Grafana.
- **proxy.agent-lia.ru down** → встречи висят с ошибкой LLM. Проверить SSH доступность.

### Вариант 4: ручной запуск этапа

Если pipeline упал на конкретном этапе — поставить job вручную:

```bash
# Транскрибация
redis-cli LPUSH bull:transcribe:wait '{"name":"transcribe","data":{"meetingId":"<MEETING_ID>"}}'
# Merge
redis-cli LPUSH bull:merge:wait    '{"name":"merge","data":{"meetingId":"<MEETING_ID>"}}'
# Analyze (LLM)
redis-cli LPUSH bull:analyze:wait  '{"name":"analyze","data":{"meetingId":"<MEETING_ID>"}}'
```

## Escalation

- Если все три LLM-провайдера падают — @ai-on-call (заранее проверь VPN/прокси).
- Если падает Vox >30 минут — @infra-on-call (ноду перезапустить, в крайнем случае — отметить встречу `failed` с человекочитаемым сообщением для хоста).
