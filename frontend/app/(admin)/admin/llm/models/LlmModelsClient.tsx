"use client";

import { useState } from "react";

import { adminLlmModelsApi } from "@/api/admin-llm-models.api";
import {
  adminLlmModelFromApi,
  type AdminLlmModelDomain,
} from "@/domain/admin-llm-model";
import { Badge } from "@/ui/shadcn/badge";

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
  AdminLoading,
} from "../../AdminStateViews";
import { useAdminQuery } from "../../useAdminQuery";

export function LlmModelsClient() {
  const [includeInactive, setIncludeInactive] = useState(false);

  const q = useAdminQuery(
    `admin-llm-models:${includeInactive}`,
    async () => {
      const res = await adminLlmModelsApi.list({ includeInactive });
      return res.items.map(adminLlmModelFromApi);
    },
    [includeInactive],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">LLM модели</h1>
          <p className="text-sm text-fg-tertiary">
            Реестр моделей по провайдерам. Для прайса перейдите на «Прайс LLM».
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
          />
          Показать неактивные
        </label>
      </div>

      {q.isLoading && <AdminLoading rows={5} />}
      {!q.isLoading && q.isForbidden && <AdminForbidden />}
      {!q.isLoading && q.error && (
        <AdminError message={q.error} onRetry={q.refetch} />
      )}
      {!q.isLoading && q.data && q.data.length === 0 && (
        <AdminEmpty
          title="Реестр пуст"
          description="Запустите seed-default-llm-providers-and-models.ts"
        />
      )}
      {!q.isLoading && q.data && q.data.length > 0 && (
        <ModelsTable items={q.data} />
      )}
    </div>
  );
}

function ModelsTable({ items }: { items: AdminLlmModelDomain[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border-subtle">
      <table className="w-full text-sm">
        <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-fg-tertiary">
          <tr>
            <th className="px-3 py-2 text-left">Провайдер</th>
            <th className="px-3 py-2 text-left">Model key</th>
            <th className="px-3 py-2 text-left">Отображение</th>
            <th className="px-3 py-2 text-left">Категория</th>
            <th className="px-3 py-2 text-right">Контекст (tokens)</th>
            <th className="px-3 py-2 text-left">Статус</th>
            <th className="px-3 py-2 text-left">Verified</th>
          </tr>
        </thead>
        <tbody>
          {items.map((m) => (
            <tr
              key={m.id}
              className="border-t border-border-subtle hover:bg-bg-overlay"
            >
              <td className="px-3 py-2 font-mono text-xs">{m.providerName}</td>
              <td className="px-3 py-2 font-mono text-xs">{m.modelKey}</td>
              <td className="px-3 py-2">{m.displayName}</td>
              <td className="px-3 py-2 text-xs">{m.category ?? "—"}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {m.contextWindow
                  ? m.contextWindow.toLocaleString("ru-RU")
                  : "—"}
              </td>
              <td className="px-3 py-2">
                {m.isActive ? (
                  <Badge variant="default">активна</Badge>
                ) : (
                  <Badge variant="secondary">отключена</Badge>
                )}
              </td>
              <td className="px-3 py-2 text-xs">
                {m.verifiedAt ? (
                  m.verifiedAt.toLocaleDateString("ru-RU")
                ) : (
                  <span className="text-fg-tertiary">не проверена</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
