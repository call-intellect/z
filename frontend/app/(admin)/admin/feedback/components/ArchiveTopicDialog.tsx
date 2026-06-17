"use client";

import { useEffect, useState } from "react";
import { Archive, ArchiveRestore } from "lucide-react";
import { toast } from "sonner";

import { ApiError } from "@/api/api-error";
import { adminFeedbackApi } from "@/api/admin-feedback.api";
import { Button } from "@/ui/shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/shadcn/dialog";

export type ArchiveTopicDialogMode = "archive" | "unarchive";

interface ArchiveTopicDialogProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  topicId: string;
  topicTitle: string;
  mode: ArchiveTopicDialogMode;
  onSaved: () => void;
}

export function ArchiveTopicDialog({
  open,
  onOpenChange,
  topicId,
  topicTitle,
  mode,
  onSaved,
}: ArchiveTopicDialogProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
  }, [open]);

  const isArchive = mode === "archive";
  const title = isArchive ? "Архивировать блок?" : "Восстановить блок?";
  const description = isArchive
    ? `Блок «${topicTitle}» будет скрыт из активного списка дашборда. Items сохранятся, восстановить можно позже.`
    : `Блок «${topicTitle}» вернётся в активный список дашборда и снова будет участвовать в метриках за выбранное окно.`;
  const confirmLabel = isArchive ? "Архивировать" : "Восстановить";
  const pendingLabel = isArchive ? "Архивируем…" : "Восстанавливаем…";

  async function handleConfirm() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      if (isArchive) {
        await adminFeedbackApi.archiveTopic(topicId);
      } else {
        await adminFeedbackApi.unarchiveTopic(topicId);
      }
      toast.success("Готово");
      onSaved();
      onOpenChange(false);
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : isArchive
              ? "Не удалось архивировать блок"
              : "Не удалось восстановить блок";
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (saving) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {error && (
          <p
            className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
            role="alert"
          >
            {error}
          </p>
        )}

        <DialogFooter className="sm:gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            Отмена
          </Button>
          <Button
            type="button"
            size="sm"
            variant={isArchive ? "destructive" : "default"}
            disabled={saving}
            onClick={() => void handleConfirm()}
          >
            {isArchive ? <Archive size={14} /> : <ArchiveRestore size={14} />}
            {saving ? pendingLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
