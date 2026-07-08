"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, PlayCircle, Zap } from "lucide-react";
import { toast } from "sonner";

import { ApiError } from "@/api/api-error";
import { adminSmokeTestApi } from "@/api/admin-smoke-test.api";
import { adminLlmProvidersApi } from "@/api/admin-llm-providers.api";
import {
  mapProviderSmokeToUi,
  mapSmokeTestRun,
  providerLabel,
  type SmokeTestRunUi,
} from "@/domain/admin-smoke-test";
import {
  adminLlmProviderFromApi,
  type AdminLlmProviderDomain,
} from "@/domain/admin-llm-provider";
import { Badge } from "@/ui/shadcn/badge";
import { Button } from "@/ui/shadcn/button";

import { AdminEmpty, AdminError, AdminLoading } from "../../AdminStateViews";
import { useAdminQuery } from "../../useAdminQuery";
import {
  notifyCatalogChange,
  useCatalogRefresh,
} from "./useCatalogRefresh";

type LastByProvider = Record<string, SmokeTestRunUi | null>;

export function SmokeTestClient() {
  const [history, setHistory] = useState<SmokeTestRunUi[]>([]);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [allBusy, setAllBusy] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const providersQ = useAdminQuery(
    "admin-llm-providers-for-smoke",
    async () => {
      const res = await adminLlmProvidersApi.list({ includeInactive: false });
      return res.items.map(adminLlmProviderFromApi);
    },
    [],
  );

  useCatalogRefresh("providers", () => providersQ.refetch());
  useCatalogRefresh("smoke", () => providersQ.refetch());

  const providerDisplayNameByName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of providersQ.data ?? []) map[p.name] = p.displayName;
    return map;
  }, [providersQ.data]);

  const resolveLabel = useCallback(
    (provider: string) => providerDisplayNameByName[provider] ?? providerLabel(provider),
    [providerDisplayNameByName],
  );

  const lastByProvider = useMemo<LastByProvider>(() => {
    const map: LastByProvider = {};
    for (const p of providersQ.data ?? []) {
      const ui = mapProviderSmokeToUi(p);
      if (ui) map[p.name] = ui;
    }
    return map;
  }, [providersQ.data]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const res = await adminSmokeTestApi.history();
      const mapped = res.items.map((item) => mapSmokeTestRun(item, resolveLabel));
      setHistory(mapped);
    } catch (e) {
      setHistory([]);
      setHistoryError(
        e instanceof ApiError ? e.message : "Не удалось загрузить историю",
      );
    } finally {
      setHistoryLoading(false);
    }
  }, [resolveLabel]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const handleRun = useCallback(
    async (provider: AdminLlmProviderDomain) => {
      setBusy((b) => ({ ...b, [provider.name]: true }));
      try {
        const run = await adminSmokeTestApi.run(provider.name);
        const ui = mapSmokeTestRun(run, resolveLabel);
        toast.success(
          `${ui.providerLabel}: ${ui.statusLabel} · ${ui.latencyLabel}`,
        );
        await providersQ.refetch();
        await loadHistory();
        notifyCatalogChange("smoke");
      } catch (e) {
        toast.error(
          e instanceof ApiError ? e.message : "Не удалось запустить smoke-тест",
        );
      } finally {
        setBusy((b) => ({ ...b, [provider.name]: false }));
      }
    },
    [loadHistory, providersQ, resolveLabel],
  );

  const handleRunAll = useCallback(async () => {
    setAllBusy(true);
    try {
      const res = await adminSmokeTestApi.runAll();
      toast.success(`Smoke-тесты выполнены: ${res.items.length}`);
      await providersQ.refetch();
      await loadHistory();
      notifyCatalogChange("smoke");
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : "Не удалось запустить smoke-тесты",
      );
    } finally {
      setAllBusy(false);
    }
  }, [loadHistory, providersQ, resolveLabel]);

  const providers = providersQ.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-lg border border-border-subtle bg-bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-fg-primary">
              Smoke-тесты провайдеров
            </h2>
            <p className="text-xs text-fg-secondary">
              Минимальный запрос к каждому активному провайдеру из реестра для
              проверки доступности и латентности.
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => void handleRunAll()}
            disabled={allBusy || providers.length === 0}
          >
            {allBusy ? (
              <Loader2 size={14} className="mr-1 animate-spin" />
            ) : (
              <PlayCircle size={14} className="mr-1" />
            )}
            Запустить все
          </Button>
        </div>

        {providersQ.isLoading && <AdminLoading rows={3} />}
        {!providersQ.isLoading && providersQ.error && (
          <AdminError message={providersQ.error} onRetry={providersQ.refetch} />
        )}
        {!providersQ.isLoading && !providersQ.error && providers.length === 0 && (
          <AdminEmpty
            title="Активных провайдеров нет"
            description="Добавьте и активируйте провайдера на вкладке «Провайдеры», чтобы запускать smoke-тесты."
          />
        )}
        {!providersQ.isLoading && !providersQ.error && providers.length > 0 && (
          <div className="overflow-hidden rounded border border-border-subtle">
            <table className="w-full text-sm">
              <thead className="bg-bg-subtle text-xs uppercase text-fg-secondary">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Провайдер</th>
                  <th className="px-3 py-2 text-left font-medium">Статус</th>
                  <th className="px-3 py-2 text-left font-medium">Ответ</th>
                  <th className="px-3 py-2 text-right font-medium">Время</th>
                  <th className="px-3 py-2 text-right font-medium">Действие</th>
                </tr>
              </thead>
              <tbody>
                {providers.map((p) => {
                  const last = lastByProvider[p.name];
                  return (
                    <tr key={p.id} className="border-t border-border-subtle">
                      <td className="px-3 py-2">
                        <div className="font-medium text-fg-primary">
                          {p.displayName}
                        </div>
                        <div className="font-mono text-[10px] text-fg-tertiary">
                          {p.name}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        {last ? (
                          <Badge
                            variant="outline"
                            className={
                              last.statusTone === "success"
                                ? "border-chip-success-bg bg-chip-success-bg text-chip-success-fg"
                                : "border-chip-danger-bg bg-chip-danger-bg text-chip-danger-fg"
                            }
                          >
                            {last.statusLabel}
                          </Badge>
                        ) : (
                          <span className="text-xs text-fg-tertiary">
                            — не запускали —
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-fg-secondary">
                        {last?.message ? (
                          <span className="line-clamp-2 max-w-md">
                            {last.message}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-xs text-fg-secondary">
                        {last ? last.ranAtLabel : "—"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={Boolean(busy[p.name]) || allBusy}
                          onClick={() => void handleRun(p)}
                        >
                          {busy[p.name] ? (
                            <Loader2 size={12} className="mr-1 animate-spin" />
                          ) : (
                            <Zap size={12} className="mr-1" />
                          )}
                          Запустить
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border-subtle bg-bg-card p-4">
        <h2 className="mb-3 text-base font-semibold text-fg-primary">
          История запусков
        </h2>

        {historyLoading && (
          <div className="flex items-center gap-2 py-4 text-sm text-fg-secondary">
            <Loader2 size={14} className="animate-spin" /> Загружаем…
          </div>
        )}

        {!historyLoading && historyError && (
          <p className="rounded border border-danger/30 bg-danger/5 p-2 text-xs text-danger">
            {historyError}
          </p>
        )}

        {!historyLoading && !historyError && history.length === 0 && (
          <AdminEmpty
            title="История пуста"
            description="Запустите smoke-тест любого провайдера, чтобы увидеть здесь запись."
          />
        )}

        {!historyLoading && history.length > 0 && (
          <div className="overflow-hidden rounded border border-border-subtle">
            <table className="w-full text-sm">
              <thead className="bg-bg-subtle text-xs uppercase text-fg-secondary">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Время</th>
                  <th className="px-3 py-2 text-left font-medium">Провайдер</th>
                  <th className="px-3 py-2 text-left font-medium">Статус</th>
                  <th className="px-3 py-2 text-right font-medium">
                    Латентность
                  </th>
                  <th className="px-3 py-2 text-left font-medium">Сообщение</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.id} className="border-t border-border-subtle">
                    <td className="px-3 py-2 font-mono text-xs text-fg-secondary">
                      {row.ranAtLabel}
                    </td>
                    <td className="px-3 py-2">{row.providerLabel}</td>
                    <td className="px-3 py-2">
                      <Badge
                        variant="outline"
                        className={
                          row.statusTone === "success"
                            ? "border-chip-success-bg bg-chip-success-bg text-chip-success-fg"
                            : "border-chip-danger-bg bg-chip-danger-bg text-chip-danger-fg"
                        }
                      >
                        {row.statusLabel}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-fg-secondary">
                      {row.latencyLabel}
                    </td>
                    <td className="px-3 py-2 text-xs text-fg-secondary">
                      {row.message ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
