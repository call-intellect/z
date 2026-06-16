"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";

import { Button } from "@/ui/shadcn/button";
import { useAuth } from "@/contexts/auth-context";
import { useOrgSetup } from "@/hooks/useOrgSetup";
import { useTourContext } from "@/ui/tour";
import type { OrgApi } from "@/api/orgs.api";

const DISMISS_KEY = "onboarding.banner.dismissed";

const STEP_LABELS: { field: keyof OrgApi; label: string }[] = [
  { field: "companyInfoCompletedAt", label: "заполнить данные компании" },
  { field: "departmentsCompletedAt", label: "добавить отделы" },
  { field: "rolesCompletedAt", label: "завести должности" },
  { field: "teamInvitedAt", label: "пригласить команду" },
  { field: "firstSprintCreatedAt", label: "создать первый спринт" },
  { field: "firstMeetingCreatedAt", label: "провести первую встречу" },
];

export function IncompleteSetupBanner() {
  const { currentOrgId, isSuperAdmin } = useAuth();
  const { org, setupCompletedAt } = useOrgSetup(currentOrgId);
  const { forceStart } = useTourContext();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
    }
  }, []);

  if (setupCompletedAt || dismissed || !org || isSuperAdmin) return null;

  const completed = STEP_LABELS.filter((s) => org[s.field] != null).length;
  const pending = STEP_LABELS.filter((s) => org[s.field] == null);

  const handleContinue = () => {
    forceStart("welcome");
  };

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  };

  return (
    <div className="mb-4 rounded-lg border border-accent/30 bg-accent-muted/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <p className="text-sm font-semibold text-fg-primary">
            Настройка компании: {completed} из 6
          </p>
          {pending.length > 0 && (
            <p className="mt-1 text-xs text-fg-secondary">
              Осталось:{" "}
              {pending
                .slice(0, 3)
                .map((s) => s.label)
                .join(", ")}
              {pending.length > 3 && ` и ещё ${pending.length - 3}`}
            </p>
          )}
        </div>
        <button
          onClick={handleDismiss}
          className="shrink-0 text-fg-tertiary hover:text-fg-primary transition-colors"
          aria-label="Скрыть"
        >
          <X size={16} />
        </button>
      </div>
      <div className="mt-3">
        <Button size="sm" variant="outline" onClick={handleContinue}>
          Продолжить →
        </Button>
      </div>
    </div>
  );
}
