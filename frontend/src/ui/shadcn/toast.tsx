"use client";

import { Toaster as SonnerToaster, toast as sonnerToast } from "sonner";

export function Toaster() {
  return (
    <SonnerToaster
      theme="dark"
      position="top-right"
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast:
            "bg-bg-card border border-border-subtle text-fg-primary shadow-elevated rounded-md",
          description: "text-fg-secondary",
          actionButton: "bg-accent text-accent-fg",
          cancelButton: "bg-bg-overlay text-fg-primary",
        },
      }}
    />
  );
}

export const toast = sonnerToast;
