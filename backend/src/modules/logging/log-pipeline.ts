import { Injectable } from '@nestjs/common';

import { SystemLogCategory, SystemLogPipeline } from './log.constants';
import { LogService } from './log.service';
import { RequestContextService } from './request-context.service';

/** Re-export enum как значение — чтобы воркеры импортировали всё из одного места. */
export { SystemLogPipeline } from './log.constants';

/**
 * LoggingModule — хелперы инструментовки процессных контуров (pipelines).
 *
 * `traceFor*` строят стабильный `traceId` цепочки по якорной сущности — одно
 * действие (напр. обработка одной встречи) проходит сквозь несколько модулей
 * и джобов, но все логи объединяются общим `traceId`.
 *
 * `withPipelineJob` оборачивает работу воркера/стадии в ALS-контекст
 * (pipeline/traceId/module) и пишет milestone-логи `*.start` / `*.done` /
 * `*.failed` (category=JOB) с длительностью. Ошибку прокидывает наружу (BullMQ
 * сам решает про retry), но логирует её как ERROR.
 *
 * См. plans/tz/2026-06-03-logging-pipelines-coverage.md §Ф2.
 */

// ───────────────────────────── traceId-строители ─────────────────────────

export function traceForMeeting(meetingId: string): string {
  return `mtg_${meetingId}`;
}
export function traceForOrg(orgId: string): string {
  return `org_${orgId}`;
}
export function traceForUser(userId: string): string {
  return `user_${userId}`;
}
export function traceForDoc(documentId: string): string {
  return `doc_${documentId}`;
}
/** Универсальный: `<prefix>_<id>` (для прочих якорных сущностей). */
export function traceForEntity(prefix: string, id: string): string {
  return `${prefix}_${id}`;
}
/** Cron-запуск: `cron_<name>[_<bucket>]` (bucket — напр. YYYYMMDD). */
export function traceForCron(name: string, bucket?: string): string {
  return bucket ? `cron_${name}_${bucket}` : `cron_${name}`;
}

/**
 * Приоритетный список полей payload'а джоба → префикс traceId. Берём первое
 * присутствующее: так один traceId объединяет цепочку вокруг якорной сущности
 * (meeting/block/card/...), не зная схему конкретного воркера.
 */
const TRACE_FIELDS: Array<[string, string]> = [
  ['meetingId', 'mtg'],
  ['blockId', 'block'],
  ['rawEventId', 'raw'],
  ['entityId', 'entity'],
  ['cardId', 'card'],
  ['documentId', 'doc'],
  ['highlightId', 'hl'],
  ['probeEventId', 'probe'],
  ['reminderId', 'reminder'],
  ['cycleId', 'cycle'],
  ['goalId', 'goal'],
  ['roleId', 'role'],
  ['profileId', 'profile'],
  ['personId', 'person'],
  ['toUserId', 'user'],
  ['userId', 'user'],
  ['meetingReportId', 'report'],
  ['tableId', 'table'],
  ['issueId', 'issue'],
  ['tenantId', 'org'],
];

/** Выводит traceId из payload джоба (или из job.id как фолбэк). */
export function deriveTraceFromJob(job: {
  id?: string | number | null;
  data?: unknown;
}): string | undefined {
  const data = (job.data ?? {}) as Record<string, unknown>;
  for (const [field, prefix] of TRACE_FIELDS) {
    const v = data[field];
    if (typeof v === 'string' && v.length > 0) return `${prefix}_${v}`;
  }
  if (job.id != null) return `job_${String(job.id)}`;
  return undefined;
}

// ───────────────────────────── обёртка стадии ────────────────────────────

export interface PipelineJobMeta {
  /** Процессный контур. */
  pipeline: SystemLogPipeline;
  /** Корреляционный id цепочки (traceFor*). */
  traceId?: string;
  /** Имя стадии/воркера → поле `module` (напр. `ai.transcribe`). */
  module: string;
  /** Базовое имя действия для milestone-логов (по умолчанию = module). */
  action?: string;
  /** Доп. данные для стартового лога (ids, счётчики). */
  details?: unknown;
  /** Уровень milestone-логов start/done (по умолчанию INFO). */
  silentStart?: boolean;
}

export interface PipelineDeps {
  ctx: RequestContextService;
  logs: LogService;
}

/**
 * Запускает `fn` в ALS-контексте pipeline/traceId/module и логирует
 * start/done/failed. Возвращает результат `fn`; ошибку логирует и пробрасывает.
 */
export function withPipelineJob<T>(
  deps: PipelineDeps,
  meta: PipelineJobMeta,
  fn: () => Promise<T>,
): Promise<T> {
  const { ctx, logs } = deps;
  const action = meta.action ?? meta.module;

  return ctx.runWith(
    { pipeline: meta.pipeline, ...(meta.traceId ? { traceId: meta.traceId } : {}), module: meta.module },
    async () => {
      const startedAt = Date.now();
      if (!meta.silentStart) {
        logs.write({
          level: 'INFO',
          category: SystemLogCategory.JOB,
          action: `${action}.start`,
          message: `${meta.module}: старт`,
          ...(meta.details !== undefined ? { details: meta.details } : {}),
        });
      }
      try {
        const result = await fn();
        logs.write({
          level: 'INFO',
          category: SystemLogCategory.JOB,
          action: `${action}.done`,
          message: `${meta.module}: успех`,
          durationMs: Date.now() - startedAt,
        });
        return result;
      } catch (err) {
        logs.write({
          level: 'ERROR',
          category: SystemLogCategory.JOB,
          action: `${action}.failed`,
          message: `${meta.module}: ошибка — ${err instanceof Error ? err.message : String(err)}`,
          durationMs: Date.now() - startedAt,
          error: err,
        });
        throw err;
      }
    },
  );
}

/**
 * Лёгкий вариант: только проставить контекст (без milestone-логов). Для
 * сервисов/cron'ов, где старт/финиш логируются вручную или не нужны.
 */
export function withPipeline<T>(
  ctx: RequestContextService,
  meta: { pipeline: SystemLogPipeline; traceId?: string; module?: string },
  fn: () => T,
): T {
  return ctx.runWith(
    {
      pipeline: meta.pipeline,
      ...(meta.traceId ? { traceId: meta.traceId } : {}),
      ...(meta.module ? { module: meta.module } : {}),
    },
    fn,
  );
}

/**
 * Инъектируемая обёртка над `withPipelineJob`/`withPipeline` — чтобы воркеры
 * подключали логику цепочек одной зависимостью (`PipelineRunner`), а не парой
 * `RequestContextService` + `LogService`.
 *
 * Использование в воркере:
 * ```ts
 * this.worker = new Worker(QUEUE, (job) =>
 *   this.pipe.run(
 *     { pipeline: SystemLogPipeline.TRANSCRIPTION, module: 'ai.transcribe',
 *       traceId: traceForMeeting(job.data.meetingId) },
 *     () => this.process(job),
 *   ), opts);
 * ```
 */
@Injectable()
export class PipelineRunner {
  constructor(
    private readonly ctx: RequestContextService,
    private readonly logs: LogService,
  ) {}

  /** Полная обёртка с milestone-логами start/done/failed. */
  run<T>(meta: PipelineJobMeta, fn: () => Promise<T>): Promise<T> {
    return withPipelineJob({ ctx: this.ctx, logs: this.logs }, meta, fn);
  }

  /** Сахар для meeting-конвейера: traceId = mtg_<meetingId>. */
  meeting<T>(
    pipeline: SystemLogPipeline,
    module: string,
    meetingId: string,
    fn: () => Promise<T>,
    extra?: { action?: string; details?: unknown; silentStart?: boolean },
  ): Promise<T> {
    return this.run(
      {
        pipeline,
        module,
        traceId: traceForMeeting(meetingId),
        ...(extra?.action ? { action: extra.action } : {}),
        ...(extra?.details !== undefined ? { details: extra.details } : {}),
        ...(extra?.silentStart ? { silentStart: extra.silentStart } : {}),
      },
      fn,
    );
  }

  /** Установить контекст цепочки без milestone-логов (для сервисов/cron'ов). */
  with<T>(
    meta: { pipeline: SystemLogPipeline; traceId?: string; module?: string },
    fn: () => T,
  ): T {
    return withPipeline(this.ctx, meta, fn);
  }

  /**
   * Обёртка BullMQ-джоба: pipeline+module заданы явно, traceId выводится из
   * payload (`deriveTraceFromJob`). Пишет milestone start/done/failed.
   */
  job<T>(
    pipeline: SystemLogPipeline,
    module: string,
    job: { id?: string | number | null; data?: unknown },
    fn: () => Promise<T>,
  ): Promise<T> {
    const traceId = deriveTraceFromJob(job);
    return this.run({ pipeline, module, ...(traceId ? { traceId } : {}) }, fn);
  }
}
