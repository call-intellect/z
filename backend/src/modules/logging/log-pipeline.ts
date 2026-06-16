import { Injectable } from '@nestjs/common';

import { SystemLogCategory, SystemLogPipeline } from './log.constants';
import { LogService } from './log.service';
import { RequestContextService } from './request-context.service';

export { SystemLogPipeline } from './log.constants';

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
export function traceForEntity(prefix: string, id: string): string {
  return `${prefix}_${id}`;
}
export function traceForCron(name: string, bucket?: string): string {
  return bucket ? `cron_${name}_${bucket}` : `cron_${name}`;
}

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

export function deriveTraceFromJob(job: {
  id?: string | number | null;
  data?: unknown;
}): string | undefined {
  const data = (job.data ?? {}) as Record<string, unknown>;
  if (typeof data['traceId'] === 'string' && (data['traceId'] as string).length > 0) {
    return data['traceId'] as string;
  }
  for (const [field, prefix] of TRACE_FIELDS) {
    const v = data[field];
    if (typeof v === 'string' && v.length > 0) return `${prefix}_${v}`;
  }
  if (job.id != null) return `job_${String(job.id)}`;
  return undefined;
}

export interface PipelineJobMeta {
  pipeline: SystemLogPipeline;
  traceId?: string;
  module: string;
  action?: string;
  details?: unknown;
  silentStart?: boolean;
}

export interface PipelineDeps {
  ctx: RequestContextService;
  logs: LogService;
}

export function withPipelineJob<T>(
  deps: PipelineDeps,
  meta: PipelineJobMeta,
  fn: () => Promise<T>,
): Promise<T> {
  const { ctx, logs } = deps;
  const action = meta.action ?? meta.module;

  return ctx.runWith(
    {
      pipeline: meta.pipeline,
      ...(meta.traceId ? { traceId: meta.traceId } : {}),
      module: meta.module,
    },
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

@Injectable()
export class PipelineRunner {
  constructor(
    private readonly ctx: RequestContextService,
    private readonly logs: LogService,
  ) {}

  run<T>(meta: PipelineJobMeta, fn: () => Promise<T>): Promise<T> {
    return withPipelineJob({ ctx: this.ctx, logs: this.logs }, meta, fn);
  }

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

  with<T>(
    meta: { pipeline: SystemLogPipeline; traceId?: string; module?: string },
    fn: () => T,
  ): T {
    return withPipeline(this.ctx, meta, fn);
  }

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
