"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, Loader2, Search } from "lucide-react";

import {
  AI_MODELS_GROUPS,
  adminAiModelsApi,
  type AiModelGroup,
} from "@/api/admin-ai-models.api";
import {
  mapTaskTypeRoute,
  type TaskTypeRouteUi,
} from "@/domain/admin-ai-model";
import { Badge } from "@/ui/shadcn/badge";
import { Button } from "@/ui/shadcn/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/shadcn/select";

import { AdminForbidden } from "../AdminStateViews";
import { useAdminQuery } from "../useAdminQuery";

export function AiModelsClient() {
  const [groupFilter, setGroupFilter] = useState<"all" | AiModelGroup>("all");
  const [search, setSearch] = useState("");

  const q = useAdminQuery<TaskTypeRouteUi[]>(
    `ai-models:${groupFilter}:${search}`,
    async () => {
      const res = await adminAiModelsApi.list({
        ...(groupFilter !== "all" ? { group: groupFilter } : {}),
        ...(search ? { search } : {}),
      });
      return res.items.map(mapTaskTypeRoute);
    },
    [groupFilter, search],
  );

  const items: TaskTypeRouteUi[] = useMemo(() => q.data ?? [], [q.data]);
  const loading = q.isLoading;
  const error = q.error;

  const grouped = useMemo(() => {
    const map = new Map<string, TaskTypeRouteUi[]>();
    for (const it of items) {
      const list = map.get(it.group) ?? [];
      list.push(it);
      map.set(it.group, list);
    }
    return Array.from(map.entries());
  }, [items]);

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
            Модели агентов
          </h1>
          <p className="text-sm text-fg-secondary">
            Цепочка моделей primary → secondary → tertiary для каждого
            AI-агента. Источник дефолтов — playbook §2.1.
          </p>
        </div>
        <Link href="/admin/ai-models/experiments">
          <Button variant="secondary" size="sm">
            A/B-эксперименты
          </Button>
        </Link>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search
            size={14}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-fg-tertiary"
          />
          <input
            type="text"
            placeholder="Поиск по taskType"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-64 rounded-md border border-border-subtle bg-bg-card pl-7 pr-3 text-sm"
          />
        </div>
        <Select
          value={groupFilter}
          onValueChange={(v) => setGroupFilter(v as "all" | AiModelGroup)}
        >
          <SelectTrigger className="h-9 w-56 bg-bg-card text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все группы</SelectItem>
            {AI_MODELS_GROUPS.map((g) => (
              <SelectItem key={g} value={g}>
                {g === "ai-pipeline"
                  ? "AI-конвейер встреч"
                  : g === "knowledge-core"
                    ? "База знаний"
                    : "Паритет с конкурентами"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16 text-sm text-fg-secondary">
          <Loader2 size={16} className="mr-2 animate-spin" /> Загружаем…
        </div>
      )}

      {!loading && q.isForbidden && <AdminForbidden />}

      {!loading && !q.isForbidden && error && (
        <div className="rounded-md border border-chip-danger-bg bg-chip-danger-bg p-3 text-sm text-chip-danger-fg">
          {error}
        </div>
      )}

      {!loading && !q.isForbidden && !error && items.length === 0 && (
        <div className="rounded-md border border-dashed border-border-subtle p-8 text-center text-sm text-fg-secondary">
          Пока нет ни одной записи. Запустите{" "}
          <code className="rounded bg-bg-subtle px-1 py-0.5 font-mono">
            bun run scripts/seed-llm-task-routes-default.ts
          </code>{" "}
          на проде, чтобы применить дефолтные цепочки из playbook §2.1.
        </div>
      )}

      {grouped.map(([group, list]) => (
        <section key={group} className="mb-8">
          <h2 className="mb-3 text-base font-semibold text-fg-primary">
            {list[0]?.groupLabel ?? group}
            <span className="ml-2 text-xs font-normal text-fg-secondary">
              {list.length} агентов
            </span>
          </h2>
          <div className="overflow-hidden rounded-lg border border-border-subtle bg-bg-card">
            <table className="w-full text-sm">
              <thead className="bg-bg-subtle text-xs uppercase text-fg-secondary">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Задача</th>
                  <th className="px-3 py-2 text-left font-medium">Основная</th>
                  <th className="px-3 py-2 text-left font-medium">Запасная</th>
                  <th className="px-3 py-2 text-left font-medium">Локальная</th>
                  <th className="w-24 px-3 py-2 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {list.map((row) => (
                  <tr
                    key={row.taskType}
                    className="border-t border-border-subtle"
                  >
                    <td className="px-3 py-2">
                      <code className="font-mono text-xs text-fg-secondary">
                        {row.taskType}
                      </code>
                    </td>
                    <td className="px-3 py-2">
                      <TierBadge
                        color="green"
                        label="primary"
                        entry={row.primary}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <TierBadge
                        color="orange"
                        label="secondary"
                        entry={row.secondary}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <TierBadge
                        color="gray"
                        label="tertiary"
                        entry={row.tertiary}
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        href={`/admin/ai-models/${encodeURIComponent(row.taskType)}`}
                        className="inline-flex items-center gap-1 text-xs text-info hover:underline"
                      >
                        Подробно <ExternalLink size={11} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

function TierBadge({
  color,
  label,
  entry,
}: {
  color: "green" | "orange" | "gray";
  label: string;
  entry: TaskTypeRouteUi["primary"];
}) {
  if (!entry) {
    return <span className="text-xs text-fg-tertiary">— не задана —</span>;
  }
  const colorClass =
    color === "green"
      ? "bg-chip-success-bg text-chip-success-fg border-chip-success-bg"
      : color === "orange"
        ? "bg-chip-warning-bg text-chip-warning-fg border-chip-warning-bg"
        : "bg-bg-subtle text-fg-secondary border-border-subtle";
  return (
    <div className="flex flex-col gap-1">
      <Badge
        variant="outline"
        className={`w-fit border ${colorClass} text-[10px]`}
      >
        {label}
      </Badge>
      <div className="text-xs">
        <span className="font-medium text-fg-primary">
          {entry.providerLabel}
        </span>
        {entry.model && (
          <span className="ml-1 text-fg-secondary">/ {entry.model}</span>
        )}
      </div>
    </div>
  );
}
