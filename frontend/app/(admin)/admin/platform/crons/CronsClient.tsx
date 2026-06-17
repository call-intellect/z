"use client";

import { useMemo, useState } from "react";
import { Loader2, Pencil, Play, AlertCircle } from "lucide-react";
import { toast } from "sonner";

import { adminCronsApi } from "@/api/admin-crons.api";
import { ApiError } from "@/api/api-error";
import {
  cronScheduleFromApi,
  type CronScheduleDomain,
} from "@/domain/admin-cron";
import { AdminSection } from "@/ui/components/admin/AdminSection";
import { Badge } from "@/ui/shadcn/badge";
import { Button } from "@/ui/shadcn/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/shadcn/select";
import { Switch } from "@/ui/shadcn/switch";

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
  AdminLoading,
} from "../../AdminStateViews";
import { useAdminQuery } from "../../useAdminQuery";
import { CronEditDialog } from "./CronEditDialog";
import { adminRootCrumb } from "@/ui/components/admin/brand";

type StatusFilter = "all" | "disabled" | "error";

export function CronsClient() {
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [editing, setEditing] = useState<CronScheduleDomain | null>(null);
  const [runningName, setRunningName] = useState<string | null>(null);

  const q = useAdminQuery("admin-platform-crons", async () => {
    const res = await adminCronsApi.list();
    return res.map(cronScheduleFromApi);
  });

  const filtered = useMemo(() => {
    if (!q.data) return [];
    return q.data.filter((c) => {
      if (filter === "disabled") return !c.enabled;
      if (filter === "error") {
        return Boolean(c.lastRunError) || c.lastRun?.status === "failed";
      }
      return true;
    });
  }, [q.data, filter]);

  const handleToggleEnabled = async (cron: CronScheduleDomain) => {
    try {
      await adminCronsApi.update(cron.name, { enabled: !cron.enabled });
      toast.success(
        !cron.enabled
          ? `Крон «${cron.name}» включён`
          : `Крон «${cron.name}» выключен`,
      );
      q.refetch();
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Не удалось обновить статус";
      toast.error(msg);
    }
  };

  const handleRunNow = async (cron: CronScheduleDomain) => {
    if (runningName) return;
    setRunningName(cron.name);
    try {
      await adminCronsApi.runNow(cron.name);
      toast.success(`Крон «${cron.name}» запущен`);
      q.refetch();
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Не удалось запустить крон";
      toast.error(msg);
    } finally {
      setRunningName(null);
    }
  };

  return (
    <AdminSection
      breadcrumbs={[
        adminRootCrumb(),
        { label: "Платформа" },
        { label: "Кроны" },
      ]}
      title="Расписания @Cron"
      description="Все @Cron-задачи из кода. Поведение во всех процессах синхронизируется через Redis pub/sub. Изменение расписания требует причину (журнал super_admin)."
      actions={
        <div className="flex items-center gap-2">
          <Select
            value={filter}
            onValueChange={(v) => setFilter(v as StatusFilter)}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все кроны</SelectItem>
              <SelectItem value="disabled">Только выключенные</SelectItem>
              <SelectItem value="error">Только с ошибкой</SelectItem>
            </SelectContent>
          </Select>
        </div>
      }
    >
      {q.isLoading && <AdminLoading rows={6} />}
      {!q.isLoading && q.isForbidden && <AdminForbidden />}
      {!q.isLoading && q.error && (
        <AdminError message={q.error} onRetry={q.refetch} />
      )}
      {!q.isLoading && !q.error && !q.isForbidden && !q.data ? (
        <AdminEmpty
          title="Кроны недоступны"
          description="Эндпоинт /api/v1/admin/crons вернул пустой ответ. Проверьте, что CronManagerService инициализировался без ошибок."
        />
      ) : null}
      {!q.isLoading && q.data && q.data.length === 0 ? (
        <AdminEmpty
          title="Кроны не зарегистрированы"
          description="Ни одного @Cron-обработчика не найдено. Если ожидаете записи — проверьте логи CronManagerService."
        />
      ) : null}
      {!q.isLoading && q.data && q.data.length > 0 ? (
        <CronsTable
          rows={filtered}
          runningName={runningName}
          onEdit={(c) => setEditing(c)}
          onToggle={(c) => void handleToggleEnabled(c)}
          onRun={(c) => void handleRunNow(c)}
        />
      ) : null}

      <CronEditDialog
        cron={editing}
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        onSaved={() => {
          q.refetch();
          setEditing(null);
        }}
      />
    </AdminSection>
  );
}

function CronsTable({
  rows,
  runningName,
  onEdit,
  onToggle,
  onRun,
}: {
  rows: CronScheduleDomain[];
  runningName: string | null;
  onEdit: (c: CronScheduleDomain) => void;
  onToggle: (c: CronScheduleDomain) => void;
  onRun: (c: CronScheduleDomain) => void;
}) {
  if (rows.length === 0) {
    return (
      <AdminEmpty
        title="Под фильтр ничего не подошло"
        description="Поменяйте фильтр или сбросьте на «Все кроны»."
      />
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border-subtle">
      <table className="w-full text-sm">
        <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-fg-tertiary">
          <tr>
            <th className="px-3 py-2 text-left">Имя</th>
            <th className="px-3 py-2 text-left">Расписание</th>
            <th className="px-3 py-2 text-center">Включён</th>
            <th className="px-3 py-2 text-left">Последний запуск</th>
            <th className="px-3 py-2 text-right">Длит.</th>
            <th className="px-3 py-2 text-left">Ошибка</th>
            <th className="px-3 py-2 text-right">Действия</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <CronRow
              key={c.name}
              cron={c}
              isRunning={runningName === c.name}
              onEdit={() => onEdit(c)}
              onToggle={() => onToggle(c)}
              onRun={() => onRun(c)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CronRow({
  cron,
  isRunning,
  onEdit,
  onToggle,
  onRun,
}: {
  cron: CronScheduleDomain;
  isRunning: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onRun: () => void;
}) {
  const lastStatus = cron.lastRun?.status ?? null;
  const hasError = Boolean(cron.lastRunError) || lastStatus === "failed";
  const expressionChanged =
    cron.expression !== cron.defaultExpression && cron.defaultExpression;

  return (
    <tr className="border-t border-border-subtle align-top hover:bg-bg-overlay">
      <td className="px-3 py-3">
        <div className="flex flex-col">
          <span className="font-mono text-xs font-medium text-fg-primary">
            {cron.name}
          </span>
          {cron.description ? (
            <span className="text-[11px] text-fg-tertiary">
              {cron.description}
            </span>
          ) : null}
        </div>
      </td>
      <td className="px-3 py-3">
        <div className="flex flex-col">
          <span className="font-mono text-xs">{cron.expression}</span>
          {cron.humanReadable && cron.humanReadable !== cron.expression ? (
            <span className="text-[11px] text-fg-tertiary">
              {cron.humanReadable}
            </span>
          ) : null}
          {expressionChanged ? (
            <Badge variant="warning" className="mt-1 w-fit text-[10px]">
              переопределён
            </Badge>
          ) : null}
        </div>
      </td>
      <td className="px-3 py-3 text-center">
        <Switch checked={cron.enabled} onCheckedChange={onToggle} />
      </td>
      <td className="px-3 py-3 text-xs text-fg-secondary">
        {cron.lastRunAt ? cron.lastRunAt.toLocaleString("ru-RU") : "—"}
        {lastStatus ? (
          <Badge
            variant={
              lastStatus === "failed"
                ? "danger"
                : lastStatus === "running"
                  ? "secondary"
                  : "default"
            }
            className="ml-2 text-[10px]"
          >
            {lastStatus === "success"
              ? "успех"
              : lastStatus === "failed"
                ? "ошибка"
                : lastStatus === "running"
                  ? "выполняется"
                  : lastStatus}
          </Badge>
        ) : null}
      </td>
      <td className="px-3 py-3 text-right tabular-nums text-xs text-fg-secondary">
        {cron.lastRunDurationMs !== null ? `${cron.lastRunDurationMs} мс` : "—"}
      </td>
      <td className="px-3 py-3 text-xs">
        {hasError ? (
          <span
            className="inline-flex items-center gap-1 text-danger"
            title={cron.lastRunError ?? cron.lastRun?.error ?? undefined}
          >
            <AlertCircle size={12} aria-hidden />
            <span className="max-w-[200px] truncate">
              {cron.lastRunError ?? cron.lastRun?.error ?? "—"}
            </span>
          </span>
        ) : (
          "—"
        )}
      </td>
      <td className="px-3 py-3 text-right">
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onRun}
            disabled={isRunning}
            title="Запустить сейчас"
          >
            {isRunning ? (
              <Loader2 size={13} className="animate-spin" aria-hidden />
            ) : (
              <Play size={13} aria-hidden />
            )}
            <span className="ml-1 hidden sm:inline">Запустить</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onEdit}
            title="Изменить расписание"
          >
            <Pencil size={13} aria-hidden />
            <span className="ml-1 hidden sm:inline">Изменить</span>
          </Button>
        </div>
      </td>
    </tr>
  );
}
