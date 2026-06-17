"use client";

import Link from "next/link";
import { ArrowRight, FlaskConical } from "lucide-react";

import { adminFunctionsApi } from "@/api/admin-experiments.api";
import {
  adminFunctionListFromApi,
  taskTypeLabel,
} from "@/domain/admin-experiment";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/shadcn/card";
import { Button } from "@/ui/shadcn/button";

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
  AdminLoading,
} from "../AdminStateViews";
import { useAdminQuery } from "../useAdminQuery";

export function ExperimentsListClient() {
  const q = useAdminQuery(
    "admin-experiments-list",
    async () => {
      const res = await adminFunctionsApi.list();
      return adminFunctionListFromApi(res);
    },
    [],
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">A/B-эксперименты</h1>
        <p className="text-sm text-fg-tertiary">
          Активные эксперименты по функциям LLM. Запуск нового — со страницы
          конкретной функции.
        </p>
      </div>

      {q.isLoading && <AdminLoading rows={5} />}
      {!q.isLoading && q.isForbidden && <AdminForbidden />}
      {!q.isLoading && q.error && (
        <AdminError message={q.error} onRetry={q.refetch} />
      )}

      {!q.isLoading && q.data && <ActiveExperimentsList items={q.data.items} />}
    </div>
  );
}

function ActiveExperimentsList({
  items,
}: {
  items: ReturnType<typeof adminFunctionListFromApi>["items"];
}) {
  const active = items.filter((it) => it.experimentEnabled);

  if (active.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Активные эксперименты</CardTitle>
        </CardHeader>
        <CardContent>
          <AdminEmpty
            title="Сейчас экспериментов нет"
            description="Чтобы запустить — откройте функцию (Функции LLM → конкретная функция → «Запустить A/B»)."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <ul className="space-y-2">
      {active.map((it) => (
        <li key={it.taskType}>
          <Link
            href={`/admin/experiments/${encodeURIComponent(it.taskType)}`}
            className="flex items-center gap-3 rounded-lg border border-border-subtle bg-bg-card px-4 py-3 hover:border-accent/60 hover:bg-bg-overlay"
          >
            <FlaskConical size={16} className="text-accent" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{taskTypeLabel(it.taskType)}</div>
              <div className="font-mono text-[10px] text-fg-tertiary">
                {it.taskType}
              </div>
            </div>
            <Button variant="ghost" size="sm">
              Открыть <ArrowRight size={12} />
            </Button>
          </Link>
        </li>
      ))}
    </ul>
  );
}
