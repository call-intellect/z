"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";

import { ApiError } from "@/api/api-error";
import { curationApi, type ConflictStatusApi } from "@/api/curation.api";
import { useAuth } from "@/contexts/auth-context";
import type { CurrentOrgRole } from "@/domain/account";
import { conflictStatusLabel, mapConflictItem } from "@/domain/curation";
import { resourceTypeRu } from "@/domain/resource-type";
import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
  AdminLoading,
} from "@app/(admin)/admin/AdminStateViews";

const CONFLICT_ORG_ROLES = new Set<CurrentOrgRole>(["owner", "admin"]);

export function isConflictAccessAllowed(
  isSuperAdmin: boolean,
  orgRole: CurrentOrgRole,
): boolean {
  if (isSuperAdmin) return true;
  return CONFLICT_ORG_ROLES.has(orgRole);
}

const STATUS_OPTIONS: Array<{ value: ConflictStatusApi; label: string }> = [
  { value: "open", label: "Открытые" },
  { value: "resolved", label: "Разрешённые" },
  { value: "dismissed", label: "Отклонённые" },
];

function statusBadgeClass(status: ConflictStatusApi): string {
  switch (status) {
    case "open":
      return "border-warning/40 bg-warning/10 text-warning";
    case "resolved":
      return "border-success/40 bg-success/10 text-success";
    case "dismissed":
      return "border-border-subtle bg-bg-overlay text-fg-tertiary";
    default:
      return "border-border-subtle bg-bg-overlay text-fg-secondary";
  }
}

export function ConflictsListClient() {
  const {
    isLoading: authLoading,
    currentOrgId,
    currentOrgRole,
    isSuperAdmin,
  } = useAuth();

  const [status, setStatus] = useState<ConflictStatusApi>("open");

  const listSwr = useSWR(["curation-conflicts", status], async () => {
    const res = await curationApi.listConflicts({ status });
    return {
      items: res.items.map(mapConflictItem),
      total: res.total,
    };
  });

  if (authLoading) {
    return (
      <div className="mx-auto w-full max-w-4xl px-6 py-8">
        <AdminLoading rows={6} />
      </div>
    );
  }

  if (!currentOrgId) {
    return (
      <div className="mx-auto w-full max-w-4xl px-6 py-8">
        <AdminForbidden
          title="Нет организации"
          description="Вы не состоите ни в одной компании, поэтому конфликты недоступны."
        />
      </div>
    );
  }

  if (!isConflictAccessAllowed(isSuperAdmin, currentOrgRole)) {
    return (
      <div className="mx-auto w-full max-w-4xl px-6 py-8">
        <AdminForbidden
          title="Доступ запрещён"
          description="Разрешать конфликты канонизации могут только владелец и администратор компании."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Конфликты канонизации</h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Случаи, когда новая карточка спорит с уже существующей. Решает только
          владелец или администратор.
        </p>
      </header>

      {}
      <div className="mb-4">
        <label
          htmlFor="conflicts-status-filter"
          className="mb-1 block text-xs text-fg-tertiary"
        >
          Статус
        </label>
        <select
          id="conflicts-status-filter"
          value={status}
          onChange={(e) => setStatus(e.target.value as ConflictStatusApi)}
          className="rounded-md border border-border-subtle bg-bg-input px-2 py-1.5 text-sm"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {listSwr.isLoading && !listSwr.data ? (
        <AdminLoading rows={5} />
      ) : listSwr.error ? (
        <AdminError
          message={
            listSwr.error instanceof ApiError
              ? listSwr.error.message
              : "Не удалось загрузить список конфликтов"
          }
          onRetry={() => void listSwr.mutate()}
        />
      ) : !listSwr.data || listSwr.data.items.length === 0 ? (
        <AdminEmpty
          title="Конфликтов нет"
          description="Когда канонизация обнаружит спорные карточки, они появятся здесь."
        />
      ) : (
        <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle bg-bg-card">
          {listSwr.data.items.map((c) => (
            <li key={c.id}>
              <Link
                href={`/curation/conflicts/${encodeURIComponent(c.id)}`}
                className="flex flex-col gap-1 px-4 py-3 transition hover:bg-bg-hover/50"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    {resourceTypeRu(c.resourceType)}
                  </span>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs ${statusBadgeClass(
                      c.status,
                    )}`}
                  >
                    {conflictStatusLabel(c.status)}
                  </span>
                </div>
                <div className="truncate text-xs text-fg-tertiary">
                  Две карточки знания расходятся — откройте, чтобы решить
                </div>
                <div className="text-xs text-fg-tertiary">
                  обнаружен {c.createdAt.toLocaleString("ru-RU")}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
