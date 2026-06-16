"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import {
  VIEW_VISIBILITY_LABEL_RU,
  type TableViewDomain,
  type TableViewVisibility,
} from "@/domain/table";
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

import { useTableStore } from "../store/tableStore";

export function SaveViewDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onSaved?: (view: TableViewDomain) => void;
}) {
  const saveCurrentAsView = useTableStore((s) => s.saveCurrentAsView);
  const isMutating = useTableStore((s) => s.isMutating);
  const mutationError = useTableStore((s) => s.mutationError);

  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<TableViewVisibility>("personal");

  useEffect(() => {
    if (open) {
      setName("");
      setVisibility("personal");
    }
  }, [open]);

  const trimmed = name.trim();
  const canSubmit = trimmed.length >= 1 && trimmed.length <= 100 && !isMutating;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    const view = await saveCurrentAsView(trimmed, visibility);
    if (view) {
      onOpenChange(false);
      onSaved?.(view);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Новый вид</DialogTitle>
            <DialogDescription>
              Сохранит текущее состояние таблицы (скрытые колонки, порядок,
              плотность) как отдельный срез. Каждый вид доступен по своей
              ссылке.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="view-name">Название</Label>
            <Input
              id="view-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например, «Только важное»"
              maxLength={100}
              autoFocus
              required
            />
          </div>

          <div className="space-y-2">
            <Label>Видимость</Label>
            <div
              role="radiogroup"
              aria-label="Кому виден вид"
              className="space-y-2"
            >
              {(["personal", "shared", "public"] as const).map((v) => (
                <label
                  key={v}
                  htmlFor={`view-visibility-${v}`}
                  className="flex cursor-pointer items-start gap-3 rounded-md border border-border-subtle bg-bg-card p-3 transition-colors hover:bg-bg-overlay"
                >
                  <input
                    id={`view-visibility-${v}`}
                    type="radio"
                    name="visibility"
                    value={v}
                    checked={visibility === v}
                    onChange={() => setVisibility(v)}
                    className="mt-0.5 h-4 w-4 accent-accent"
                  />
                  <span className="flex-1 text-sm">
                    <span className="block font-medium text-fg-primary">
                      {VIEW_VISIBILITY_LABEL_RU[v]}
                    </span>
                    <span className="block text-xs text-fg-secondary">
                      {v === "personal"
                        ? "Видите только вы. Другие участники не увидят этот вид в списке."
                        : v === "shared"
                          ? "Вид виден всем участникам организации. Они смогут открыть его по ссылке."
                          : "Доступ по ссылке всем, включая людей вне организации (Фаза 14 — полноценная анонимная ссылка)."}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {mutationError ? (
            <div
              role="alert"
              className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
            >
              {mutationError}
            </div>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isMutating}
            >
              Отмена
            </Button>
            <Button type="submit" disabled={!canSubmit} className="gap-2">
              {isMutating ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : null}
              Сохранить
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
