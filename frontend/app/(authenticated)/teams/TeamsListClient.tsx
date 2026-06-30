"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Loader2,
  Minus,
  RefreshCcw,
  Users,
} from "lucide-react";

import { ApiError, humanizeApiError } from "@/api/api-error";
import { dashboardApi } from "@/api/dashboard.api";
import { useAuth } from "@/contexts/auth-context";
import {
  teamHealthFromApi,
  type HealthToneDomain,
  type TeamHealthAttrDomain,
  type TeamHealthDomain,
  type TeamHealthRowDomain,
} from "@/domain/team-health";
import { Button } from "@/ui/shadcn/button";
import { Skeleton } from "@/ui/shadcn/skeleton";
import { cn } from "@/ui/shadcn/lib/utils";

type SortKey =
  | "name"
  | "size"
  | "sentiment"
  | "promises"
  | "conflicts"
  | "overall";

type SortDir = "asc" | "desc";

const TONE_CHIP: Record<HealthToneDomain, string> = {
  success: "bg-chip-success-bg text-chip-success-fg",
  warning: "bg-chip-warning-bg text-chip-warning-fg",
  danger: "bg-chip-danger-bg text-chip-danger-fg",
  neutral: "bg-bg-overlay text-fg-tertiary",
};

const TONE_RANK: Record<HealthToneDomain, number> = {
  success: 3,
  warning: 2,
  danger: 1,
  neutral: 0,
};

export function TeamsListClient() {
  const { currentOrgId } = useAuth();
  const [data, setData] = useState<TeamHealthDomain | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("overall");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const load = useCallback(async () => {
    if (!currentOrgId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await dashboardApi.getTeamHealth(currentOrgId);
      setData(teamHealthFromApi(res));
    } catch (e) {
      setError(humanizeApiError(e, "Не удалось загрузить команды"));
    } finally {
      setLoading(false);
    }
  }, [currentOrgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const sortedTeams = useMemo(() => {
    if (!data) return [];
    const arr = [...data.teams];
    const sign = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      const ka = keyValue(a, sortKey);
      const kb = keyValue(b, sortKey);
      if (ka === kb) return a.departmentName.localeCompare(b.departmentName);
      return ka < kb ? -1 * sign : sign;
    });
    return arr;
  }, [data, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6 md:py-8">
      <header className="sticky top-0 z-10 -mx-4 mb-6 flex flex-col gap-2 border-b border-border-subtle bg-bg-base/72 px-4 py-4 backdrop-blur-glass md:-mx-6 md:flex-row md:items-center md:justify-between md:px-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-fg-primary">
            <Users size={22} className="text-accent" />
            Команды
          </h1>
          <p className="mt-1 text-sm text-fg-secondary">
            Здоровье отделов в одном экране. Кликните по команде для деталей.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <RefreshCcw size={14} />
          )}
          <span className="ml-1.5">Обновить</span>
        </Button>
      </header>

      {error && (
        <div className="mb-4 rounded-xl bg-chip-danger-bg p-3 text-sm text-chip-danger-fg shadow-card-soft">
          {error}
        </div>
      )}

      {loading && <TableSkeleton />}

      {!loading && data && data.teams.length === 0 && (
        <div className="rounded-xl bg-bg-card p-8 text-center shadow-card-soft">
          <p className="text-base text-fg-primary">Пока нет отделов</p>
          <p className="mt-2 text-sm text-fg-secondary">
            Создайте отделы — здоровье команд будет считаться автоматически.
          </p>
          <Link
            href="/departments"
            className="mt-4 inline-block text-sm text-accent underline-offset-2 hover:underline"
          >
            Перейти в настройки отделов →
          </Link>
        </div>
      )}

      {!loading && data && data.teams.length > 0 && (
        <div className="overflow-hidden rounded-xl bg-bg-card shadow-card-soft">
          <table className="w-full">
            <thead className="border-b border-border-subtle text-[11px] uppercase tracking-wide text-fg-tertiary">
              <tr>
                <SortHeader
                  label="Команда"
                  thisKey="name"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onClick={toggleSort}
                  align="left"
                />
                <SortHeader
                  label="Размер"
                  thisKey="size"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onClick={toggleSort}
                  align="center"
                />
                <SortHeader
                  label="Настроение"
                  thisKey="sentiment"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onClick={toggleSort}
                  align="center"
                />
                <SortHeader
                  label="Обещания"
                  thisKey="promises"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onClick={toggleSort}
                  align="center"
                />
                <SortHeader
                  label="Конфликты"
                  thisKey="conflicts"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onClick={toggleSort}
                  align="center"
                />
                <SortHeader
                  label="Общее"
                  thisKey="overall"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onClick={toggleSort}
                  align="center"
                />
              </tr>
            </thead>
            <tbody>
              {sortedTeams.map((row) => (
                <TeamRow key={row.departmentId} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SortHeader({
  label,
  thisKey,
  sortKey,
  sortDir,
  onClick,
  align,
}: {
  label: string;
  thisKey: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onClick: (k: SortKey) => void;
  align: "left" | "center";
}) {
  const active = sortKey === thisKey;
  const Icon = active
    ? sortDir === "asc"
      ? ArrowUpRight
      : ArrowDownRight
    : null;
  return (
    <th
      className={cn(
        "cursor-pointer px-3 py-3 font-medium hover:text-fg-secondary",
        align === "left" ? "text-left" : "text-center",
        active && "text-accent",
      )}
      onClick={() => onClick(thisKey)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {Icon && <Icon size={11} />}
      </span>
    </th>
  );
}

function TeamRow({ row }: { row: TeamHealthRowDomain }) {
  if (row.belowCohort) {
    return (
      <tr className="border-t border-border-subtle/60 text-fg-tertiary">
        <td className="px-3 py-3">
          <Link
            href={`/teams/${encodeURIComponent(row.departmentId)}`}
            className="block"
          >
            <div className="font-medium text-fg-secondary">
              {row.departmentName}
            </div>
            <div className="text-[11px]">{row.size} чел. · нужно ≥3</div>
          </Link>
        </td>
        <td className="px-3 py-3 text-center text-xs">{row.size}</td>
        <td colSpan={4} className="px-3 py-3 text-center text-xs">
          Слишком маленький отдел
        </td>
      </tr>
    );
  }
  return (
    <tr className="border-t border-border-subtle/60 hover:bg-bg-overlay/40">
      <td className="px-3 py-3">
        <Link
          href={`/teams/${encodeURIComponent(row.departmentId)}`}
          className="block"
        >
          <div className="font-medium text-fg-primary">
            {row.departmentName}
          </div>
        </Link>
      </td>
      <td className="px-3 py-3 text-center text-sm text-fg-secondary">
        {row.size}
      </td>
      <td className="px-3 py-3 text-center">
        <AttrChip attr={row.sentiment} formatter={formatSigned} />
      </td>
      <td className="px-3 py-3 text-center">
        <AttrChip attr={row.promises} formatter={(v) => `${v}%`} />
      </td>
      <td className="px-3 py-3 text-center">
        <AttrChip attr={row.conflicts} formatter={(v) => String(v)} />
      </td>
      <td className="px-3 py-3 text-center">
        <OverallChip row={row} />
      </td>
    </tr>
  );
}

function AttrChip({
  attr,
  formatter,
}: {
  attr: TeamHealthAttrDomain;
  formatter: (v: number) => string;
}) {
  const TrendIcon =
    attr.trend === "up"
      ? ArrowUpRight
      : attr.trend === "down"
        ? ArrowDownRight
        : attr.trend === "flat"
          ? Minus
          : null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
        TONE_CHIP[attr.tone],
      )}
    >
      {formatter(attr.value)}
      {TrendIcon && <TrendIcon size={12} />}
    </span>
  );
}

function OverallChip({ row }: { row: TeamHealthRowDomain }) {
  const tones: HealthToneDomain[] = [
    row.sentiment.tone,
    row.promises.tone,
    row.conflicts.tone,
  ];
  const counts = { success: 0, warning: 0, danger: 0, neutral: 0 };
  for (const t of tones) counts[t]++;
  const overall: HealthToneDomain =
    counts.danger >= 2
      ? "danger"
      : counts.danger >= 1 || counts.warning >= 2
        ? "warning"
        : "success";
  const label =
    overall === "success"
      ? "хорошо"
      : overall === "warning"
        ? "внимание"
        : "критично";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium",
        TONE_CHIP[overall],
      )}
    >
      {label}
    </span>
  );
}

function formatSigned(v: number): string {
  if (v > 0) return `+${v}`;
  return String(v);
}

function keyValue(row: TeamHealthRowDomain, key: SortKey): number | string {
  switch (key) {
    case "name":
      return row.departmentName;
    case "size":
      return row.size;
    case "sentiment":
      return -TONE_RANK[row.sentiment.tone] * 1000 - row.sentiment.value;
    case "promises":
      return -TONE_RANK[row.promises.tone] * 1000 - row.promises.value;
    case "conflicts":
      return TONE_RANK[row.conflicts.tone] * 1000 + row.conflicts.value;
    case "overall": {
      const tones = [
        row.sentiment.tone,
        row.promises.tone,
        row.conflicts.tone,
      ];
      const score = tones.reduce((acc, t) => acc + TONE_RANK[t], 0);
      return -score;
    }
  }
}

function TableSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-2/3" />
    </div>
  );
}
