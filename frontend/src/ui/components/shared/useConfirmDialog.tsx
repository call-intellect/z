"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { ConfirmDialog } from "./ConfirmDialog";

type AskOptions = {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type DialogState = AskOptions & { open: boolean };

export function useConfirmDialog(): {
  ask: (options: AskOptions) => Promise<boolean>;
  dialog: ReactNode;
} {
  const [state, setState] = useState<DialogState>({
    open: false,
    title: "",
  });
  const resolveRef = useRef<((v: boolean) => void) | null>(null);

  const ask = useCallback((options: AskOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      setState({ ...options, open: true });
    });
  }, []);

  const handleOpenChange = useCallback((next: boolean) => {
    if (next) return;
    setState((prev) => ({ ...prev, open: false }));
    if (resolveRef.current) {
      const r = resolveRef.current;
      resolveRef.current = null;
      r(false);
    }
  }, []);

  const handleConfirm = useCallback(async () => {
    const r = resolveRef.current;
    resolveRef.current = null;
    setState((prev) => ({ ...prev, open: false }));
    r?.(true);
  }, []);

  const dialog = (
    <ConfirmDialog
      open={state.open}
      onOpenChange={handleOpenChange}
      title={state.title}
      description={state.description}
      confirmLabel={state.confirmLabel}
      cancelLabel={state.cancelLabel}
      destructive={state.destructive}
      onConfirm={handleConfirm}
    />
  );

  return { ask, dialog };
}
