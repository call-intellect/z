"use client";

import Link from "next/link";
import { AlertCircle, ArrowLeft, Award, Loader2 } from "lucide-react";
import useSWR from "swr";

import { ApiError } from "@/api/api-error";
import {
  roleMapApi,
  type RoleMapApi,
  type RoleMaturityApi,
} from "@/api/role-map.api";
import { useAuth } from "@/contexts/auth-context";
import { Badge } from "@/ui/shadcn/badge";
import { Progress } from "@/ui/shadcn/progress";
import { Skeleton } from "@/ui/shadcn/skeleton";
import { RoleMapGrid } from "@/ui/components/role-map/RoleMapCards";

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
} from "@app/(admin)/admin/AdminStateViews";

export function RoleMapClient({ roleId }: { roleId: string }) {
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
  return <Content orgId={currentOrgId} roleId={roleId} />;
}

function Content({ orgId, roleId }: { orgId: string; roleId: string }) {
  const mapSwr = useSWR(["role-map", orgId, roleId], () =>
    roleMapApi.getMap(orgId, roleId),
  );
  const maturitySwr = useSWR(["role-maturity", orgId, roleId], () =>
    roleMapApi.getMaturity(orgId, roleId),
  );

  if (mapSwr.isLoading) {
    return (
      <div className="mx-auto w-full max-w-6xl px-6 py-8">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="mt-4 h-32 w-full" />
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-48 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (mapSwr.error) {
    if (
      mapSwr.error instanceof ApiError &&
      (mapSwr.error.code === "http_404" ||
        mapSwr.error.code === "role_not_found")
    ) {
      return (
        <div className="mx-auto w-full max-w-6xl px-6 py-8">
          <AdminEmpty
            title="Должность не найдена"
            description="Возможно, она была удалена."
          />
        </div>
      );
    }
    return (
      <div className="mx-auto w-full max-w-6xl px-6 py-8">
        <AdminError
          message={
            mapSwr.error instanceof Error
              ? mapSwr.error.message
              : "Не удалось загрузить карту"
          }
          onRetry={() => void mapSwr.mutate()}
        />
      </div>
    );
  }

  const map = mapSwr.data;
  if (!map) return null;

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <Link
        href={`/roles/${roleId}`}
        className="mb-3 inline-flex items-center gap-1 text-xs text-fg-tertiary hover:text-fg-secondary"
      >
        <ArrowLeft size={12} /> К должности
      </Link>

      <Header map={map} maturity={maturitySwr.data ?? null} />

      <MissionSection map={map} />

      <RoleMapGrid
        map={map}
        className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2"
      />

      <CompletenessBreakdownSection
        maturity={maturitySwr.data ?? null}
        loading={maturitySwr.isLoading}
      />
    </div>
  );
}

function Header({
  map,
  maturity,
}: {
  map: RoleMapApi;
  maturity: RoleMaturityApi | null;
}) {
  const completenessPct = Math.round(map.completeness * 100);
  const maturityPct =
    map.maturityScore !== null ? Math.round(map.maturityScore * 100) : null;
  return (
    <header className="mb-6 rounded-lg border border-border-subtle bg-bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
            {map.role.name}
          </h1>
          <p className="mt-1 text-sm text-fg-secondary">
            {map.role.departmentName
              ? `Отдел: ${map.role.departmentName}`
              : "Без отдела"}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {map.isForming && (
            <Badge variant="secondary" className="gap-1">
              <Loader2 size={12} className="animate-spin" />
              Формируется
            </Badge>
          )}
          {map.builtAt && (
            <span className="text-xs text-fg-tertiary">
              Собрана: {new Date(map.builtAt).toLocaleString("ru-RU")}
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-fg-tertiary">
            <span>Полнота карты (9 слотов)</span>
            <span className="font-medium text-fg-primary">
              {completenessPct}%
            </span>
          </div>
          <Progress value={completenessPct} />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-fg-tertiary">
            <span>Зрелость роли</span>
            <span className="font-medium text-fg-primary">
              {maturityPct === null ? "—" : `${maturityPct}%`}
            </span>
          </div>
          <Progress value={maturityPct ?? 0} />
        </div>
      </div>

      {maturity?.rationale && (
        <p className="mt-3 text-sm text-fg-secondary">{maturity.rationale}</p>
      )}
    </header>
  );
}

function MissionSection({ map }: { map: RoleMapApi }) {
  if (!map.role.missionStatement) {
    return (
      <section className="mt-4 rounded-lg border border-dashed border-border-subtle bg-bg-card p-4 text-sm text-fg-tertiary">
        Миссия должности не задана — заполните её в карточке должности, чтобы
        повысить полноту карты.
      </section>
    );
  }
  return (
    <section className="mt-4 rounded-lg border border-border-subtle bg-bg-card p-4">
      <h3 className="mb-1 text-xs font-medium uppercase tracking-wider text-fg-tertiary">
        Миссия должности
      </h3>
      <p className="text-sm text-fg-primary">{map.role.missionStatement}</p>
    </section>
  );
}

function CompletenessBreakdownSection({
  maturity,
  loading,
}: {
  maturity: RoleMaturityApi | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <section className="mt-6 rounded-lg border border-border-subtle bg-bg-card p-5">
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="mt-3 h-24 w-full" />
      </section>
    );
  }
  if (!maturity) return null;
  return (
    <section className="mt-6 rounded-lg border border-border-subtle bg-bg-card p-5">
      <header className="mb-3 flex items-center gap-2">
        <Award size={16} />
        <h2 className="text-base font-medium text-fg-primary">
          Полнота по слотам
        </h2>
      </header>
      <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {maturity.contributingFactors.map((f) => (
          <div
            key={f.label}
            className="flex items-center justify-between gap-2 rounded border border-border-subtle px-3 py-2"
          >
            <div className="flex items-center gap-2">
              {f.value > 0 ? (
                <span className="inline-flex h-2 w-2 rounded-full bg-success" />
              ) : (
                <AlertCircle size={14} className="text-warning" />
              )}
              <span className="text-fg-primary">{f.label}</span>
            </div>
            <span className="text-xs text-fg-tertiary">
              вес {Math.round(f.weight * 100)}%
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
