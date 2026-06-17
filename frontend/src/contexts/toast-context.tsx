"use client";

import { useMemo, type ReactNode } from "react";
import { toast as sonnerToast } from "sonner";

export type ToastType = "success" | "error" | "info";

export type ToastAction = {
  label: string;
  onClick: () => void | Promise<void>;
};

export type Toast = {
  id: string;
  type: ToastType;
  message: string;
  action?: ToastAction;
  durationMs?: number;
};

type LegacyToastInput = Omit<Toast, "id"> & { id?: string };

type ToastContextValue = {
  toasts: Toast[];
  addToast: (toast: LegacyToastInput) => void;
  dismissToast: (id: string) => void;
};

let deprecationWarned = false;

function warnDeprecated(): void {
  if (deprecationWarned) return;
  deprecationWarned = true;
  if (typeof console !== "undefined") {
    console.warn(
      "[toast-context] useToast/addToast устарели — используйте `import { toast } from 'sonner'`.",
    );
  }
}

function dispatchLegacyToast(input: LegacyToastInput): void {
  const type: ToastType = input.type ?? "info";
  const options: {
    duration?: number;
    action?: { label: string; onClick: () => void };
  } = {};
  if (typeof input.durationMs === "number") {
    options.duration = input.durationMs;
  }
  if (input.action) {
    const action = input.action;
    options.action = {
      label: action.label,
      onClick: () => {
        void action.onClick();
      },
    };
  }
  if (type === "success") {
    sonnerToast.success(input.message, options);
  } else if (type === "error") {
    sonnerToast.error(input.message, options);
  } else {
    sonnerToast(input.message, options);
  }
}

export function ToastProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function useToast(): ToastContextValue {
  warnDeprecated();
  return useMemo<ToastContextValue>(
    () => ({
      toasts: [],
      addToast: dispatchLegacyToast,
      dismissToast: () => {},
    }),
    [],
  );
}
