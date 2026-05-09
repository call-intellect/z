---
type: project
---

# Capacity & Infrastructure

Ориентиры по железу из финального решения. Не догма — пересчитать после первых нагрузочных тестов.

## Минимальный тестовый вариант

```
LiveKit SFU:           4 vCPU / 8 GB RAM
Egress:                4 vCPU / 8 GB RAM
Backend + DB + Redis:  4 vCPU / 8 GB RAM
```

## Public beta

```
LiveKit SFU:  8 vCPU / 16 GB RAM
Egress:       8–16 vCPU / 16–32 GB RAM
Backend:      4 vCPU / 8 GB RAM
PostgreSQL:   4 vCPU / 8–16 GB RAM
Redis:        2 vCPU / 4 GB RAM
TURN:         4 vCPU / 8 GB RAM
```

## Ориентир по 64 ядрам (2.4 GHz)

При записи + отдельных аудиодорожках:

```
безопасно:           50 одновременных встреч
рабочий ориентир:    80–100 одновременных встреч
после тестов:        120–150 одновременных встреч
рискованно:          200+
```

**Для бизнес-плана считать:** `64 ядра ≈ 100 одновременных записываемых встреч до 10 участников`.

## Стек мониторинга

Решение от 2026-05-06: **свой Prometheus + Grafana** в отдельной виртуальной машине на сервере B.

- **Prometheus** собирает метрики со всех компонентов Z по pull-модели (раз в N секунд опрашивает endpoint каждого сервиса).
- **Grafana** рисует дашборды и алерты в браузере.
- **Стандартные exporters:** LiveKit (встроено), PostgreSQL (`postgres_exporter`), Redis (`redis_exporter`), NestJS (`@willsoto/nestjs-prometheus`), Egress (встроено), node_exporter на каждой VM (CPU, RAM, диск, сеть).
- Если потом у компании появится центральный Grafana — подключаемся через Prometheus federation (объединение нескольких Prometheus в один общий вид).

## Метрики (заложить с самого начала)

Без них масштабироваться не получится.

```
active_meetings
participants_per_meeting
published_video_tracks
published_audio_tracks
screen_share_tracks
active_egress_jobs
egress_failed_jobs
cpu_livekit
cpu_egress
bandwidth_in
bandwidth_out
turn_traffic
recording_processing_time
transcription_processing_time
ai_processing_time
```

## Чего НЕ делать

Не ставить всё на один сервер в production:
```
LiveKit + Egress + Backend + PostgreSQL + Redis + Storage
```

**Почему:** запись съедает CPU → качество звонков просядет; БД будет тормозить; не получится масштабировать; невозможно искать причину инцидентов.

**Правильно — разделять:**
```
LiveKit SFU отдельно
Egress отдельно
TURN отдельно
Backend отдельно
PostgreSQL отдельно
Storage отдельно
```

[[../index|← index]]
