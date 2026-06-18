"use client";

import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";

import {
  adminPromptTemplatesApi,
  type PromptVersionApi,
} from "@/api/admin-prompt-templates.api";
import { ApiError } from "@/api/api-error";
import { toast } from "sonner";
import { useConfirmDialog } from "@/ui/components/shared/useConfirmDialog";
import { Badge } from "@/ui/shadcn/badge";
import { Button } from "@/ui/shadcn/button";

export function PromptVersionsTab({
  templateId,
  versions,
  activeVersionId,
  onActivated,
}: {
  templateId: string;
  versions: PromptVersionApi[];
  activeVersionId: string | null;
  onActivated: () => void;
}) {
  const [activating, setActivating] = useState<string | null>(null);
  const { ask, dialog: confirmDialog } = useConfirmDialog();

  const activate = async (versionId: string) => {
    const ok = await ask({
      title: "Активировать эту версию?",
      description:
        "Все новые встречи начнут использовать её для генерации отчётов.",
      confirmLabel: "Активировать",
    });
    if (!ok) return;
    setActivating(versionId);
    try {
      await adminPromptTemplatesApi.activateVersion(templateId, versionId);
      toast.success("Версия активирована");
      onActivated();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Не удалось активировать";
      toast.error(msg);
    } finally {
      setActivating(null);
    }
  };

  if (versions.length === 0) {
    return (
      <>
        <div className="rounded-md border border-dashed border-border-subtle p-8 text-center text-sm text-fg-secondary">
          Версий ещё нет. Создайте первую в редакторе.
        </div>
        {confirmDialog}
      </>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border-subtle bg-bg-card">
      <table className="w-full text-sm">
        <thead className="bg-bg-subtle text-xs uppercase text-fg-secondary">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Версия</th>
            <th className="px-3 py-2 text-left font-medium">Дата</th>
            <th className="px-3 py-2 text-left font-medium">Заметки</th>
            <th className="px-3 py-2 text-right font-medium">Действия</th>
          </tr>
        </thead>
        <tbody>
          {versions.map((v) => {
            const isActive = v.id === activeVersionId;
            return (
              <tr key={v.id} className="border-t border-border-subtle">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-fg-primary">
                      Версия №{v.versionNumber}
                    </span>
                    {isActive && (
                      <Badge
                        variant="outline"
                        className="border-chip-success-bg bg-chip-success-bg text-chip-success-fg"
                      >
                        <CheckCircle2 size={10} className="mr-1" /> Активная
                      </Badge>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 text-fg-secondary">
                  {new Date(v.createdAt).toLocaleString("ru-RU")}
                </td>
                <td className="px-3 py-2 text-fg-secondary">
                  {v.notes ?? "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  {isActive ? (
                    <span className="text-xs text-fg-secondary">текущая</span>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => activate(v.id)}
                      disabled={activating === v.id}
                    >
                      {activating === v.id && (
                        <Loader2 size={12} className="mr-1 animate-spin" />
                      )}
                      Активировать
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {confirmDialog}
    </div>
  );
}
