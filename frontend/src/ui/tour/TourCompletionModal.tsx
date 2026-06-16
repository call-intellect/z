"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/ui/shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/ui/shadcn/dialog";

import { useTourContext } from "./TourProvider";
import { useAuth } from "@/contexts/auth-context";
import { onboardingApi } from "@/api/onboarding.api";
import type { TourId } from "./types";

interface Props {
  tourId: TourId;
  onDismiss: () => void;
}

export function TourCompletionModal({ tourId, onDismiss }: Props) {
  const router = useRouter();
  const { currentOrgId } = useAuth();
  const { startIfNotCompleted } = useTourContext();

  const handleWelcomeComplete = useCallback(async () => {
    onDismiss();
    router.push("/dashboard");
    if (currentOrgId) {
      try {
        await onboardingApi.completeSetup(currentOrgId);
      } catch {}
    }
    setTimeout(() => {
      startIfNotCompleted("overview");
    }, 1000);
  }, [onDismiss, router, currentOrgId, startIfNotCompleted]);

  const handleOverviewComplete = useCallback(() => {
    onDismiss();
    router.push("/dashboard");
  }, [onDismiss, router]);

  const isWelcome = tourId === "welcome";

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogTitle className="text-xl">
          {isWelcome ? "Настройка готова!" : "Готово, вы знаете кабинет"}
        </DialogTitle>
        <DialogDescription className="mt-2 text-sm text-fg-secondary">
          {isWelcome
            ? "Поставьте первую цель уже на этой неделе. Дальше Кора возьмёт работу на себя — будет слушать встречи, читать чаты, держать команду в фокусе."
            : "Если что-то забудете — наведите на любой пункт меню, всплывёт подсказка. А консьерж справа всегда подскажет в любой момент."}
        </DialogDescription>
        <div className="mt-4 flex justify-end">
          <Button
            onClick={isWelcome ? handleWelcomeComplete : handleOverviewComplete}
          >
            {isWelcome ? "Перейти на главную →" : "Перейти к работе →"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
