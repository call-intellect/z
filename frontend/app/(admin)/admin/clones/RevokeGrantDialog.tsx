"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { ApiError } from "@/api/api-error";
import { adminClonesApi } from "@/api/admin-clones.api";
import type { AccessGrant } from "@/domain/admin-clone-access-grant";
import { Button } from "@/ui/shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/shadcn/dialog";

export function RevokeGrantDialog({
  orgId,
  grant,
  onClose,
  onRevoked,
}: {
  orgId: string;
  grant: AccessGrant;
  onClose: () => void;
  onRevoked: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRevoke = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await adminClonesApi.revokeAccessGrant(orgId, grant.id);
      toast.success("Доступ отозван");
      onRevoked();
    } catch (e) {
      const msg =
        e instanceof ApiError ? e.message : "Не удалось отозвать грант";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => (!o && !submitting ? onClose() : undefined)}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Отозвать доступ?</DialogTitle>
          <DialogDescription>
            Сотрудник{" "}
            <strong className="text-fg-primary">
              {grant.grantedTo.userName}
            </strong>{" "}
            сразу потеряет возможность задавать вопросы клону{" "}
            <strong className="text-fg-primary">{grant.cloneLabel}</strong>.
            Запись о выдаче и отзыве сохранится в журнале действий.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={submitting}
          >
            Отмена
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => void handleRevoke()}
            disabled={submitting}
          >
            {submitting ? (
              <>
                <Loader2 size={14} className="mr-1 animate-spin" /> Отзываем…
              </>
            ) : (
              "Отозвать доступ"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
