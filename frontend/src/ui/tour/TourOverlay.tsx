"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useTourContext } from "./TourProvider";
import { TourBackdrop } from "./TourBackdrop";
import { TourTooltip } from "./TourTooltip";
import { TourCompletionModal } from "./TourCompletionModal";
import type { TourId, TourStepAction } from "./types";

export function TourOverlay() {
  const { active, next, prev, skip, complete } = useTourContext();
  const router = useRouter();
  const lastTourIdRef = useRef<TourId | null>(null);
  const [justCompleted, setJustCompleted] = useState<TourId | null>(null);

  useEffect(() => {
    if (active) {
      lastTourIdRef.current = active.definition.id;
    }
  }, [active]);

  useEffect(() => {
    if (!active && lastTourIdRef.current) {
      const tourId = lastTourIdRef.current;
      if (tourId === "welcome" || tourId === "overview") {
        setJustCompleted(tourId);
      }
      lastTourIdRef.current = null;
    }
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        void skip();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [active, skip]);

  const dismissModal = () => setJustCompleted(null);

  if (justCompleted) {
    return (
      <TourCompletionModal tourId={justCompleted} onDismiss={dismissModal} />
    );
  }

  if (!active) return null;

  const step = active.definition.steps[active.stepIndex];
  if (!step) return null;

  const onAction = (action: TourStepAction) => {
    switch (action.kind) {
      case "next":
        next();
        break;
      case "prev":
        prev();
        break;
      case "skip":
        void skip();
        break;
      case "complete":
        void complete();
        break;
      case "navigate":
        if (action.href) router.push(action.href);
        next();
        break;
    }
  };

  return (
    <>
      <TourBackdrop />
      <TourTooltip
        step={step}
        stepIndex={active.stepIndex}
        totalSteps={active.definition.steps.length}
        onActionClick={onAction}
      />
    </>
  );
}
