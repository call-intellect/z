"use client";

import Link from "next/link";
import { ArrowLeft, ExternalLink, FlaskConical, Settings } from "lucide-react";

import { adminFunctionsApi } from "@/api/admin-experiments.api";
import { adminLlmCostApi } from "@/api/admin-llm-cost.api";
import { adminUsageApi } from "@/api/admin-usage.api";
import {
  adminCallsLogFromApi,
  formatDurationMs,
  formatUsd,
} from "@/domain/admin-usage";
import {
  adminFunctionDetailFromApi,
  taskTypeLabel,
} from "@/domain/admin-experiment";
import { formatRub, llmCostTaskTypeDetailFromApi } from "@/domain/admin-llm-cost";
import { AdminSection } from "@/ui/components/admin/AdminSection";
import { AdminCsvDownloadButton } from "@/ui/components/admin/AdminCsvDownloadButton";
import { Badge } from "@/ui/shadcn/badge";
import { Button } from "@/ui/shadcn/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/shadcn/card";

import {
  AdminError,
  AdminForbidden,
  AdminLoading,
  AdminLoadingInline,
} from "../../../AdminStateViews";
import { useAdminQuery } from "../../../useAdminQuery";

export function FunctionDetailAnalyticsClient({
  taskType,
}: {
  taskType: string;
}) {
  const detailQ = useAdminQuery(
    `admin-analytics-fn:${taskType}`,
    async () => {
      const res = await adminFunctionsApi.detail(taskType);
      return adminFunctionDetailFromApi(res);
    },
    [taskType],
  );

  const callsQ = useAdminQuery(
    `admin-analytics-fn-calls:${taskType}`,
    async () => {
      const res = await adminUsageApi.getFunctionCalls(taskType, { limit: 10 });
      return adminCallsLogFromApi({ items: res.items, nextCursor: null });
    },
    [taskType],
  );

  const costQ = useAdminQuery(
    `admin-analytics-fn-cost:${taskType}`,
    async () =>
      llmCostTaskTypeDetailFromApi(
        await adminLlmCostApi.taskTypeDetail(taskType, {
          period: "30d",
          trend: "day",
        }),
      ),
    [taskType],
  );

  const costHref = costQ.data
    ? `/admin/analytics/llm-cost?view=module&id=${encodeURIComponent(costQ.data.module)}&period=30d`
    : "/admin/analytics/llm-cost?view=module";

  const callsRows: Array<Record<string, unknown>> = (
    callsQ.data?.items ?? []
  ).map((c) => ({
    createdAt: c.createdAt.toISOString(),
    model: `${c.provider}:${c.model}`,
    inputTokens: c.inputTokens,
    outputTokens: c.outputTokens,
    costUsd: c.costUsd.toFixed(6),
    durationMs: c.durationMs,
    success: c.success ? "ok" : "fail",
  }));

  return (
    <AdminSection
      breadcrumbs={[
        { label: "Аналитика" },
        { label: "Функции LLM", href: "/admin/analytics/functions" },
        { label: taskTypeLabel(taskType) },
      ]}
      title={taskTypeLabel(taskType)}
      description={taskType}
      actions={
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin/analytics/functions">
            <ArrowLeft size={14} /> К списку
          </Link>
        </Button>
      }
    >
      <div className="space-y-6">
        {detailQ.isLoading && <AdminLoading rows={4} />}
        {!detailQ.isLoading && detailQ.isForbidden && <AdminForbidden />}
        {!detailQ.isLoading && detailQ.error && (
          <AdminError message={detailQ.error} onRetry={detailQ.refetch} />
        )}

        {!detailQ.isLoading && detailQ.data && (
          <>
            {detailQ.data.experiment && (
              <Card className="border-accent/40 bg-accent-muted/20">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <FlaskConical size={16} className="text-accent-fg" />
                    Активный A/B-эксперимент
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div>
                    Model A:{" "}
                    <code className="font-mono">
                      {detailQ.data.experiment.modelA}
                    </code>
                  </div>
                  <div>
                    Model B:{" "}
                    <code className="font-mono">
                      {detailQ.data.experiment.modelB}
                    </code>
                  </div>
                  <div>
                    Split: {detailQ.data.experiment.splitPercent}% /{" "}
                    {100 - detailQ.data.experiment.splitPercent}%
                  </div>
                  <Button asChild size="sm" variant="outline" className="mt-2">
                    <Link
                      href={`/admin/ai/routing/${encodeURIComponent(taskType)}?tab=experiment`}
                    >
                      Перейти к эксперименту
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-base">
                    Текущая цепочка моделей
                  </CardTitle>
                  <Badge variant={detailQ.data.isActive ? "secondary" : "danger"}>
                    {detailQ.data.isActive ? "активна" : "выключена"}
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-3">
                  <ul className="space-y-1">
                    {detailQ.data.providers.length === 0 && (
                      <li className="rounded-md border border-dashed border-border-subtle p-3 text-center text-xs text-fg-tertiary">
                        Цепочка не настроена.
                      </li>
                    )}
                    {detailQ.data.providers.map((p, idx) => (
                      <li
                        key={`${p.provider}-${idx}`}
                        className="flex items-center gap-2 rounded-md border border-border-subtle bg-bg-card p-2 text-sm"
                      >
                        <Badge variant="secondary" className="text-[10px]">
                          #{idx + 1}
                        </Badge>
                        <span className="font-mono text-xs">{p.provider}</span>
                        {p.model && (
                          <span className="text-[11px] text-fg-tertiary">
                            model: {p.model}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/admin/ai/routing/${encodeURIComponent(taskType)}`}>
                      <Settings size={14} /> Настроить модель для этой операции
                    </Link>
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Расход за 30 дней</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {costQ.isLoading && <AdminLoadingInline />}
                  {!costQ.isLoading && costQ.error && (
                    <p className="text-xs text-fg-tertiary">
                      Не удалось загрузить расход.
                    </p>
                  )}
                  {!costQ.isLoading && costQ.data && (
                    <div className="text-2xl font-semibold leading-none tracking-tight">
                      {formatRub(costQ.data.totals.costRub)}
                    </div>
                  )}
                  <Button asChild variant="outline" size="sm">
                    <Link href={costHref}>
                      <ExternalLink size={14} /> Смотреть расход этой операции
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">
                  Последние 10 вызовов
                </CardTitle>
                <AdminCsvDownloadButton
                  rows={callsRows}
                  columns={[
                    { key: "createdAt", label: "Когда" },
                    { key: "model", label: "Модель" },
                    { key: "inputTokens", label: "In tokens" },
                    { key: "outputTokens", label: "Out tokens" },
                    { key: "costUsd", label: "Cost, USD" },
                    { key: "durationMs", label: "Latency, ms" },
                    { key: "success", label: "Статус" },
                  ]}
                  filename={`admin-fn-calls-${taskType}.csv`}
                />
              </CardHeader>
              <CardContent>
                {callsQ.isLoading ? (
                  <AdminLoadingInline />
                ) : callsQ.data && callsQ.data.items.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-fg-tertiary">
                        <tr>
                          <th className="px-2 py-1 text-left">Когда</th>
                          <th className="px-2 py-1 text-left">Модель</th>
                          <th className="px-2 py-1 text-right">In/Out</th>
                          <th className="px-2 py-1 text-right">Cost</th>
                          <th className="px-2 py-1 text-right">Latency</th>
                          <th className="px-2 py-1 text-left">Статус</th>
                          <th className="px-2 py-1"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {callsQ.data.items.map((c) => (
                          <tr
                            key={c.id}
                            className="border-t border-border-subtle"
                          >
                            <td className="px-2 py-1 text-fg-tertiary">
                              {c.createdAt.toLocaleString("ru-RU")}
                            </td>
                            <td className="px-2 py-1 font-mono">
                              {c.provider}:{c.model}
                            </td>
                            <td className="px-2 py-1 text-right tabular-nums">
                              {c.inputTokens}/{c.outputTokens}
                            </td>
                            <td className="px-2 py-1 text-right tabular-nums">
                              {formatUsd(c.costUsd)}
                            </td>
                            <td className="px-2 py-1 text-right tabular-nums">
                              {formatDurationMs(c.durationMs)}
                            </td>
                            <td className="px-2 py-1">
                              {c.success ? (
                                <Badge variant="secondary">ok</Badge>
                              ) : (
                                <Badge variant="danger">fail</Badge>
                              )}
                            </td>
                            <td className="px-2 py-1 text-right">
                              <Link
                                href={`/admin/usage/functions/${encodeURIComponent(taskType)}/calls/${encodeURIComponent(c.id)}`}
                                className="text-accent hover:underline"
                              >
                                открыть
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-fg-tertiary">
                    За последнее время вызовов нет.
                  </p>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AdminSection>
  );
}
