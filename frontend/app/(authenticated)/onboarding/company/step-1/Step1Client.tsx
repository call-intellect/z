"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, X } from "lucide-react";

import { ApiError, humanizeApiError } from "@/api/api-error";
import { departmentsApi } from "@/api/structure.api";
import { useAuth } from "@/contexts/auth-context";
import { toast } from "sonner";
import { Button } from "@/ui/shadcn/button";
import { Input } from "@/ui/shadcn/input";
import { Label } from "@/ui/shadcn/label";

import { WizardStepNav } from "../WizardStepNav";

const NEXT_HREF = "/onboarding/company/step-2";

export function Step1Client() {
  const router = useRouter();
  const { currentOrgId } = useAuth();
  const [rows, setRows] = useState<string[]>([""]);
  const [submitting, setSubmitting] = useState(false);

  const addRow = () => setRows((rs) => [...rs, ""]);
  const removeRow = (idx: number) =>
    setRows((rs) => (rs.length <= 1 ? rs : rs.filter((_, i) => i !== idx)));
  const updateRow = (idx: number, value: string) =>
    setRows((rs) => rs.map((r, i) => (i === idx ? value : r)));

  const cleaned = rows.map((r) => r.trim()).filter((r) => r.length > 0);
  const canSubmit = cleaned.length > 0 && Boolean(currentOrgId);

  const handleSubmit = async () => {
    if (!canSubmit || !currentOrgId) return;
    setSubmitting(true);
    try {
      const unique: string[] = [];
      const seen = new Set<string>();
      for (const name of cleaned) {
        const key = name.toLocaleLowerCase("ru");
        if (!seen.has(key)) {
          seen.add(key);
          unique.push(name);
        }
      }
      await Promise.all(
        unique.map((name) => departmentsApi.create(currentOrgId, { name })),
      );
      toast.success("Отделы сохранены.");
      router.push(NEXT_HREF);
    } catch (e) {
      const msg = humanizeApiError(e, "Не удалось сохранить отделы.");
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section>
      <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
        Из каких отделов состоит компания?
      </h1>
      <p className="mt-2 text-sm text-fg-secondary">
        Перечислите крупные блоки: «Продажи», «Разработка», «Маркетинг». Можно
        добавить ещё позже — этот список не финальный.
      </p>

      <div className="mt-6 space-y-2">
        <Label>Отделы</Label>
        {rows.map((row, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <Input
              value={row}
              onChange={(e) => updateRow(idx, e.target.value)}
              placeholder="Например, Продажи"
              autoFocus={idx === 0}
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => removeRow(idx)}
              disabled={rows.length <= 1}
              aria-label="Удалить строку"
            >
              <X size={16} />
            </Button>
          </div>
        ))}
        <Button
          variant="ghost"
          size="sm"
          onClick={addRow}
          className="text-fg-secondary"
        >
          <Plus size={14} className="mr-1" /> Добавить ещё
        </Button>
      </div>

      <WizardStepNav
        nextDisabled={!canSubmit}
        submitting={submitting}
        onNext={handleSubmit}
        nextLabel="Сохранить и далее"
      />
    </section>
  );
}
