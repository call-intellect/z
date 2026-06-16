"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, ListChecks, Loader2, Plus } from "lucide-react";

import { intakeApi } from "@/api/tracker/intake.api";
import { humanizeApiError } from "@/api/api-error";
import { useAuth } from "@/contexts/auth-context";
import { toast } from "@/ui/shadcn/toast";
import { objectMainText } from "./structured-report";

export const NEXT_STEP_KEYS = [
  "next_steps",
  "next_step",
  "action_items",
] as const;

function extractStepTexts(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value === "string") {
    const t = value.trim();
    return t ? [t] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (item !== null && typeof item === "object" && !Array.isArray(item)) {
        const t = objectMainText(item as Record<string, unknown>);
        return t && t !== "—" ? [t] : [];
      }
      const t = String(item).trim();
      return t ? [t] : [];
    });
  }
  if (typeof value === "object") {
    const t = objectMainText(value as Record<string, unknown>);
    return t && t !== "—" ? [t] : [];
  }
  return [];
}

export function collectNextSteps(structuredData: unknown): string[] {
  if (!structuredData || typeof structuredData !== "object") return [];
  const data = structuredData as Record<string, unknown>;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const key of NEXT_STEP_KEYS) {
    for (const text of extractStepTexts(data[key])) {
      const norm = text.toLowerCase();
      if (seen.has(norm)) continue;
      seen.add(norm);
      out.push(text);
    }
  }
  return out;
}

export function NextStepsSection({
  meetingId,
  steps,
}: {
  meetingId: string;
  steps: string[];
}) {
  if (steps.length === 0) return null;
  return (
    <div className="rounded-xl border border-border-subtle bg-bg-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <ListChecks size={14} className="text-accent" />
        <h3 className="m-0 text-sm font-semibold text-fg-primary">
          Следующие шаги
        </h3>
      </div>
      <ul className="m-0 flex flex-col gap-2 p-0 list-none">
        {steps.map((text, i) => (
          <NextStepRow key={`${i}-${text}`} meetingId={meetingId} text={text} />
        ))}
      </ul>
    </div>
  );
}

type RowState = "idle" | "sending" | "added";

function NextStepRow({ meetingId, text }: { meetingId: string; text: string }) {
  const { currentOrgId } = useAuth();
  const [state, setState] = useState<RowState>("idle");

  const onAdd = async () => {
    if (!currentOrgId || state !== "idle") return;
    setState("sending");
    try {
      await intakeApi.nextStepToIntake(currentOrgId, meetingId, { text });
      setState("added");
      toast.success("✓ Добавлено в кандидаты задач");
    } catch (e) {
      setState("idle");
      toast.error(humanizeApiError(e, "Не удалось добавить в задачи"));
    }
  };

  return (
    <li className="flex items-start gap-3 rounded-md border border-border-subtle bg-bg-base px-3 py-2.5">
      <span className="min-w-0 flex-1 text-sm leading-snug text-fg-primary">
        {text}
      </span>
      {state === "added" ? (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-chip-success-bg px-2 py-1 text-xs font-medium text-chip-success-fg">
          <CheckCircle2 size={13} strokeWidth={2} />
          Добавлено
        </span>
      ) : (
        <button
          type="button"
          onClick={() => void onAdd()}
          disabled={state === "sending" || !currentOrgId}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-accent-border bg-accent-muted px-2.5 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent-muted-strong disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state === "sending" ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Plus size={13} strokeWidth={2} />
          )}
          В задачу
        </button>
      )}
    </li>
  );
}
