"use client";

import { useCallback, type ReactElement } from "react";
import {
  CheckCircle2,
  Loader2,
  Radio,
  Repeat,
  Settings2,
  Video,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { adminLivekitApi } from "@/api/admin-livekit.api";
import {
  livekitOverviewFromApi,
  type LivekitEgressOverviewDomain,
  type LivekitOverviewDomain,
  type LivekitSfuHealthDomain,
  type LivekitTurnHealthDomain,
} from "@/domain/admin-livekit";
import { AdminSection } from "@/ui/components/admin/AdminSection";
import { AdminTabs, type AdminTabDef } from "@/ui/components/admin/AdminTabs";
import { AdminSettingField } from "@/ui/components/admin/AdminSettingField";
import { useAdminSettingEditor } from "@/hooks/useAdminSettingEditor";
import { Badge } from "@/ui/shadcn/badge";
import { Button } from "@/ui/shadcn/button";

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
  AdminLoading,
} from "../../AdminStateViews";
import { useAdminQuery } from "../../useAdminQuery";
import { adminRootCrumb } from "@/ui/components/admin/brand";

const TABS: AdminTabDef[] = [
  { value: "sfu", label: "SFU", icon: Video },
  { value: "egress", label: "Egress", icon: Radio },
  { value: "turn", label: "TURN", icon: Repeat },
  { value: "switch", label: "Переключение", icon: Settings2 },
];

export function LiveKitClient() {
  const q = useAdminQuery("admin-livekit-overview", async () => {
    const res = await adminLivekitApi.overview();
    return livekitOverviewFromApi(res);
  });

  return (
    <AdminSection
      breadcrumbs={[
        adminRootCrumb(),
        { label: "Каналы и интеграции" },
        { label: "LiveKit" },
      ]}
      title="LiveKit health"
      description="Медиа-стек: SFU (сервер встреч), Egress (запись/RTMP), TURN (NAT-traversal). LiveKit — только медиа; вся бизнес-логика на нашем backend."
    >
      {q.isLoading && <AdminLoading rows={4} />}
      {!q.isLoading && q.isForbidden && <AdminForbidden />}
      {!q.isLoading && q.error && (
        <AdminError message={q.error} onRetry={q.refetch} />
      )}
      {!q.isLoading && (q.data || !q.error) ? (
        <AdminTabs tabs={TABS} defaultTab="sfu">
          {(active) => {
            if (active === "sfu")
              return <SfuTab data={q.data?.sfu ?? null} fallback={!q.data} />;
            if (active === "egress")
              return (
                <EgressTab data={q.data?.egress ?? null} fallback={!q.data} />
              );
            if (active === "turn")
              return <TurnTab data={q.data?.turn ?? null} fallback={!q.data} />;
            if (active === "switch") return <SwitchTab overview={q.data} />;
            return null;
          }}
        </AdminTabs>
      ) : null}
    </AdminSection>
  );
}

function SfuTab({
  data,
  fallback,
}: {
  data: LivekitSfuHealthDomain | null;
  fallback: boolean;
}) {
  if (fallback) return <FallbackEmpty section="SFU" />;
  if (!data) {
    return (
      <AdminEmpty
        title="SFU недоступен"
        description="LiveKit Server не отвечает на health-probe."
      />
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <KpiCard
        label="Активные комнаты"
        value={data.activeRooms.toString()}
        accent="primary"
      />
      <KpiCard
        label="Участники"
        value={data.totalParticipants.toString()}
        accent="primary"
      />
      <KpiCard
        label="Нагрузка сервера"
        value={
          data.serverLoad !== null
            ? `${Math.round(data.serverLoad * 100)}%`
            : "—"
        }
        accent={
          data.serverLoad !== null && data.serverLoad >= 0.8
            ? "danger"
            : "primary"
        }
      />
      <KpiCard
        label="Достижим"
        value={data.reachable ? "да" : "нет"}
        accent={data.reachable ? "success" : "danger"}
      />
      <KpiCard label="Версия" value={data.version ?? "—"} accent="muted" />
      <KpiCard
        label="Проверено"
        value={data.checkedAt.toLocaleString("ru-RU")}
        accent="muted"
      />
    </div>
  );
}

function EgressTab({
  data,
  fallback,
}: {
  data: LivekitEgressOverviewDomain | null;
  fallback: boolean;
}) {
  if (fallback) return <FallbackEmpty section="Egress" />;
  if (!data) {
    return (
      <AdminEmpty
        title="Egress недоступен"
        description="LiveKit Egress не отвечает."
      />
    );
  }
  if (data.activeJobs.length === 0) {
    return (
      <AdminEmpty
        title="Нет активных egress-job"
        description="Записи и RTMP-потоки сейчас не идут."
      />
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border-subtle">
      <table className="w-full text-sm">
        <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-fg-tertiary">
          <tr>
            <th className="px-3 py-2 text-left">Id</th>
            <th className="px-3 py-2 text-left">Тип</th>
            <th className="px-3 py-2 text-left">Статус</th>
            <th className="px-3 py-2 text-left">Комната</th>
            <th className="px-3 py-2 text-left">Назначение</th>
            <th className="px-3 py-2 text-left">Начато</th>
          </tr>
        </thead>
        <tbody>
          {data.activeJobs.map((job) => (
            <tr
              key={job.id}
              className="border-t border-border-subtle align-top hover:bg-bg-overlay"
            >
              <td
                className="max-w-[200px] truncate px-3 py-2 font-mono text-xs"
                title={job.id}
              >
                {job.id}
              </td>
              <td className="px-3 py-2 text-xs">{job.type}</td>
              <td className="px-3 py-2 text-xs">
                <Badge variant="secondary">{job.status}</Badge>
              </td>
              <td className="px-3 py-2 text-xs">{job.roomName ?? "—"}</td>
              <td
                className="max-w-[260px] truncate px-3 py-2 font-mono text-xs"
                title={job.destination ?? ""}
              >
                {job.destination ?? "—"}
              </td>
              <td className="px-3 py-2 text-xs text-fg-tertiary">
                {job.startedAt ? job.startedAt.toLocaleString("ru-RU") : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TurnTab({
  data,
  fallback,
}: {
  data: LivekitTurnHealthDomain | null;
  fallback: boolean;
}) {
  if (fallback) return <FallbackEmpty section="TURN" />;
  if (!data) {
    return (
      <AdminEmpty
        title="TURN недоступен"
        description="Сервер TURN не отвечает на ping."
      />
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <KpiCard label="Режим" value={data.modeLabel} accent="primary" />
      <KpiCard label="Host" value={data.host ?? "—"} accent="muted" />
      <KpiCard
        label="Достижим"
        value={data.reachable ? "да" : "нет"}
        accent={data.reachable ? "success" : "danger"}
      />
      <KpiCard
        label="Ping"
        value={data.pingMs !== null ? `${data.pingMs} мс` : "—"}
        accent={
          data.pingMs !== null && data.pingMs > 200 ? "warning" : "primary"
        }
      />
      <KpiCard
        label="Проверено"
        value={data.checkedAt.toLocaleString("ru-RU")}
        accent="muted"
      />
    </div>
  );
}

const TURN_MODE_SCHEMA = z.enum(["builtin", "external"]);

function SwitchTab({ overview }: { overview: LivekitOverviewDomain | null }) {
  const editor = useAdminSettingEditor<"builtin" | "external">(
    "livekit.turn_mode",
    {
      schema: TURN_MODE_SCHEMA,
      defaultValue: overview?.turn?.mode ?? "builtin",
      requiresReason: "high",
    },
  );

  const handleSave = useCallback(async () => {
    try {
      const reason = window.prompt(
        "Укажите причину смены TURN-режима (минимум 10 символов):",
      );
      if (!reason) return;
      await editor.save(reason);
      toast.success(
        "Режим TURN сохранён. Все процессы подхватят настройку в течение 30 секунд.",
      );
    } catch (e) {
      if (e instanceof Error) {
        toast.error(e.message);
      }
    }
  }, [editor]);

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
        Смена режима TURN затрагивает все идущие встречи: установленные
        соединения будут переподключены при следующем NAT-rebind. Делайте это в
        окно maintenance.
      </div>
      <div className="rounded-xl border border-border-subtle bg-bg-elevated p-4">
        <AdminSettingField
          schema={TURN_MODE_SCHEMA}
          value={editor.value}
          onChange={editor.setValue}
          label="Режим TURN"
          description="builtin — встроенный в LiveKit, external — отдельный coturn-сервер."
          disabled={editor.isLoading}
          error={editor.error ?? undefined}
        />
        <div className="mt-3 flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!editor.isDirty || editor.isSaving}
            onClick={() => void handleSave()}
          >
            {editor.isSaving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : null}
            Сохранить
          </Button>
          {editor.isDirty ? (
            <Button size="sm" variant="ghost" onClick={editor.reset}>
              Отменить
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function FallbackEmpty({ section }: { section: string }) {
  return (
    <AdminEmpty
      title={`Раздел «${section}» недоступен`}
      description="Backend-эндпоинт /api/v1/admin/integrations/livekit ещё не реализован. Управление перейдёт сюда после Фазы 6 (backend)."
    />
  );
}

type KpiAccent = "primary" | "success" | "danger" | "warning" | "muted";

function KpiCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: KpiAccent;
}) {
  const colorMap: Record<KpiAccent, string> = {
    primary: "text-fg-primary",
    success: "text-success",
    danger: "text-danger",
    warning: "text-warning",
    muted: "text-fg-secondary",
  };
  const iconMap: Record<KpiAccent, ReactElement | null> = {
    primary: null,
    success: <CheckCircle2 size={14} className="text-success" />,
    danger: <XCircle size={14} className="text-danger" />,
    warning: null,
    muted: null,
  };
  return (
    <div className="rounded-xl border border-border-subtle bg-bg-elevated p-4">
      <div className="text-xs uppercase tracking-wide text-fg-tertiary">
        {label}
      </div>
      <div
        className={`mt-1 flex items-center gap-2 text-lg font-semibold ${colorMap[accent]}`}
      >
        {iconMap[accent]}
        <span className="truncate">{value}</span>
      </div>
    </div>
  );
}
