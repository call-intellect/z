---
date: 2026-06-03
tags: [logging, observability, pipelines, traceId, admin]
---

# Логирование: процессные контуры, сквозной traceId, полное покрытие, вид «Цепочка»

## Что было поставлено
Доработать систему логирования в БД:
1. покрыть логами все аспекты, КРОМЕ HTTP-запросов;
2. разбить логи на модули и процессные контуры (цепочки вызовов: встреча → S3 → транскрипция →
   AI → граф), чтобы по одному действию видеть всю цепочку (вызовы, результаты, ошибки);
3. удобный просмотр в админке (UI/UX).

## Как решал
Опирался на уже существующий `LoggingModule` (2026-06-01). Согласовал 3 решения с заказчиком:
новое поле `pipeline` + `traceId` (роль-`contour` не трогаем); полное покрытие; REQUEST убрать совсем.

- **Ф1 (инфра).** `schema.prisma`: enum `SystemLogPipeline` + `SystemLog.pipeline?` + индексы
  `[pipeline,createdAt]`/`[traceId,createdAt]`. `RequestContextService` расширен `pipeline/traceId/module`
  + `runWith` (мердж поверх текущего ALS-store). `LogService.write` обогащает из ctx.
  Ключевой ход — **`DbLoggerBridge implements LoggerService`** (`db-logger.bridge.ts`), подключён в
  `main.ts` через `bufferLogs:true` + `app.useLogger(app.get(DbLoggerBridge))`: все `this.logger.*`
  по бэкенду/воркерам автоматически дублируются в `SystemLog` (контекст логгера → `module`). Снял
  `RequestLoggingInterceptor` из `LoggingModule`. 8 юнит-тестов на разбор аргументов моста.
- **Ф2.** `log-pipeline.ts`: `traceFor*`, `deriveTraceFromJob` (берёт якорь из payload по приоритету
  meetingId→blockId→...), `withPipelineJob` (milestone start/done/failed + ALS) и инъектируемый
  `PipelineRunner` (`run`/`meeting`/`job`/`with`).
- **Ф3 (флагман).** `LivekitEventsHandler.handle` оборачивает диспетчер в pipeline-контекст
  (egress→RECORDING, иначе MEETING_LIFECYCLE) + 11 ai + 3 kc воркера. Общий `traceId=mtg_<id>`.
- **Ф4.** Ещё 34 воркера через `PipelineRunner.job` (скрипт-трансформа: import + property-injection +
  обёртка handler). Остальное покрыто мостом.
- **Ф5.** Backend: фильтры `pipeline`/`traceId`, `GET /platform/logs/chain`, `byPipeline` агрегат.
  Frontend: фильтр «Контур (процесс)», колонки Контур/Цепочка, разрез «по контурам», Drawer «Цепочка» (timeline).

## Что вышло
- backend `tsc` чисто (кроме предсуществующих `exceljs`-ошибок окружения), `eslint` 0 errors,
  `vitest src/modules/logging` 36/36. frontend `tsc`/`lint` чисто (кроме stale `.next/types`).
- 48 воркеров + webhook инструментованы; вся цепочка одной встречи видна по `mtg_<id>`.

## Чему научился / грабли
- **NestJS-логгер: воркеры массово используют pino-стиль `this.logger.debug({obj}, 'msg')`** — Nest
  трактует строку как context, а объект как message. Мост это нормализует: объект→details, строка→message.
- **Конструкторная DI первым параметром ломает позиционные `new XWorker(...)` в spec-файлах.**
  Решение — **property-injection** `@Inject(PipelineRunner) private readonly pipe!: ...`: сигнатура
  конструктора не меняется, тесты целы, а в тестах `pipe` просто undefined (handler там не вызывается).
- **Worker-спеки в этом WSL-окружении падают «Worker exited unexpectedly»** — проверил на ОРИГИНАЛЬНОМ
  файле: падает так же. Предсуществующая средовая проблема vitest-форков, не связана с правками.
- **Воркеры — один процесс с HTTP** (нет `worker:dev`/`src/workers/main.ts`, хотя CLAUDE.md так говорит):
  каждый воркер `@Injectable` с `onModuleInit→new Worker()`. Поэтому один `app.useLogger` в `main.ts`
  покрывает и HTTP, и воркеры.
- `prisma generate` достаточно для типов клиента (БД не нужна); `prisma db push` — только на проде/деве с БД.

## Долг
- Сшивка graph-воркеров с meeting-traceId (нужен проброс `sourceMeetingId` в ingest-payload).
- Специалисты 3-1..3-14 с нестандартным handler'ом — покрыты мостом, без pipeline-тега.

План: [plans/tz/2026-06-03-logging-pipelines-coverage.md](../../plans/tz/2026-06-03-logging-pipelines-coverage.md).
