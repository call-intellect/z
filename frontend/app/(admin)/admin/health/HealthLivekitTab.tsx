"use client";

import { ApiError } from "@/api/api-error";
import { apiClient } from "@/api/api-client";
import { Badge } from "@/ui/shadcn/badge";

import { AdminEmpty, AdminError, AdminLoading } from "../AdminStateViews";
import { useAdminQuery } from "../useAdminQuery";

type LivekitHealthApi = {
  sfuUrl: string;
  egressUrl?: string;
  available: boolean;
  activeRooms: number;
  activeParticipants: number;
  latencyMs: number | null;
};

export function HealthLivekitTab() {
  const q = useAdminQuery(
    "admin-health-livekit",
    async () => {
      try {
        return await apiClient.get<LivekitHealthApi>(
          "/api/v1/admin/health/livekit",
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

  if (q.isLoading) return <AdminLoading rows={3} />;
  if (q.error) return <AdminError message={q.error} onRetry={q.refetch} />;
  if (!q.data) {
    return (
      <AdminEmpty
        title="Раздел будет наполнен в этой же фазе"
        description="Если видишь это после деплоя — обновится при следующем релизе бэкенда."
      />
    );
  }

  const d = q.data;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Tile title="SFU">
        <span className="font-mono text-xs">{d.sfuUrl || "—"}</span>
      </Tile>
      <Tile title="Egress">
        <span className="font-mono text-xs">{d.egressUrl || "—"}</span>
      </Tile>
      <Tile title="Доступность">
        {d.available ? (
          <Badge variant="success">в строю</Badge>
        ) : (
          <Badge variant="danger">недоступен</Badge>
        )}
      </Tile>
      <Tile title="Активных встреч">
        <span className="tabular-nums">
          {d.activeRooms.toLocaleString("ru-RU")}
        </span>
      </Tile>
      <Tile title="Активных участников">
        <span className="tabular-nums">
          {d.activeParticipants.toLocaleString("ru-RU")}
        </span>
      </Tile>
      <Tile title="Задержка">
        {d.latencyMs !== null ? `${d.latencyMs} мс` : "—"}
      </Tile>
    </div>
  );
}

function Tile({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border-subtle bg-bg-card p-4">
      <div className="mb-1 text-xs uppercase tracking-wide text-fg-tertiary">
        {title}
      </div>
      <div className="text-base font-medium">{children}</div>
    </div>
  );
}
