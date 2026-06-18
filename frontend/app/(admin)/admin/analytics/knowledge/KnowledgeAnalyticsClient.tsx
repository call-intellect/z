"use client";

import { useState } from "react";
import { ArrowUpRight, BarChart3, Building2, Network } from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { adminKnowledgeAnalyticsApi } from "@/api/admin-knowledge-analytics.api";
import {
  adminKnowledgeByOrgFromApi,
  adminKnowledgeGrowthFromApi,
  adminKnowledgeOverviewFromApi,
  type AdminKnowledgeByOrgRowDomain,
} from "@/domain/admin-knowledge-analytics";
import { ADMIN_PERIOD_LABELS, type AdminPeriod } from "@/domain/admin-usage";
import { AdminSection } from "@/ui/components/admin/AdminSection";
import { AdminTabs } from "@/ui/components/admin/AdminTabs";
import { AdminCsvDownloadButton } from "@/ui/components/admin/AdminCsvDownloadButton";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/shadcn/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/shadcn/select";

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
  AdminLoading,
} from "../../AdminStateViews";
import { useAdminQuery } from "../../useAdminQuery";

const PERIODS: AdminPeriod[] = ["day", "week", "month"];

export function KnowledgeAnalyticsClient() {
  const [period, setPeriod] = useState<AdminPeriod>("week");

  return (
    <AdminSection
      title="Knowledge-Core"
      description="Граф знаний: блоки идей, сущности, темы, связи, карточки, решения, инсайты."
      actions={
        <Select
          value={period}
          onValueChange={(v) => setPeriod(v as AdminPeriod)}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIODS.map((p) => (
              <SelectItem key={p} value={p}>
                {ADMIN_PERIOD_LABELS[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    >
      <AdminTabs
        tabs={[
          { value: "overview", label: "Обзор", icon: BarChart3 },
          { value: "by-org", label: "По Org", icon: Building2 },
          { value: "growth", label: "Рост", icon: Network },
        ]}
      >
        {(tab) => (
          <>
            {tab === "overview" && <OverviewTab period={period} />}
            {tab === "by-org" && <ByOrgTab period={period} />}
            {tab === "growth" && <GrowthTab period={period} />}
          </>
        )}
      </AdminTabs>
    </AdminSection>
  );
}

function OverviewTab({ period }: { period: AdminPeriod }) {
  const q = useAdminQuery(
    `admin-knowledge-overview:${period}`,
    async () => {
      const res = await adminKnowledgeAnalyticsApi.overview({ period });
      return adminKnowledgeOverviewFromApi(res);
    },
    [period],
  );

  if (q.isLoading) return <AdminLoading rows={4} />;
  if (q.isForbidden) return <AdminForbidden />;
  if (q.error) return <AdminError message={q.error} onRetry={q.refetch} />;
  if (!q.data)
    return (
      <AdminEmpty
        title="Нет данных"
        description="Endpoint /api/v1/admin/analytics/knowledge/overview ещё не подключён."
      />
    );

  const { totals, growth7d } = q.data;
  const tiles: Array<{ label: string; value: number; growth: number }> = [
    {
      label: "Блоки идей",
      value: totals.ideaBlocks,
      growth: growth7d.ideaBlocks,
    },
    { label: "Сущности", value: totals.entities, growth: growth7d.entities },
    { label: "Темы", value: totals.themes, growth: growth7d.themes },
    { label: "Связи", value: totals.links, growth: growth7d.links },
    { label: "Карточки", value: totals.cards, growth: growth7d.cards },
    { label: "Решения", value: totals.decisions, growth: growth7d.decisions },
    { label: "Инсайты", value: totals.insights, growth: growth7d.insights },
    { label: "Идеи", value: totals.ideas, growth: growth7d.ideas },
    {
      label: "Регламенты",
      value: totals.regulations,
      growth: growth7d.regulations,
    },
    { label: "Процессы", value: totals.processes, growth: growth7d.processes },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
      {tiles.map((t) => (
        <KpiTile
          key={t.label}
          label={t.label}
          value={t.value}
          growth={t.growth}
        />
      ))}
    </div>
  );
}

function KpiTile({
  label,
  value,
  growth,
}: {
  label: string;
  value: number;
  growth: number;
}) {
  const positive = growth > 0;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-normal text-fg-tertiary">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-xl font-semibold tabular-nums">
          {value.toLocaleString("ru-RU")}
        </div>
        <div
          className={`mt-1 inline-flex items-center gap-0.5 text-[11px] tabular-nums ${
            positive
              ? "text-success"
              : growth < 0
                ? "text-warning"
                : "text-fg-tertiary"
          }`}
        >
          <ArrowUpRight size={10} />
          {growth >= 0 ? "+" : ""}
          {growth.toLocaleString("ru-RU")} за 7 дн.
        </div>
      </CardContent>
    </Card>
  );
}

function ByOrgTab({ period }: { period: AdminPeriod }) {
  const q = useAdminQuery(
    `admin-knowledge-by-org:${period}`,
    async () => {
      const res = await adminKnowledgeAnalyticsApi.byOrg({
        period,
        limit: 100,
      });
      return adminKnowledgeByOrgFromApi(res);
    },
    [period],
  );

  if (q.isLoading) return <AdminLoading rows={6} />;
  if (q.isForbidden) return <AdminForbidden />;
  if (q.error) return <AdminError message={q.error} onRetry={q.refetch} />;
  if (!q.data || q.data.items.length === 0) {
    return (
      <AdminEmpty
        title="Нет данных"
        description="Ни одна Org пока не построила граф знаний за выбранный период."
      />
    );
  }

  return <ByOrgTable items={q.data.items} period={period} />;
}

function ByOrgTable({
  items,
  period,
}: {
  items: AdminKnowledgeByOrgRowDomain[];
  period: AdminPeriod;
}) {
  const csvRows: Array<Record<string, unknown>> = items.map((r) => ({
    orgName: r.orgName,
    tenantId: r.tenantId,
    ideaBlocks: r.ideaBlocks,
    entities: r.entities,
    themes: r.themes,
    links: r.links,
    cards: r.cards,
    lastIngestAt: r.lastIngestAt ? r.lastIngestAt.toISOString() : "",
  }));

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <AdminCsvDownloadButton
          rows={csvRows}
          columns={[
            { key: "orgName", label: "Org" },
            { key: "tenantId", label: "tenantId" },
            { key: "ideaBlocks", label: "Блоки" },
            { key: "entities", label: "Сущности" },
            { key: "themes", label: "Темы" },
            { key: "links", label: "Связи" },
            { key: "cards", label: "Карточки" },
            { key: "lastIngestAt", label: "Последний ingest" },
          ]}
          filename={`admin-knowledge-by-org-${period}.csv`}
        />
      </div>
      <div className="overflow-x-auto rounded-lg border border-border-subtle">
        <table className="w-full text-sm">
          <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-fg-tertiary">
            <tr>
              <th className="px-3 py-2 text-left">Org</th>
              <th className="px-3 py-2 text-right">Блоки</th>
              <th className="px-3 py-2 text-right">Сущности</th>
              <th className="px-3 py-2 text-right">Темы</th>
              <th className="px-3 py-2 text-right">Связи</th>
              <th className="px-3 py-2 text-right">Карточки</th>
              <th className="px-3 py-2 text-left">Последний ingest</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr
                key={r.tenantId}
                className="border-t border-border-subtle hover:bg-bg-overlay"
              >
                <td className="px-3 py-2">
                  <div className="font-medium">{r.orgName}</div>
                  <div className="text-[10px] text-fg-tertiary">
                    {r.tenantId}
                  </div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {r.ideaBlocks.toLocaleString("ru-RU")}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {r.entities.toLocaleString("ru-RU")}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {r.themes.toLocaleString("ru-RU")}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {r.links.toLocaleString("ru-RU")}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {r.cards.toLocaleString("ru-RU")}
                </td>
                <td className="px-3 py-2 text-xs text-fg-tertiary">
                  {r.lastIngestAt
                    ? r.lastIngestAt.toLocaleString("ru-RU")
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GrowthTab({ period }: { period: AdminPeriod }) {
  const q = useAdminQuery(
    `admin-knowledge-growth:${period}`,
    async () => {
      const res = await adminKnowledgeAnalyticsApi.growth({ period });
      return adminKnowledgeGrowthFromApi(res);
    },
    [period],
  );

  if (q.isLoading) return <AdminLoading rows={4} />;
  if (q.isForbidden) return <AdminForbidden />;
  if (q.error) return <AdminError message={q.error} onRetry={q.refetch} />;
  if (!q.data || q.data.points.length === 0) {
    return (
      <AdminEmpty
        title="Нет данных"
        description="За выбранный период нет точек роста графа."
      />
    );
  }

  const chartData = q.data.points.map((p) => ({
    date: p.date.toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
    }),
    ideaBlocks: p.ideaBlocks,
    entities: p.entities,
    themes: p.themes,
    links: p.links,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Рост графа: блоки / темы / сущности / связи
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="date" fontSize={11} />
              <YAxis fontSize={11} />
              <Tooltip />
              <Legend />
              <Line
                type="monotone"
                dataKey="ideaBlocks"
                name="Блоки"
                stroke="#60a5fa"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="entities"
                name="Сущности"
                stroke="#34d399"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="themes"
                name="Темы"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="links"
                name="Связи"
                stroke="#a78bfa"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
