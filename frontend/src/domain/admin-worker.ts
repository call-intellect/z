export type WorkerQueueApiDto = {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: boolean;
};

export type WorkerJobApiDto = {
  id: string;
  name: string;
  attemptsMade: number;
  failedReason: string | null;
  finishedOn: string | null;
  processedOn: string | null;
  timestamp: string;
  stacktrace?: string[] | null;
};

export type WorkerQueueDetailApiDto = WorkerQueueApiDto & {
  failedJobs: WorkerJobApiDto[];
  completedJobs: WorkerJobApiDto[];
};

export type WorkerQueueDomain = WorkerQueueApiDto & {
  status: "error" | "paused" | "ok";
};

export type WorkerJobDomain = {
  id: string;
  name: string;
  attemptsMade: number;
  failedReason: string | null;
  finishedOn: Date | null;
  processedOn: Date | null;
  timestamp: Date;
  stacktrace: string[] | null;
};

export type WorkerQueueDetailDomain = WorkerQueueDomain & {
  failedJobs: WorkerJobDomain[];
  completedJobs: WorkerJobDomain[];
};

function statusOf(api: WorkerQueueApiDto): WorkerQueueDomain["status"] {
  if (api.failed > 0) return "error";
  if (api.paused) return "paused";
  return "ok";
}

export function workerQueueFromApi(api: WorkerQueueApiDto): WorkerQueueDomain {
  return { ...api, status: statusOf(api) };
}

export function workerJobFromApi(api: WorkerJobApiDto): WorkerJobDomain {
  return {
    id: api.id,
    name: api.name,
    attemptsMade: api.attemptsMade,
    failedReason: api.failedReason,
    finishedOn: api.finishedOn ? new Date(api.finishedOn) : null,
    processedOn: api.processedOn ? new Date(api.processedOn) : null,
    timestamp: new Date(api.timestamp),
    stacktrace: api.stacktrace ?? null,
  };
}

export function workerQueueDetailFromApi(
  api: WorkerQueueDetailApiDto,
): WorkerQueueDetailDomain {
  return {
    ...workerQueueFromApi(api),
    failedJobs: api.failedJobs.map(workerJobFromApi),
    completedJobs: api.completedJobs.map(workerJobFromApi),
  };
}
