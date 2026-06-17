"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Users } from "lucide-react";

import { ApiError } from "@/api/api-error";
import {
  departmentsApi,
  rolesDomainApi,
  type DepartmentApi,
  type RoleDomainApi,
} from "@/api/structure.api";
import { useAuth } from "@/contexts/auth-context";
import { getRoleTemplates } from "@/lib/role-templates";
import { EmptyState } from "@/ui/components/shared/EmptyState";
import { QueryGate } from "@/ui/components/shared/QueryGate";
import { Badge } from "@/ui/shadcn/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/shadcn/card";
import { Skeleton } from "@/ui/shadcn/skeleton";

import { AdminEmpty, AdminForbidden } from "@app/(admin)/admin/AdminStateViews";

export function RolesListClient() {
  const { currentOrgId, isLoading } = useAuth();

  if (isLoading) return null;
  if (!currentOrgId) {
    return (
      <AdminForbidden
        title="Нет организации"
        description="Этот раздел доступен только в рамках организации."
      />
    );
  }
  return <Content orgId={currentOrgId} />;
}

function Content({ orgId }: { orgId: string }) {
  const { data, error, isLoading, mutate } = useSWR(
    ["roles-list", orgId],
    () => rolesDomainApi.list(orgId),
    { revalidateOnFocus: false },
  );

  const { data: depsData } = useSWR(
    ["departments", orgId],
    () => departmentsApi.list(orgId),
    { revalidateOnFocus: false },
  );
  const departments = depsData?.items ?? [];

  const errorView =
    error instanceof ApiError && error.code === "http_404" ? (
      <AdminEmpty
        title="Раздел в разработке"
        description="API должностей ещё не подключён."
      />
    ) : error instanceof ApiError && error.code === "forbidden" ? (
      <AdminForbidden />
    ) : undefined;

  const items = data?.items ?? [];

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
          Карты должностей
        </h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Кора собирает карту должности по встречам, документам и дампам. Чем
          больше материала — тем точнее карта.
        </p>
      </header>

      <QueryGate
        isLoading={isLoading}
        error={error}
        errorView={errorView}
        onRetry={() => void mutate()}
        isEmpty={items.length === 0}
        skeleton={
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-32 w-full" />
            ))}
          </div>
        }
        empty={
          <EmptyState
            title="Должностей пока нет"
            description="Создайте первую в разделе «Структура»."
          />
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((r) => (
            <RoleCard key={r.id} role={r} />
          ))}
        </div>
      </QueryGate>

      {departments.length > 0 && (
        <RoleSuggestionsPanel
          orgId={orgId}
          departments={departments}
          onRoleAdded={() => void mutate()}
        />
      )}
    </div>
  );
}

function RoleCard({ role }: { role: RoleDomainApi }) {
  return (
    <Link
      href={`/roles/${encodeURIComponent(role.id)}`}
      className="block focus:outline-none"
    >
      <Card className="h-full transition-colors hover:border-accent">
        <CardHeader className="pb-2">
          <CardTitle className="line-clamp-1 text-base">{role.name}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-fg-tertiary">
            {role.departmentName ?? "Без отдела"}
          </p>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 text-sm text-fg-secondary">
              <Users size={14} />
              <span>{role.personsCount ?? 0}</span>
            </div>
            <ProfileStatusBadge status={role.profileStatus} />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function ProfileStatusBadge({
  status,
}: {
  status?: RoleDomainApi["profileStatus"];
}) {
  switch (status) {
    case "ready":
      return <Badge>Карта готова</Badge>;
    case "forming":
      return <Badge variant="secondary">Формируется</Badge>;
    case "stale":
      return <Badge variant="secondary">Требует обновления</Badge>;
    case "error":
      return <Badge variant="outline">Ошибка</Badge>;
    case "absent":
    default:
      return <Badge variant="outline">Карты ещё нет</Badge>;
  }
}

function RoleSuggestionsPanel({
  orgId,
  departments,
  onRoleAdded,
}: {
  orgId: string;
  departments: DepartmentApi[];
  onRoleAdded: () => void;
}) {
  const [adding, setAdding] = useState<string | null>(null);

  if (departments.length === 0) return null;

  const handleAdd = async (deptId: string, roleName: string) => {
    setAdding(roleName + deptId);
    try {
      await rolesDomainApi.create(orgId, {
        name: roleName,
        departmentId: deptId,
      });
      onRoleAdded();
    } catch {
    } finally {
      setAdding(null);
    }
  };

  return (
    <div className="mt-8">
      <h2 className="text-sm font-semibold text-fg-secondary mb-4">
        Предлагаемые должности
      </h2>
      <div className="space-y-4">
        {departments.map((dept) => {
          const suggestions = getRoleTemplates(dept.name);
          return (
            <div
              key={dept.id}
              className="rounded-xl border border-border-default bg-bg-subtle p-4"
            >
              <p className="text-sm font-medium text-fg-primary mb-2">
                {dept.name}
              </p>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((roleName) => (
                  <button
                    key={roleName}
                    onClick={() => void handleAdd(dept.id, roleName)}
                    disabled={adding === roleName + dept.id}
                    className="rounded-md border border-border-default bg-bg-base px-3 py-1 text-xs text-fg-secondary hover:bg-bg-muted transition-colors disabled:opacity-50"
                  >
                    {adding === roleName + dept.id ? "..." : `+ ${roleName}`}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
