"use client";

import { ApiError } from "@/api/api-error";
import { apiClient } from "@/api/api-client";
import { Badge } from "@/ui/shadcn/badge";

import { AdminEmpty, AdminError, AdminLoading } from "../AdminStateViews";
import { useAdminQuery } from "../useAdminQuery";

type WorkerInfoApi = {
  name: string;
  alive: boolean;
  lastHeartbeatAt: string | null;
  concurrency: number;
  processedTotal: number;
  failedTotal: number;
};

type WorkersHealthApi = {
  workers: WorkerInfoApi[];
};

export function HealthWorkersTab() {
  const q = useAdminQuery(
    "admin-health-workers",
    async () => {
      try {
        return await apiClient.get<WorkersHealthApi>(
          "/api/v1/admin/health/workers",
        );
      } catch (e) {
        if (
          e instanceof ApiError &&
          (e.code === "http_404" || e.code === "not_found")
        ) {
          return null;
        }
        throw e;
      }
    },
    [],
  );

  if (q.isLoading) return <AdminLoading rows={4} />;
  if (q.error) return <AdminError message={q.error} onRetry={q.refetch} />;
  if (!q.data) {
    return (
      <AdminEmpty
        title="Раздел будет наполнен в этой же фазе"
        description="Если видишь это после деплоя — обновится при следующем релизе бэкенда."
      />
    );
  }

  if (q.data.workers.length === 0) {
    return (
      <AdminEmpty
        title="Воркеры не зарегистрированы"
        description="Запусти отдельный процесс bun run worker:dev — он зарегистрирует воркеров в BullMQ."
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs uppercase tracking-wide text-fg-tertiary">
          <tr>
            <th className="px-2 py-1 text-left">Имя</th>
            <th className="px-2 py-1 text-left">Статус</th>
            <th className="px-2 py-1 text-right">Параллелизм</th>
            <th className="px-2 py-1 text-right">Обработано</th>
            <th className="px-2 py-1 text-right">Неудач</th>
            <th className="px-2 py-1 text-right">Heartbeat</th>
          </tr>
        </thead>
        <tbody>
          {q.data.workers.map((w) => (
            <tr key={w.name} className="border-t border-border-subtle">
              <td className="px-2 py-1 font-mono text-xs">{w.name}</td>
              <td className="px-2 py-1">
                {w.alive ? (
                  <Badge variant="success">в строю</Badge>
                ) : (
                  <Badge variant="danger">не отвечает</Badge>
                )}
              </td>
              <td className="px-2 py-1 text-right tabular-nums">
                {w.concurrency}
              </td>
              <td className="px-2 py-1 text-right tabular-nums">
                {w.processedTotal.toLocaleString("ru-RU")}
              </td>
              <td
                className={`px-2 py-1 text-right tabular-nums ${
                  w.failedTotal > 0 ? "text-warning" : ""
                }`}
              >
                {w.failedTotal.toLocaleString("ru-RU")}
              </td>
              <td className="px-2 py-1 text-right text-xs text-fg-tertiary">
                {w.lastHeartbeatAt
                  ? new Date(w.lastHeartbeatAt).toLocaleString("ru-RU")
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
