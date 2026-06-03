---
date: 2026-06-03
tags: [logging, observability, traceId, knowledge-core, queues]
---

# Сшивка graph-контура в единый traceId встречи

## Что было поставлено
Граф-воркеры (block-ingest/distill/linker/entity-resolver/specialists/rollup) логировались под
своими «короткими» traceId (`block_<id>`/`raw_<id>`), не привязанными к встрече-источнику. Нужно,
чтобы в виде «Цепочка» по `mtg_<id>` были видны и граф-стадии.

## Как решал
Авто-проброс traceId через payload джобов, без ручной передачи на каждом шаге:
1. `deriveTraceFromJob` — наивысший приоритет у `data.traceId`.
2. `traceId?: string` в 10 payload-интерфейсах граф-цепочки (`core-queue/queues.ts`).
3. `CoreQueueService` инжектит `@Optional() RequestContextService` + приватный `stamp()`, который
   вкладывает `ctx.traceId` в payload при enqueue (если его ещё нет); все `q.add` идут через `stamp`.

Точка входа не потребовала кода: `analyze.worker` (уже инструментован, контекст `mtg_<id>`) зовёт
`ingestMeeting` прямым await внутри `Promise.allSettled` в `process()` → `enqueueRawReceived` стампит
`mtg_`. Дальше каждый граф-воркер наследует trace из payload (через `deriveTraceFromJob`) и при
дальнейшем enqueue ре-стампит — цепочка протекает сама.

## Что вышло
- `tsc`/`lint` чисто; logging-юниты 42/42 (+6 на `deriveTraceFromJob`).
- Граф-стадии встречи теперь под общим `mtg_<id>` (рантайм-проверка — на проде прогоном встречи).

## Чему научился
- **AsyncLocalStorage пробрасывается через `Promise.allSettled`/await** — поэтому `ingestMeeting`,
  вызванный внутри обёрнутого `process()`, видит `ctx.traceId`. Контекст теряется только при пересечении
  процессов/очередей — что и закрывает авто-стамп в payload.
- **Один choke-point (`stamp` в `CoreQueueService`) пробрасывает trace по всей цепочке** — потому что
  каждый воркер становится в контекст из payload и ре-стампит при следующем enqueue. Не нужно трогать
  каждый продюсер.
- AI-очереди отдельно стампить не нужно — `meetingId` в payload уже даёт `mtg_`.

План: [plans/tz/2026-06-03-logging-trace-stitch-graph.md](../../plans/tz/2026-06-03-logging-trace-stitch-graph.md).
