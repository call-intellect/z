"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";

import { themesApi } from "@/api/themes.api";
import { ApiError, humanizeApiError } from "@/api/api-error";
import type { ThemeVisibility } from "@/domain/theme";
import { Button } from "@/ui/shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/shadcn/dialog";
import { Label } from "@/ui/shadcn/label";
import { Textarea } from "@/ui/shadcn/textarea";
import { cn } from "@/ui/shadcn/lib/utils";

const PHRASE_MIN = 3;
const PHRASE_MAX = 300;

const VISIBILITY_OPTIONS: Array<{
  value: ThemeVisibility;
  label: string;
  hint: string;
}> = [
  {
    value: "personal",
    label: "Личная",
    hint: "Видна только вам",
  },
  {
    value: "team",
    label: "Командная",
    hint: "Видна всей команде",
  },
];

export function CreateThemeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const [phrase, setPhrase] = useState("");
  const [visibility, setVisibility] = useState<ThemeVisibility>("personal");
  const [submitting, setSubmitting] = useState(false);

  function handleOpenChange(v: boolean) {
    if (!v && !submitting) {
      setPhrase("");
      setVisibility("personal");
    }
    onOpenChange(v);
  }

  const trimmed = phrase.trim();
  const canSubmit =
    trimmed.length >= PHRASE_MIN &&
    trimmed.length <= PHRASE_MAX &&
    !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const created = await themesApi.create({ phrase: trimmed, visibility });
      toast.success("Тема создана");
      onOpenChange(false);
      setPhrase("");
      setVisibility("personal");
      router.push(`/themes/${encodeURIComponent(created.id)}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === "forbidden_team_theme") {
        toast.error("Командную тему может создать только менеджер+");
      } else {
        toast.error(humanizeApiError(err, "Не удалось создать тему"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className={cn("sm:max-w-lg")}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles size={18} className="text-accent" />
            Новая тема
          </DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div>
            <Label htmlFor="new-theme-phrase">О чём тема?</Label>
            <Textarea
              id="new-theme-phrase"
              autoFocus
              value={phrase}
              maxLength={PHRASE_MAX}
              rows={3}
              placeholder="О чём тема? Напиши как есть — например: Всё про клиента Логистик Плюс"
              onChange={(e) => setPhrase(e.target.value)}
              className="mt-1"
            />
            <p className="mt-1 text-xs text-fg-tertiary">
              Кора сама соберёт в тему всё, что знает по этой фразе.
            </p>
          </div>

          <div>
            <span className="text-sm font-medium text-fg-primary">
              Видимость
            </span>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              {VISIBILITY_OPTIONS.map((o) => {
                const active = visibility === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setVisibility(o.value)}
                    className={cn(
                      "flex flex-col items-start gap-0.5 rounded-lg border p-3 text-left transition-colors",
                      active
                        ? "border-accent bg-accent/10"
                        : "border-border-subtle bg-bg-elevated hover:border-border",
                    )}
                  >
                    <span className="text-sm font-medium text-fg-primary">
                      {o.label}
                    </span>
                    <span className="text-xs text-fg-tertiary">{o.hint}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <DialogFooter className="mt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Отмена
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {submitting ? "Создаём…" : "Создать тему"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
