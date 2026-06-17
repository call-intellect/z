---
type: tz
status: deferred-stub
feature: knowledge-core-queue-dlq
date: 2026-06-17
owner: владелец (Сергей, sergrv80@gmail.com)
relates_to:
  - plans/tz/2026-06-16-knowledge-core-MASTER.md   # пробел G5
  - backend/src/modules/core-queue/queues.ts
---

# ТЗ-заглушка — конфиг очередей: DLQ + per-queue override (пробел G5)

> **Статус: осознанная отсрочка (vNext).** Это НЕ баг-фикс, а enhancement
> надёжности очередей. Острые проблемы класса уже закрыты в волнах аудита
> (Б32 — умножение ретраев meeting-report-fast; Б33 — removeOnComplete count
> 1000→20000, дедуп по jobId держится 24ч). Запуск реализации — по явному
> «начни реализацию» владельца. Строка-указатель — в `second-brain/04_не-сделано/README.md`.

## Что вскрыто (верификация G5, 2026-06-17)
`CORE_DEFAULT_JOB_OPTIONS` (`backend/src/modules/core-queue/queues.ts`) применяется
ОДИН на все ~25 очередей `core.*`: `attempts:5`, `backoff:exp 5s`,
`removeOnComplete:{age:24h, count:20000}`, `removeOnFail:false`.

Подтверждено по коду (severity MED, latent at scale):
- **Нет DLQ (dead-letter queue).** `removeOnFail:false` оставляет failed-job в
  Redis для разбора, но нет автоматического отвода исчерпавших attempts в
  отдельную очередь/таблицу + алерта владельцу. На нагруженной очереди failed
  копятся в Redis без операционной видимости.
- **Нет per-queue override.** Идемпотентным воркерам (distill, entity-resolver,
  goal-embed) можно больше attempts; дорогим LLM-цепочкам (specialist-routing,
  meeting-report-fast) — меньше + circuit-breaker. Сейчас всем одинаково.
- **Нет дифференцированного backoff** по типу нагрузки.

НЕ баг (опровергнуто): потери failed-job нет (`removeOnFail:false`); дедуп по
jobId держится 24ч после Б33; острое умножение ретраев снято Б32.

## Scope (когда возьмём)
1. `QUEUE_CONFIG: Record<CoreQueueName, JobsOptions>` поверх дефолта — per-queue
   attempts/backoff/removeOnFail.
2. DLQ-механизм: воркер на `failed`-событие → запись в `core.dead-letter`
   (очередь ИЛИ таблица `DeadLetterJob`) + метрика `core_dead_letter_total{queue}`
   + алерт владельцу при росте (как reopen-rate-алерт в task-reconcile, Ф3).
3. Circuit-breaker для LLM-очередей (negative-cache при деградации провайдера —
   паттерн уже есть в Б54 router fallback).
4. Админ-видимость DLQ (кнопка «повторить»/«отбросить») — опц., vNext+1.

## Acceptance (когда возьмём)
- per-queue override применяется (тест: критичная очередь имеет свои attempts);
- исчерпавший attempts job → в DLQ + метрика + алерт; идемпотентно;
- `bun run typecheck && build`; новые модели (если DLQ-таблица) — версионируемая
  миграция; новая очередь/cron — smoke `prod-deploy-log.md` Шаг 12.

## Почему отложено
Полноценный DLQ + per-queue + circuit-breaker — самостоятельная фича уровня
инфраструктуры очередей с прод-последствиями (новая очередь/таблица, алерты,
админ-UI). Острые риски класса уже закрыты (Б32/Б33). Делать big-bang в рамках
аудит-волн непропорционально; выносим отдельным ТЗ под явный запуск владельца.
