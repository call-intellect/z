"use client";

import { ApiError } from "@/api/api-error";
import { apiClient } from "@/api/api-client";

import { AdminEmpty, AdminError, AdminLoading } from "../AdminStateViews";
import { useAdminQuery } from "../useAdminQuery";

type EmbeddingsHealthApi = {
  provider: string;
  model: string;
  available: boolean;
  latencyMs: number | null;
  cacheHitRate?: number;
  recentErrors?: string[];
};

export function HealthEmbeddingsTab() {
  const q = useAdminQuery(
    "admin-health-embeddings",
    async () => {
      try {
        return await apiClient.get<EmbeddingsHealthApi>(
          "/api/v1/admin/health/embeddings",
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
      <Tile title="Провайдер">{d.provider || "—"}</Tile>
      <Tile title="Модель">{d.model || "—"}</Tile>
      <Tile title="Доступность">
        {d.available ? (
          <span className="text-success">в строю</span>
        ) : (
          <span className="text-danger">недоступен</span>
        )}
      </Tile>
      <Tile title="Задержка">
        {d.latencyMs !== null ? `${d.latencyMs} мс` : "—"}
      </Tile>
      <Tile title="Попадание в кэш">
        {d.cacheHitRate !== undefined
          ? `${(d.cacheHitRate * 100).toFixed(1)}%`
          : "—"}
      </Tile>
      <Tile title="Недавние ошибки">
        {d.recentErrors && d.recentErrors.length > 0 ? (
          <ul className="space-y-0.5 text-xs">
            {d.recentErrors.slice(0, 3).map((err, i) => (
              <li key={i} className="truncate text-danger">
                {err}
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-fg-tertiary">нет</span>
        )}
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
