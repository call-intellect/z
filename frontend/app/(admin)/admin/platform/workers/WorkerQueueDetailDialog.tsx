"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { adminWorkersApi } from "@/api/admin-workers.api";
import { ApiError } from "@/api/api-error";
import {
  workerQueueDetailFromApi,
  type WorkerQueueDetailDomain,
  type WorkerJobDomain,
} from "@/domain/admin-worker";
import { Badge } from "@/ui/shadcn/badge";
import { Button } from "@/ui/shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/ui/shadcn/dialog";

type Props = {
  queueName: string | null;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onJobRemoved: () => void;
};

export function WorkerQueueDetailDialog({
  queueName,
  open,
  onOpenChange,
  onJobRemoved,
}: Props) {
  const [data, setData] = useState<WorkerQueueDetailDomain | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!queueName) return;
    setLoading(true);
    setError(null);
    try {
      const res = await adminWorkersApi.queueDetail(queueName);
      setData(workerQueueDetailFromApi(res));
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Не удалось загрузить детали очереди",
      );
    } finally {
      setLoading(false);
    }
  }, [queueName]);

  useEffect(() => {
    if (open && queueName) {
      void load();
    } else {
      setData(null);
      setError(null);
    }
  }, [open, queueName, load]);

  const handleRemove = async (job: WorkerJobDomain) => {
    if (!queueName) return;
    setRemovingId(job.id);
    try {
      await adminWorkersApi.removeJob(queueName, job.id);
      toast.success(`Job ${job.id} удалён`);
      await load();
      onJobRemoved();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Не удалось удалить job");
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Очередь: <code className="font-mono">{queueName ?? "—"}</code>
          </DialogTitle>
          <DialogDescription>
            Последние ошибочные и успешные задачи. Failed-задачи можно удалить
            индивидуально или перезапустить пакетом из таблицы очередей.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2
              size={20}
              className="animate-spin text-fg-tertiary"
              aria-hidden
            />
          </div>
        ) : null}

        {error ? (
          <p
            className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        {data ? (
          <div className="flex flex-col gap-5">
            <SummaryRow data={data} />

            <section>
              <h3 className="mb-2 text-sm font-medium text-fg-primary">
                Ошибочные задачи ({data.failedJobs.length})
              </h3>
              {data.failedJobs.length === 0 ? (
                <p className="text-xs text-fg-tertiary">
                  Сейчас нет failed-задач.
                </p>
              ) : (
                <ul className="space-y-2">
                  {data.failedJobs.map((job) => (
                    <FailedJobRow
                      key={job.id}
                      job={job}
                      removing={removingId === job.id}
                      onRemove={() => void handleRemove(job)}
                    />
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-sm font-medium text-fg-primary">
                Завершённые задачи ({data.completedJobs.length})
              </h3>
              {data.completedJobs.length === 0 ? (
                <p className="text-xs text-fg-tertiary">
                  Нет недавних completed-задач.
                </p>
              ) : (
                <ul className="space-y-1">
                  {data.completedJobs.map((job) => (
                    <CompletedJobRow key={job.id} job={job} />
                  ))}
                </ul>
              )}
            </section>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function SummaryRow({ data }: { data: WorkerQueueDetailDomain }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
      <StatBox label="Ждут" value={data.waiting} />
      <StatBox label="Активные" value={data.active} />
      <StatBox
        label="Ошибки"
        value={data.failed}
        tone={data.failed > 0 ? "danger" : undefined}
      />
      <StatBox label="Отложены" value={data.delayed} />
      <StatBox label="Готовы" value={data.completed} />
      <StatBox
        label="Состояние"
        value={data.paused ? "пауза" : "активна"}
        tone={data.paused ? "warning" : undefined}
      />
    </div>
  );
}

function StatBox({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: "danger" | "warning";
}) {
  const toneClass =
    tone === "danger"
      ? "text-danger"
      : tone === "warning"
        ? "text-warning"
        : "text-fg-primary";
  return (
    <div className="rounded-md border border-border-subtle bg-bg-overlay px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-fg-tertiary">
        {label}
      </p>
      <p className={`text-sm font-semibold tabular-nums ${toneClass}`}>
        {value}
      </p>
    </div>
  );
}

function FailedJobRow({
  job,
  removing,
  onRemove,
}: {
  job: WorkerJobDomain;
  removing: boolean;
  onRemove: () => void;
}) {
  return (
    <li className="rounded-md border border-danger/30 bg-danger/5 p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-mono text-xs font-medium text-fg-primary">
            {job.name} <span className="text-fg-tertiary">#{job.id}</span>
          </p>
          <p className="text-[11px] text-fg-tertiary">
            Попыток: {job.attemptsMade} · Завершено:{" "}
            {job.finishedOn ? job.finishedOn.toLocaleString("ru-RU") : "—"}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRemove}
          disabled={removing}
          className="text-danger hover:bg-danger/10"
          title="Удалить job"
        >
          {removing ? (
            <Loader2 size={13} className="animate-spin" aria-hidden />
          ) : (
            <Trash2 size={13} aria-hidden />
          )}
        </Button>
      </div>
      {job.failedReason ? (
        <p className="text-xs text-danger">{job.failedReason}</p>
      ) : null}
      {job.stacktrace && job.stacktrace.length > 0 ? (
        <details className="mt-1">
          <summary className="cursor-pointer text-[11px] text-fg-tertiary">
            stacktrace
          </summary>
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-bg-overlay p-2 text-[10px] text-fg-secondary">
            {job.stacktrace.join("\n")}
          </pre>
        </details>
      ) : null}
    </li>
  );
}

function CompletedJobRow({ job }: { job: WorkerJobDomain }) {
  return (
    <li className="flex items-center gap-2 rounded-md border border-border-subtle px-3 py-1.5 text-xs">
      <Badge variant="secondary" className="text-[10px]">
        ok
      </Badge>
      <code className="font-mono text-fg-primary">{job.name}</code>
      <span className="text-fg-tertiary">#{job.id}</span>
      <span className="ml-auto text-[11px] text-fg-tertiary">
        {job.finishedOn ? job.finishedOn.toLocaleString("ru-RU") : "—"}
      </span>
    </li>
  );
}
