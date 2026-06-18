"use client";

import { useMemo, useState } from "react";
import { Pencil, Search } from "lucide-react";

import { ApiError } from "@/api/api-error";
import { LLM_PROVIDERS, type LlmProvider } from "@/api/admin-llm-routes.api";
import {
  providerLabel,
  type LlmRouteUi,
  type LlmRouteTierEntryUi,
} from "@/domain/admin-llm-route";
import { useLlmRoutes } from "@/hooks/useLlmRoutes";
import { AdminSection } from "@/ui/components/admin/AdminSection";
import { Badge } from "@/ui/shadcn/badge";
import { Button } from "@/ui/shadcn/button";
import { Checkbox } from "@/ui/shadcn/checkbox";
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
} from "../AdminStateViews";
import { EditRouteDialog } from "./EditRouteDialog";
import { adminRootCrumb } from "@/ui/components/admin/brand";

export function LlmRoutesClient() {
  const { routes, error, isLoading, mutate } = useLlmRoutes();

  const [search, setSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState<"all" | LlmProvider>(
    "all",
  );
  const [editedOnly, setEditedOnly] = useState(false);
  const [editing, setEditing] = useState<LlmRouteUi | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return routes.filter((r) => {
      if (q && !r.taskType.toLowerCase().includes(q)) return false;
      if (
        providerFilter !== "all" &&
        r.primary?.providerName !== providerFilter
      ) {
        return false;
      }
      if (editedOnly && !r.editedByAdmin) return false;
      return true;
    });
  }, [routes, search, providerFilter, editedOnly]);

  const isForbidden = error instanceof ApiError && error.code === "forbidden";
  const errorMessage =
    error && !isForbidden
      ? error instanceof ApiError
        ? error.message
        : "Не удалось загрузить роуты"
      : null;

  return (
    <AdminSection
      breadcrumbs={[
        adminRootCrumb(),
        { label: "AI и модели" },
        { label: "Управление роутами LLM" },
      ]}
      title="Управление роутами LLM"
      description="Цепочка primary → secondary → tertiary для каждого taskType. Источник правды — БД LlmTaskRoute. После сохранения seed-скрипты не перезатрут эту настройку."
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search
            size={14}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-fg-tertiary"
          />
          <input
            type="text"
            placeholder="Поиск по типу задачи"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-64 rounded-md border border-border-subtle bg-bg-card pl-7 pr-3 text-sm"
          />
        </div>
        <Select
          value={providerFilter}
          onValueChange={(v) => setProviderFilter(v as "all" | LlmProvider)}
        >
          <SelectTrigger className="h-9 w-56 bg-bg-card text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все основные провайдеры</SelectItem>
            {LLM_PROVIDERS.map((p) => (
              <SelectItem key={p} value={p}>
                {providerLabel(p)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm text-fg-secondary">
          <Checkbox
            checked={editedOnly}
            onCheckedChange={(v) => setEditedOnly(v === true)}
          />
          Только отредактированные админом
        </label>
        <div className="ml-auto text-xs text-fg-tertiary">
          {filtered.length} из {routes.length}
        </div>
      </div>

      {isLoading && <AdminLoading rows={8} />}
      {!isLoading && isForbidden && <AdminForbidden />}
      {!isLoading && errorMessage && (
        <AdminError message={errorMessage} onRetry={() => void mutate()} />
      )}
      {!isLoading && !isForbidden && !errorMessage && filtered.length === 0 && (
        <AdminEmpty
          title={
            routes.length === 0
              ? "Роуты не настроены"
              : "По фильтру ничего не найдено"
          }
          description={
            routes.length === 0
              ? "Запустите seed-скрипт `bun run scripts/seed-llm-task-routes-default.ts` на бэкенде, чтобы применить дефолтные цепочки."
              : "Попробуйте сбросить фильтры или ввести другой поисковый запрос."
          }
        />
      )}

      {!isLoading && !isForbidden && !errorMessage && filtered.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border-subtle bg-bg-card">
          <table className="w-full text-sm">
            <thead className="bg-bg-subtle text-xs uppercase text-fg-secondary">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Тип задачи</th>
                <th className="px-3 py-2 text-left font-medium">Primary</th>
                <th className="px-3 py-2 text-left font-medium">Secondary</th>
                <th className="px-3 py-2 text-left font-medium">Tertiary</th>
                <th className="px-3 py-2 text-left font-medium">Статус</th>
                <th className="px-3 py-2 text-left font-medium">
                  Изменено админом
                </th>
                <th className="w-28 px-3 py-2 text-right font-medium">
                  Действия
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((route) => (
                <RouteRow
                  key={route.taskType}
                  route={route}
                  onEdit={() => setEditing(route)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <EditRouteDialog
          route={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await mutate();
          }}
        />
      )}
    </AdminSection>
  );
}

function RouteRow({
  route,
  onEdit,
}: {
  route: LlmRouteUi;
  onEdit: () => void;
}) {
  const anyActive =
    route.primary?.isActive ||
    route.secondary?.isActive ||
    route.tertiary?.isActive;
  return (
    <tr className="border-t border-border-subtle">
      <td className="px-3 py-2">
        <code className="font-mono text-xs text-fg-primary">
          {route.taskType}
        </code>
      </td>
      <td className="px-3 py-2">
        <TierCell entry={route.primary} />
      </td>
      <td className="px-3 py-2">
        <TierCell entry={route.secondary} />
      </td>
      <td className="px-3 py-2">
        <TierCell entry={route.tertiary} />
      </td>
      <td className="px-3 py-2">
        {anyActive ? (
          <Badge
            variant="outline"
            className="border-chip-success-bg bg-chip-success-bg text-chip-success-fg"
          >
            Активен
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="border-border-subtle bg-bg-subtle text-fg-secondary"
          >
            Выключен
          </Badge>
        )}
      </td>
      <td className="px-3 py-2">
        {route.editedByAdmin ? (
          <Badge
            variant="outline"
            className="border-chip-success-bg bg-chip-success-bg text-chip-success-fg"
          >
            ✓ ред.
          </Badge>
        ) : (
          <span className="text-xs text-fg-tertiary">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        <Button size="sm" variant="outline" onClick={onEdit}>
          <Pencil size={12} className="mr-1" /> Изменить
        </Button>
      </td>
    </tr>
  );
}

function TierCell({ entry }: { entry?: LlmRouteTierEntryUi }) {
  if (!entry) {
    return <span className="text-xs text-fg-tertiary">— не задана —</span>;
  }
  return (
    <div className="text-xs">
      <span className="font-medium text-fg-primary">
        {providerLabel(entry.providerName)}
      </span>
      <span className="ml-1 text-fg-secondary">/ {entry.model}</span>
    </div>
  );
}
