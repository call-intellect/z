# Известные ограничения и known issues (MVP)

## Архитектурные ограничения MVP

| # | Ограничение | Митигация / план |
|---|-------------|------------------|
| 1 | Single-node LiveKit (нет HA) | RTO ~5 минут через restart; HA — V1.1 |
| 2 | Single-region (Новосибирск) | Latency для UTC+3 ~50 мс, приемлемо; multi-region — V2 |
| 3 | Vox/GigaAM ASR — единственный, без fallback | Внешний мониторинг vox.agent-lia.ru; зависает в `transcription_processing` при простое |
| 4 | Anthropic 403 из РФ-IP | Fallback на MiniMax → OpenAI-via-proxy уже встроен (`LlmFallbackService`) |
| 5 | Selectel ru-7 — единственная S3-зона | Алерт `recordings_failed_total > 0`; ручной свитч на Yandex через ENV |
| 6 | LiveKit Egress «потрескивание» (issue #1133) | Фиксированная версия Egress, ручной WER-тест перед апдейтом |
| 7 | Длинные встречи >1ч × 10 ч-к | Vox+Claude ≤ $0.6, токен-окно 200k. Дробить на чанки в `analyze.worker` — V1.1 |
| 8 | Frontend в Safari — screen share с ограничениями | Feature-detect + сообщение «не поддерживается» |

## Технические TODO (не блокируют релиз)

Грепом по `backend/src` и `frontend/src` — TODO/FIXME/HACK комментариев **не найдено**. Если что-то добавится в ходе доработок — фиксировать сюда.

## Ограничения нагрузочного теста

`infra/loadtest/scenario-meeting.js` покрывает только HTTP-уровень (создание встречи + `/access`). Полноценный LiveKit-load (WebRTC-сессии 50 одновременных встреч × 4 участника) — отложен на V1.1, требует Playwright-harness.

## Ограничения мониторинга

- **Top expensive meetings panel** в `z-ai-pipeline.json` требует Postgres-datasource в Grafana с алиасом `postgres-z`. Если он не настроен — панель пуста. Альтернатива (Prometheus с label `meeting_id`) — кардинальность слишком высокая, отложена.
- **`bullmq_failed` метрика** ожидается от стороннего exporter'а (например, [bullmq-prometheus-exporter](https://github.com/timosalm/bullmq-prometheus-exporter)). Не входит в backend-процесс.

## Ограничения backups

- **PITR/WAL-archiving** не настроен — RPO до 24 часов. Достаточно для MVP, V1.1 — добавить wal-g или pgbackrest.
- **Тестовый restore** — раз в неделю руками на staging, автоматизация — V1.1.
