"use client";

import { useState } from "react";
import { RefreshCw, ChevronDown, ChevronUp, AlertTriangle, CheckCircle2, Clock, Loader2 } from "lucide-react";

import { adminIntegrationSourcesApi } from "@/api/admin-integration-sources.api";
import {
  sourceOverviewFromApi,
  syncRunFromApi,
  type SourceOverviewItem,
  type SyncRunItem,
} from "@/domain/admin-integration-source";
import { AdminSection } from "@/ui/components/admin/AdminSection";
import { Badge } from "@/ui/shadcn/badge";
import { Button } from "@/ui/shadcn/button";
import { adminRootCrumb } from "@/ui/components/admin/brand";

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
  AdminLoading,
} from "../../AdminStateViews";
import { useAdminQuery } from "../../useAdminQuery";

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function fmtDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}мс`;
  return `${(ms / 1000).toFixed(1)}с`;
}

function HealthBadge({ status }: { status: SourceOverviewItem["healthStatus"] }) {
  if (status === "ok") return <Badge variant="success" className="gap-1"><CheckCircle2 size={12} /> OK</Badge>;
  if (status === "warn") return <Badge variant="warning" className="gap-1"><AlertTriangle size={12} /> Ошибки</Badge>;
  if (status === "error") return <Badge variant="danger" className="gap-1"><AlertTriangle size={12} /> Сбой</Badge>;
  return <Badge variant="secondary" className="gap-1"><Clock size={12} /> Нет данных</Badge>;
}

function StatsBubble({ stats, label }: { stats: SourceOverviewItem["runs24h"]["sync"]; label: string }) {
  const total = stats.success + stats.failed + stats.running + stats.skipped;
  return (
    <div className="text-xs text-fg-secondary">
      <span className="font-medium text-fg-primary">{label}:</span>{" "}
      {total === 0 ? (
        <span className="text-fg-tertiary">нет прогонов</span>
      ) : (
        <>
          {stats.success > 0 && <span className="text-success mr-1">{stats.success}✓</span>}
          {stats.failed > 0 && <span className="text-danger mr-1">{stats.failed}✗</span>}
          {stats.running > 0 && <span className="text-warning mr-1">{stats.running}↻</span>}
          {stats.skipped > 0 && <span className="text-fg-tertiary mr-1">{stats.skipped}⊘</span>}
        </>
      )}
    </div>
  );
}

function RunStatusBadge({ status }: { status: string }) {
  if (status === "success") return <Badge variant="success">success</Badge>;
  if (status === "failed") return <Badge variant="danger">failed</Badge>;
  if (status === "running") return <Badge variant="warning">running</Badge>;
  if (status === "skipped") return <Badge variant="secondary">skipped</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

function SourceRow({ item }: { item: SourceOverviewItem }) {
  const [expanded, setExpanded] = useState(false);
  const [runs, setRuns] = useState<SyncRunItem[] | null>(null);
  const [runsLoading, setRunsLoading] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const loadRuns = async (cursor?: string) => {
    setRunsLoading(true);
    try {
      const res = await adminIntegrationSourcesApi.runs({
        provider: item.provider,
        tenantId: item.tenantId,
        limit: 20,
        ...(cursor ? { cursor } : {}),
      });
      const mapped = res.items.map(syncRunFromApi);
      setRuns((prev) => (cursor ? [...(prev ?? []), ...mapped] : mapped));
      setNextCursor(res.nextCursor);
    } finally {
      setRunsLoading(false);
    }
  };

  const toggle = () => {
    if (!expanded && runs === null) {
      void loadRuns();
    }
    setExpanded((v) => !v);
  };

  const providerLabel = item.provider === "bitrix" ? "Bitrix24" : "ChatBox";
  const title = item.orgName
    ? `${item.orgName} · ${providerLabel}`
    : `${item.tenantId.slice(0, 8)}… · ${providerLabel}`;

  return (
    <div className="rounded-lg border border-border-subtle bg-surface">
      <button
        type="button"
        className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface-hover transition-colors"
        onClick={toggle}
      >
        <div className="mt-0.5 flex-shrink-0">
          <HealthBadge status={item.healthStatus} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{title}</span>
            {item.portalDomain && (
              <span className="text-xs text-fg-tertiary">{item.portalDomain}</span>
            )}
            {!item.analysisEnabled && (
              <Badge variant="outline" className="text-xs">анализ выкл</Badge>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-3">
            <StatsBubble stats={item.runs24h.sync} label="sync 24ч" />
            <StatsBubble stats={item.runs24h.analyze} label="analyze 24ч" />
          </div>
          <div className="mt-1 flex flex-wrap gap-3 text-xs text-fg-tertiary">
            {item.lastFullSyncAt && <span>full: {fmtDate(item.lastFullSyncAt)}</span>}
            {item.lastIncrementalSyncAt && <span>incr: {fmtDate(item.lastIncrementalSyncAt)}</span>}
            {item.lastRunAt && <span>прогон: {fmtDate(item.lastRunAt)}</span>}
          </div>
          {item.lastError && (
            <div className="mt-1 text-xs text-danger truncate max-w-lg">{item.lastError}</div>
          )}
        </div>
        <div className="flex-shrink-0 text-fg-tertiary mt-0.5">
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border-subtle px-4 pb-4 pt-3">
          {runsLoading && runs === null ? (
            <div className="flex items-center gap-2 text-sm text-fg-tertiary">
              <Loader2 size={14} className="animate-spin" /> Загружаем прогоны…
            </div>
          ) : runs !== null && runs.length === 0 ? (
            <p className="text-sm text-fg-tertiary">Прогонов ещё нет.</p>
          ) : (
            <>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-fg-tertiary border-b border-border-subtle">
                    <th className="pb-1 pr-3 text-left font-normal">Время</th>
                    <th className="pb-1 pr-3 text-left font-normal">Вид</th>
                    <th className="pb-1 pr-3 text-left font-normal">Статус</th>
                    <th className="pb-1 pr-3 text-left font-normal">Длит.</th>
                    <th className="pb-1 pr-3 text-left font-normal">Scope</th>
                    <th className="pb-1 text-left font-normal">Результат / Ошибка</th>
                  </tr>
                </thead>
                <tbody>
                  {(runs ?? []).map((r) => (
                    <tr key={r.id} className="border-b border-border-subtle/50 hover:bg-surface-hover">
                      <td className="py-1 pr-3 text-fg-secondary whitespace-nowrap">{fmtDate(r.startedAt)}</td>
                      <td className="py-1 pr-3">{r.kind}</td>
                      <td className="py-1 pr-3"><RunStatusBadge status={r.status} /></td>
                      <td className="py-1 pr-3 text-fg-secondary">{fmtDuration(r.durationMs)}</td>
                      <td className="py-1 pr-3 text-fg-tertiary">{r.scope ?? "—"}</td>
                      <td className="py-1 max-w-xs truncate">
                        {r.error ? (
                          <span className="text-danger">{r.error}</span>
                        ) : r.counts ? (
                          <span className="text-fg-secondary font-mono">{JSON.stringify(r.counts)}</span>
                        ) : (
                          <span className="text-fg-tertiary">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {nextCursor && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  disabled={runsLoading}
                  onClick={() => loadRuns(nextCursor)}
                >
                  {runsLoading ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
                  Ещё
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function SourcesClient() {
  const q = useAdminQuery("admin-integration-sources", async () => {
    const res = await adminIntegrationSourcesApi.overview();
    return res.map(sourceOverviewFromApi);
  });

  return (
    <AdminSection
      breadcrumbs={[
        adminRootCrumb(),
        { label: "Интеграции" },
        { label: "Состояние источников" },
      ]}
      title="Состояние источников"
      description="Bitrix24 и ChatBox по всем org: статус интеграции, последние прогоны, ошибки за 24ч."
      actions={
        <Button size="sm" variant="outline" onClick={q.refetch} disabled={q.isLoading}>
          <RefreshCw size={14} className={q.isLoading ? "animate-spin mr-1" : "mr-1"} />
          Обновить
        </Button>
      }
    >
      {q.isForbidden ? (
        <AdminForbidden />
      ) : q.isLoading ? (
        <AdminLoading rows={4} />
      ) : q.error ? (
        <AdminError message={q.error} onRetry={q.refetch} />
      ) : !q.data || q.data.length === 0 ? (
        <AdminEmpty
          title="Интеграций нет"
          description="Пока ни одна org не подключила Bitrix24 или ChatBox."
        />
      ) : (
        <div className="space-y-2">
          {q.data.map((item) => (
            <SourceRow key={`${item.tenantId}:${item.provider}`} item={item} />
          ))}
        </div>
      )}
    </AdminSection>
  );
}
