"use client";

import { useState } from "react";
import Link from "next/link";
import { Download, Search } from "lucide-react";

import { adminUsageApi } from "@/api/admin-usage.api";
import {
  ADMIN_PERIOD_LABELS,
  adminUsersUsageFromApi,
  formatUsd,
  type AdminPeriod,
} from "@/domain/admin-usage";
import { Button } from "@/ui/shadcn/button";
import { Input } from "@/ui/shadcn/input";
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

export function UsersUsageClient() {
  const [period, setPeriod] = useState<AdminPeriod>("week");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  const q = useAdminQuery(
    `admin-users:${period}:${search}`,
    async () => {
      const res = await adminUsageApi.getUsers({
        period,
        ...(search ? { search } : {}),
        limit: 100,
      });
      return adminUsersUsageFromApi(res);
    },
    [period, search],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Пользователи</h1>
          <p className="text-sm text-fg-tertiary">
            Аналитика расхода LLM по пользователям всех Org.
          </p>
        </div>
        <div className="flex items-center gap-2">
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
          <Button asChild variant="outline" size="sm">
            <a
              href={adminUsageApi.exportCsvUrl({ period, kind: "users" })}
              target="_blank"
              rel="noreferrer"
            >
              <Download size={14} /> CSV
            </a>
          </Button>
        </div>
      </div>

      <form
        className="flex max-w-md items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(searchInput.trim());
        }}
      >
        <Input
          placeholder="email или имя"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <Button type="submit" size="sm" variant="secondary">
          <Search size={14} /> Найти
        </Button>
      </form>

      {q.isLoading && <AdminLoading rows={6} />}
      {!q.isLoading && q.isForbidden && <AdminForbidden />}
      {!q.isLoading && q.error && (
        <AdminError message={q.error} onRetry={q.refetch} />
      )}
      {!q.isLoading &&
        !q.isForbidden &&
        !q.error &&
        q.data &&
        (q.data.items.length === 0 ? (
          <AdminEmpty
            title="Пусто"
            description="За выбранный период никто не делал LLM-вызовов."
          />
        ) : (
          <>
            {}
            <div className="hidden overflow-x-auto rounded-lg border border-border-subtle md:block">
              <table className="w-full text-sm">
                <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-fg-tertiary">
                  <tr>
                    <th className="px-3 py-2 text-left">Пользователь</th>
                    <th className="px-3 py-2 text-left">Org</th>
                    <th className="px-3 py-2 text-right">Вызовов</th>
                    <th className="px-3 py-2 text-right">Расход</th>
                    <th className="px-3 py-2 text-left">Топ функций</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.items.map((u) => (
                    <tr
                      key={u.userId}
                      className="border-t border-border-subtle hover:bg-bg-overlay"
                    >
                      <td className="px-3 py-2">
                        <div className="font-medium">{u.userName || "—"}</div>
                        <div className="text-xs text-fg-tertiary">
                          {u.userEmail}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        {u.tenantName ? (
                          <span className="text-fg-secondary">
                            {u.tenantName}
                          </span>
                        ) : (
                          <span className="text-fg-tertiary">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {u.totalCalls.toLocaleString("ru-RU")}
                      </td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">
                        {formatUsd(u.totalCostUsd)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1.5 text-xs">
                          {u.byTaskType.slice(0, 3).map((t) => (
                            <Link
                              key={t.taskType}
                              href={`/admin/usage/functions/${encodeURIComponent(t.taskType)}`}
                              className="rounded-full bg-bg-overlay px-2 py-0.5 hover:bg-accent-muted"
                            >
                              {t.taskType}: {formatUsd(t.costUsd)}
                            </Link>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {}
            <ul className="space-y-2 md:hidden">
              {q.data.items.map((u) => (
                <li
                  key={u.userId}
                  className="rounded-lg border border-border-subtle bg-bg-card p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-fg-primary">
                        {u.userName || "—"}
                      </div>
                      <div className="truncate text-xs text-fg-tertiary">
                        {u.userEmail}
                      </div>
                      {u.tenantName && (
                        <div className="mt-0.5 truncate text-xs text-fg-secondary">
                          {u.tenantName}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-medium tabular-nums text-fg-primary">
                        {formatUsd(u.totalCostUsd)}
                      </div>
                      <div className="text-[11px] tabular-nums text-fg-tertiary">
                        {u.totalCalls.toLocaleString("ru-RU")} вызовов
                      </div>
                    </div>
                  </div>
                  {u.byTaskType.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                      {u.byTaskType.slice(0, 3).map((t) => (
                        <Link
                          key={t.taskType}
                          href={`/admin/usage/functions/${encodeURIComponent(t.taskType)}`}
                          className="rounded-full bg-bg-overlay px-2 py-0.5 hover:bg-accent-muted"
                        >
                          {t.taskType}: {formatUsd(t.costUsd)}
                        </Link>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        ))}

      <p className="text-xs text-fg-tertiary">
        Drill-down на конкретный вызов — раздел{" "}
        <Link
          href="/admin/usage/functions"
          className="text-accent hover:underline"
        >
          Функции LLM
        </Link>
        .
      </p>
    </div>
  );
}
