"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { adminDemoApi, type AdminDemoOrgApi } from "@/api/admin-demo.api";
import { ApiError } from "@/api/api-error";
import { AdminSection } from "@/ui/components/admin/AdminSection";
import { Badge } from "@/ui/shadcn/badge";
import { Button } from "@/ui/shadcn/button";
import { Skeleton } from "@/ui/shadcn/skeleton";

export function DemoClient() {
  const [orgs, setOrgs] = useState<AdminDemoOrgApi[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminDemoApi.listOrgs();
      setOrgs(res.orgs);
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : "Не удалось загрузить список Org.",
      );
      setOrgs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const seed = useCallback(
    async (org: AdminDemoOrgApi) => {
      setBusyId(org.id);
      try {
        const res = await adminDemoApi.seed(org.id);
        const total = Object.values(res.stats ?? {}).reduce((a, b) => a + b, 0);
        toast.success(`Демо залито для «${org.name}» (${total} записей).`);
        await load();
      } catch (err) {
        toast.error(
          err instanceof ApiError ? err.message : "Не удалось залить демо.",
        );
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  const reset = useCallback(
    async (org: AdminDemoOrgApi) => {
      if (
        !window.confirm(
          `Сбросить демо-данные для «${org.name}»? Боевые данные не пострадают.`,
        )
      ) {
        return;
      }
      setBusyId(org.id);
      try {
        await adminDemoApi.reset(org.id);
        toast.success(`Демо сброшено для «${org.name}».`);
        await load();
      } catch (err) {
        toast.error(
          err instanceof ApiError ? err.message : "Не удалось сбросить демо.",
        );
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  return (
    <AdminSection
      title="Демо-кабинеты"
      description="Создание и сброс демо-данных «ТехноСтрим» для любой Org. Демо помечается externalSource='demo' и сбрасывается без вреда боевым данным."
    >
      {loading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : !orgs || orgs.length === 0 ? (
        <p className="text-sm text-fg-secondary">Нет ни одной Org.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {orgs.map((org) => {
            const seeded = org.demoSeededAt !== null;
            const busy = busyId === org.id;
            const isReference = org.isReferenceDemo;
            const actionsDisabled = !isReference;
            const disabledTitle = actionsDisabled
              ? "Демо больше не копируется в каждую Org. Эталон один (выделен бейджем)."
              : undefined;
            return (
              <li
                key={org.id}
                className="flex flex-col gap-3 rounded-lg border border-border-subtle p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-fg-primary">
                      {org.name}
                    </span>
                    {isReference ? (
                      <Badge variant="default">🌟 Эталон</Badge>
                    ) : null}
                    {seeded ? (
                      <Badge variant="secondary">демо залито</Badge>
                    ) : null}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-fg-secondary">
                    Владелец: {org.owner ? org.owner.email : "—"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => void seed(org)}
                    disabled={busy || actionsDisabled}
                    title={disabledTitle}
                  >
                    {busy
                      ? "Заливаем…"
                      : seeded
                        ? "Перезалить демо"
                        : "Создать демо"}
                  </Button>
                  {seeded ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void reset(org)}
                      disabled={busy || actionsDisabled}
                      title={disabledTitle}
                    >
                      Сбросить
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </AdminSection>
  );
}
