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
import { Input } from "@/ui/shadcn/input";
import { Label } from "@/ui/shadcn/label";

function toLocalInputValue(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

export function ExtendGrantDialog({
  orgId,
  grant,
  onClose,
  onUpdated,
}: {
  orgId: string;
  grant: AccessGrant;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [makeUnlimited, setMakeUnlimited] = useState(grant.expiresAt === null);
  const [expiresAtInput, setExpiresAtInput] = useState<string>(
    grant.expiresAt ? toLocalInputValue(grant.expiresAt) : "",
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    let payload: { expiresAt: string | null };

    if (makeUnlimited) {
      payload = { expiresAt: null };
    } else {
      if (!expiresAtInput.trim()) {
        setError("Укажите новый срок или включите «Бессрочно»");
        return;
      }
      const parsed = new Date(expiresAtInput);
      if (Number.isNaN(parsed.getTime())) {
        setError("Неверный формат даты");
        return;
      }
      if (parsed.getTime() <= Date.now()) {
        setError("Дата истечения должна быть в будущем");
        return;
      }
      payload = { expiresAt: parsed.toISOString() };
    }

    setSubmitting(true);
    try {
      await adminClonesApi.extendAccessGrant(orgId, grant.id, payload);
      toast.success(
        makeUnlimited ? "Грант стал бессрочным" : "Срок гранта обновлён",
      );
      onUpdated();
    } catch (e) {
      const msg =
        e instanceof ApiError ? e.message : "Не удалось обновить срок";
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
          <DialogTitle>Изменить срок гранта</DialogTitle>
          <DialogDescription>
            Грант для{" "}
            <strong className="text-fg-primary">
              {grant.grantedTo.userName}
            </strong>{" "}
            на клон{" "}
            <strong className="text-fg-primary">{grant.cloneLabel}</strong>.
            Текущий срок:{" "}
            {grant.expiresAt
              ? grant.expiresAt.toLocaleString("ru-RU")
              : "бессрочно"}
            .
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={makeUnlimited}
              onChange={(e) => setMakeUnlimited(e.target.checked)}
              className="h-4 w-4 rounded border-border"
            />
            Сделать бессрочным
          </label>

          {!makeUnlimited && (
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Новый срок</Label>
              <Input
                type="datetime-local"
                value={expiresAtInput}
                onChange={(e) => setExpiresAtInput(e.target.value)}
              />
            </div>
          )}

          {error && (
            <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </div>
          )}
        </div>

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
            size="sm"
            onClick={() => void handleSubmit()}
            disabled={submitting}
          >
            {submitting ? (
              <>
                <Loader2 size={14} className="mr-1 animate-spin" /> Сохраняем…
              </>
            ) : (
              "Сохранить"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
