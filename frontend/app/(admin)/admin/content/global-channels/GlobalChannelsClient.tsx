"use client";

import { useState } from "react";
import { Edit3, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ApiError } from "@/api/api-error";
import { adminGlobalChannelsApi } from "@/api/admin-global-channels.api";
import {
  GLOBAL_CHANNEL_KIND_LABELS,
  GLOBAL_CHANNEL_STATUS_LABELS,
  globalChannelListFromApi,
  type GlobalChannelItemDomain,
} from "@/domain/admin-global-channel";
import { AdminSection } from "@/ui/components/admin/AdminSection";
import { Badge } from "@/ui/shadcn/badge";
import { Button } from "@/ui/shadcn/button";

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
  AdminLoading,
} from "../../AdminStateViews";
import { useAdminQuery } from "../../useAdminQuery";
import { ChannelEditDialog } from "./ChannelEditDialog";
import { adminRootCrumb } from "@/ui/components/admin/brand";

export function GlobalChannelsClient() {
  const [editing, setEditing] = useState<GlobalChannelItemDomain | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const q = useAdminQuery("admin-global-channels", async () => {
    const res = await adminGlobalChannelsApi.list();
    return globalChannelListFromApi(res);
  });

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (c: GlobalChannelItemDomain) => {
    setEditing(c);
    setDialogOpen(true);
  };

  const remove = async (c: GlobalChannelItemDomain) => {
    try {
      await adminGlobalChannelsApi.remove(c.id);
      toast.success("Канал деактивирован");
      q.refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Не удалось удалить");
    }
  };

  return (
    <AdminSection
      breadcrumbs={[
        adminRootCrumb(),
        { label: "Контент" },
        { label: "Глобальные каналы" },
      ]}
      title="Глобальные каналы"
      description="Каналы без привязки к Org (tenantId IS NULL): глобальный Telegram-бот @kora_bot, общий SMTP, etc. На один kind допустим ровно один глобальный канал."
      actions={
        <Button onClick={openCreate} size="sm">
          <Plus size={14} /> Создать канал
        </Button>
      }
    >
      {q.isLoading && <AdminLoading rows={4} />}
      {!q.isLoading && q.isForbidden && <AdminForbidden />}
      {!q.isLoading && q.error && (
        <AdminError message={q.error} onRetry={q.refetch} />
      )}
      {!q.isLoading &&
        q.data &&
        (q.data.items.length === 0 ? (
          <AdminEmpty
            title="Глобальных каналов нет"
            description="Создайте первый канал через кнопку «Создать канал»."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border-subtle">
            <table className="w-full text-sm">
              <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-fg-tertiary">
                <tr>
                  <th className="px-3 py-2 text-left">Id</th>
                  <th className="px-3 py-2 text-left">Тип</th>
                  <th className="px-3 py-2 text-left">Статус</th>
                  <th className="px-3 py-2 text-left">Config preview</th>
                  <th className="px-3 py-2 text-right">Подписчики</th>
                  <th className="px-3 py-2 text-left">Действия</th>
                </tr>
              </thead>
              <tbody>
                {q.data.items.map((c) => (
                  <ChannelRow
                    key={c.id}
                    item={c}
                    onEdit={() => openEdit(c)}
                    onRemove={() => void remove(c)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ))}

      <ChannelEditDialog
        item={editing}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSaved={() => {
          q.refetch();
        }}
      />
    </AdminSection>
  );
}

function ChannelRow({
  item,
  onEdit,
  onRemove,
}: {
  item: GlobalChannelItemDomain;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const statusVariant: "success" | "warning" | "danger" | "secondary" =
    item.status === "active"
      ? "success"
      : item.status === "broken"
        ? "danger"
        : item.status === "disabled"
          ? "secondary"
          : "secondary";
  const configPreview = JSON.stringify(item.config);

  return (
    <tr className="border-t border-border-subtle align-top hover:bg-bg-overlay">
      <td className="px-3 py-3">
        <code className="rounded bg-bg-overlay px-1.5 py-0.5 text-[10px]">
          {item.id}
        </code>
      </td>
      <td className="px-3 py-3 font-medium">
        {GLOBAL_CHANNEL_KIND_LABELS[item.kind] ?? item.kind}
        <div className="text-[10px] text-fg-tertiary">{item.kind}</div>
      </td>
      <td className="px-3 py-3">
        <Badge variant={statusVariant} className="text-[10px]">
          {GLOBAL_CHANNEL_STATUS_LABELS[item.status] ?? item.status}
        </Badge>
        {item.brokenReason && (
          <p className="mt-1 text-[10px] text-danger">{item.brokenReason}</p>
        )}
      </td>
      <td className="max-w-[280px] px-3 py-3 text-[11px] font-mono text-fg-tertiary">
        <span className="line-clamp-2">
          {configPreview.length > 2 ? configPreview : "—"}
        </span>
      </td>
      <td className="px-3 py-3 text-right tabular-nums">
        {item.subscribersCount}
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onEdit}
            title="Редактировать"
          >
            <Edit3 size={14} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onRemove}
            className="text-danger hover:bg-danger/10"
            title="Удалить (soft)"
          >
            <Trash2 size={14} />
          </Button>
        </div>
      </td>
    </tr>
  );
}
