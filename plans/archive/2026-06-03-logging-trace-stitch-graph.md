# ТЗ: Сшивка graph-контура в единый traceId встречи (mtg_<id>)

Дата: 2026-06-03. Ветка: `logExt`.
Продолжение: [2026-06-03-logging-pipelines-coverage.md](2026-06-03-logging-pipelines-coverage.md) (раздел «Остаётся / долг»).

## Проблема
Цепочка встречи (`MEETING_LIFECYCLE → RECORDING → TRANSCRIPTION → AI_ANALYSIS`) уже объединена
общим `traceId = mtg_<meetingId>` — потому что у всех этих джобов `meetingId` в payload, и
`deriveTraceFromJob` строит `mtg_<id>`.

Граф-контур (`KNOWLEDGE_GRAPH`) — НЕ сшит со встречей: джобы оперируют `rawEventId`/`blockId`/
`entityId`/`cardId`, у которых нет `meetingId`. Поэтому их логи получают traceId вида
`raw_<id>`/`block_<id>` — отдельные «короткие» цепочки, не привязанные к встрече-источнику.
`RawEvent` тоже не хранит `meetingId` напрямую (связь через `sourceId`/payload), поэтому
lookup неудобен.

## Идея решения
**Авто-проброс `traceId` через payload джобов.** Продюсер первого джоба граф-цепочки уже работает
в контексте `mtg_<id>` (встречу анализирует инструментованный воркер). Если каждый enqueue
автоматически вкладывает текущий `ctx.traceId` в payload, а воркер-потомок берёт его как свой trace
(и при дальнейших enqueue ре-стампит) — trace встречи протекает по всей граф-цепочке без ручной
передачи на каждом шаге.

Ключевые элементы:
1. `deriveTraceFromJob` — **наивысший приоритет у `data.traceId`** (если строка непустая, берём как есть).
2. `CoreQueueService` (и при необходимости `AiQueueService`) — при enqueue **авто-стампит**
   `payload.traceId = ctx.traceId`, если в контексте есть trace и в payload его ещё нет.
3. Payload-интерфейсы граф-цепочки получают опциональное поле `traceId?: string`.

AI-цепочка уже сшита (везде `meetingId`) — её не трогаем; авто-стамп лишь подстрахует.

## Фазы

### Ф1. Механизм (приоритет + авто-стамп)
- [ ] `log-pipeline.ts` `deriveTraceFromJob`: первым проверять `data.traceId` (string, non-empty) → вернуть как есть.
- [ ] `queues.ts`: добавить `traceId?: string` в payload-интерфейсы граф-цепочки
  (`RawEventJobData`, `BlockDistillJobData`, `BlockLinkerJobData`, `EntityResolverJobData`,
  `CardRollupV2JobData`, `SpecialistRoutingJobData`, `RebuildKnowledgeProfileJobData`,
  `RebuildSkillProfileJobData`, `IdeaClustererJobData`, `SprintHelperJobData` и др. по факту).
- [ ] `CoreQueueService`: инжектнуть `RequestContextService` (`@Optional`), приватный
  `stamp(payload)` — мерджит `traceId` из ctx, если отсутствует; провести все `q.add(...)` через него.
- [ ] Сборка: `tsc` + `lint` + юнит на `deriveTraceFromJob` (приоритет data.traceId).

### Ф2. Точка входа (meeting → raw-events)
- [ ] Убедиться, что путь создания `RawEvent` из встречи (`ingest` ← `meeting.adapter`) исполняется
  в `mtg_`-контексте; если нет — обернуть вызов в `pipe.with({ pipeline: KNOWLEDGE_GRAPH, traceId: mtg_<id> })`.
- [ ] Проверить распространение: block-ingest → distill → linker → entity-resolver → specialists →
  card-rollup получают `mtg_` (через ctx + ре-стамп при enqueue).

### Ф3. Верификация
- [ ] Прогон одной встречи → в админке `/admin/logs` по `mtg_<id>` видна цепочка ВКЛЮЧАЯ граф-стадии.
- [ ] backend `tsc`/`lint` чисто; logging-юниты зелёные.
- [ ] Обновить second-brain (`logging.md`, при необходимости `knowledge-core.md`) + рефлексия.

## Итог
**Реализовано.**
- **Ф1.** `deriveTraceFromJob` — приоритет `data.traceId`. `traceId?: string` добавлен в 10 payload-интерфейсов
  граф-цепочки (`queues.ts`). `CoreQueueService` инжектит `@Optional() RequestContextService` + приватный
  `stamp()` (мерджит `ctx.traceId` в payload, если его ещё нет); все `q.add(...)` проведены через `stamp`.
- **Ф2.** Доп. кода не потребовалось: `analyze.worker` (уже инструментован, контекст `mtg_<id>`) вызывает
  `ingestMeeting` прямым await внутри `Promise.allSettled` в `process()`. Значит `enqueueRawReceived` стампит
  `mtg_`, block-ingest наследует его (через `deriveTraceFromJob` по `data.traceId`) и при `enqueueBlockDistill`/
  `enqueueBlockLinker`/... ре-стампит — trace встречи протекает по всей граф-цепочке автоматически.
- **Ф3.** `tsc`/`lint` чисто; logging-юниты **42/42** (+6 на `deriveTraceFromJob`). Рантайм-смоук — на проде
  (прогон встречи → в `/admin/logs` по `mtg_<id>` видны и AI_ANALYSIS, и KNOWLEDGE_GRAPH стадии).

Замечание: AI-очереди (`AiQueueService`) не стампятся отдельно — у них `meetingId` в payload, `mtg_` строится
напрямую. Манульные ingest'ы (HTTP/reprocess) идут без `mtg_` (нет контекста) — это ожидаемо.

## Прод-операции
- Схему БД не меняет. Только rebuild backend.
