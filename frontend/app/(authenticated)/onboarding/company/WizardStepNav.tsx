"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";

import { Button } from "@/ui/shadcn/button";

export function WizardStepNav({
  prevHref,
  nextHref,
  nextDisabled,
  nextLabel,
  submitting,
  onNext,
  onSkip,
}: {
  prevHref?: string;
  nextHref?: string;
  nextDisabled?: boolean;
  nextLabel?: string;
  submitting?: boolean;
  onNext?: () => void | Promise<void>;
  onSkip?: () => void | Promise<void>;
}) {
  const router = useRouter();
  const handleNext = async () => {
    if (onNext) {
      await onNext();
      return;
    }
    if (nextHref) {
      router.push(nextHref);
    }
  };
  return (
    <div className="mt-8 flex items-center justify-between gap-2 border-t border-border-subtle pt-4">
      <div>
        {prevHref ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push(prevHref)}
            disabled={submitting}
          >
            <ArrowLeft size={14} className="mr-1" /> Назад
          </Button>
        ) : (
          <span />
        )}
      </div>
      <div className="flex items-center gap-2">
        {onSkip && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void onSkip()}
            disabled={submitting}
          >
            Пропустить
          </Button>
        )}
        <Button
          size="sm"
          onClick={() => void handleNext()}
          disabled={nextDisabled || submitting}
        >
          {submitting ? (
            <Loader2 size={14} className="mr-1 animate-spin" />
          ) : null}
          {nextLabel ?? "Далее"}
          {!submitting && <ArrowRight size={14} className="ml-1" />}
        </Button>
      </div>
    </div>
  );
}
