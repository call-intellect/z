'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import clsx from 'clsx';
import { nanoid } from 'nanoid';

export type ToastType = 'success' | 'error' | 'info';

/**
 * Опциональное действие toast'а (SBA γ-2 — для «Готово. Отменить» от
 * Concierge Agent). Если задано — рендерится кнопка справа от message;
 * клик вызывает onClick (toast при этом обычно закрывается через dismiss).
 */
export type ToastAction = {
  label: string;
  onClick: () => void | Promise<void>;
};

export type Toast = {
  id: string;
  type: ToastType;
  message: string;
  /** SBA γ-2: action toast (например, «Отменить» после tool call). */
  action?: ToastAction;
  /** Длительность в мс. Default 3000; 0 = не авто-скрывается (для action). */
  durationMs?: number;
};

type ToastContextValue = {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => void;
  dismissToast: (id: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const DURATION_MS = 3000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = nanoid(8);
    setToasts((prev) => [...prev, { ...toast, id }]);
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({ toasts, addToast, dismissToast }),
    [toasts, addToast, dismissToast],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toaster />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within <ToastProvider>');
  }
  return ctx;
}

function Toaster() {
  const { toasts, dismissToast } = useToast();
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={dismissToast} />
      ))}
    </div>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: string) => void;
}) {
  // SBA γ-2: action toast'ы (с durationMs=0) НЕ авто-скрываются — ждут клика.
  // Action toast по умолчанию живёт 8 секунд, обычный — 3.
  const effectiveDuration =
    toast.durationMs ?? (toast.action ? 8000 : DURATION_MS);

  useEffect(() => {
    if (effectiveDuration <= 0) return;
    const timer = setTimeout(() => onDismiss(toast.id), effectiveDuration);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss, effectiveDuration]);

  const handleAction = async () => {
    if (!toast.action) return;
    try {
      await toast.action.onClick();
    } finally {
      onDismiss(toast.id);
    }
  };

  return (
    <div
      role="status"
      className={clsx(
        'pointer-events-auto flex items-center gap-3 rounded-md px-4 py-3 text-sm shadow-lg',
        toast.type === 'success' && 'bg-green-600 text-white',
        toast.type === 'error' && 'bg-red-600 text-white',
        toast.type === 'info' && 'bg-slate-800 text-white',
      )}
    >
      <span className="flex-1">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          onClick={handleAction}
          className="rounded border border-white/30 px-2 py-1 text-xs font-medium hover:bg-white/10"
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}
