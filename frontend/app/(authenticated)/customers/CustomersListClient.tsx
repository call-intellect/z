"use client";

import { useCallback, useEffect, useState } from "react";

import { ApiError, humanizeApiError } from "@/api/api-error";
import {
  customersApi,
  type CustomerStatusApi,
  type CustomersListResponseApi,
} from "@/api/customers.api";
import { useAuth } from "@/contexts/auth-context";
import { Input } from "@/ui/shadcn/input";

import {
  AdminError,
  AdminForbidden,
  AdminLoading,
} from "@app/(admin)/admin/AdminStateViews";

const STATUS_LABEL: Record<CustomerStatusApi, string> = {
  active: "Активный",
  inactive: "Неактивный",
  churned: "Ушёл",
};

export function CustomersListClient() {
  const { currentOrgId, isLoading: authLoading } = useAuth();

  if (authLoading) return <AdminLoading rows={4} />;
  if (!currentOrgId) {
    return (
      <AdminForbidden
        title="Нет организации"
        description="Вы не состоите ни в одной организации."
      />
    );
  }
  return <CustomersListContent />;
}

function CustomersListContent() {
  const [data, setData] = useState<CustomersListResponseApi | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const dto = await customersApi.list({
        ...(q.trim() ? { q: q.trim() } : {}),
        limit: 50,
      });
      setData(dto);
    } catch (e) {
      if (e instanceof ApiError && e.code === "forbidden") {
        setForbidden(true);
      } else {
        setError(humanizeApiError(e, "Ошибка загрузки"));
      }
    } finally {
      setIsLoading(false);
    }
  }, [q]);

  useEffect(() => {
    void load();
  }, [load]);

  if (isLoading && !data) return <AdminLoading rows={6} />;
  if (forbidden) return <AdminForbidden />;
  if (error) return <AdminError message={error} onRetry={load} />;
  if (!data) return null;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-6 py-8">
      <header>
        <h1 className="text-2xl font-semibold">Клиенты</h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Всего: {data.total}. Показано: {data.items.length}.
        </p>
      </header>

      <div>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск по имени, ИНН или email"
          className="max-w-md"
        />
      </div>

      {data.items.length === 0 ? (
        <p className="text-sm text-fg-tertiary">
          Клиентов нет — появятся после синхронизации переписок ChatBox.
        </p>
      ) : (
        <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle bg-bg-card">
          {data.items.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between px-4 py-3"
            >
              <div>
                <div className="text-sm font-medium">
                  {c.name || "(без имени)"}
                </div>
                <div className="mt-0.5 text-xs text-fg-tertiary">
                  {c.email ?? c.phone ?? (c.inn ? `ИНН ${c.inn}` : "—")}
                </div>
              </div>
              <div className="text-xs tabular-nums text-fg-tertiary">
                {STATUS_LABEL[c.status]}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
