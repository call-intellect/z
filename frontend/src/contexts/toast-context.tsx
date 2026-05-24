'use client';

/**
 * DEPRECATED: toast-context — теперь это тонкий shim над sonner.
 *
 * Используй напрямую:
 *   import { toast } from 'sonner';
 *   toast.success('...');
 *   toast.error('...');
 *   toast('...', { action: { label, onClick } });
 *
 * Этот модуль остаётся ради совместимости с legacy-вызовами через
 * `useToast()/{ addToast }` (Phase C ТЗ ui-api-modernization 2026-05-24).
 * Удалить, когда все потребители мигрируют.
 */

import { useMemo, type ReactNode } from 'react';
import { toast as sonnerToast } from 'sonner';

export type ToastType = 'success' | 'error' | 'info';

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

type LegacyToastInput = Omit<Toast, 'id'> & { id?: string };

type ToastContextValue = {
  toasts: Toast[];
  addToast: (toast: LegacyToastInput) => void;
  dismissToast: (id: string) => void;
};

let deprecationWarned = false;

function warnDeprecated(): void {
  if (deprecationWarned) return;
  deprecationWarned = true;
  if (typeof console !== 'undefined') {
    console.warn(
      "[toast-context] useToast/addToast устарели — используйте `import { toast } from 'sonner'`.",
    );
  }
}

function dispatchLegacyToast(input: LegacyToastInput): void {
  const type: ToastType = input.type ?? 'info';
  const options: { duration?: number; action?: { label: string; onClick: () => void } } = {};
  if (typeof input.durationMs === 'number') {
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
  if (type === 'success') {
    sonnerToast.success(input.message, options);
  } else if (type === 'error') {
    sonnerToast.error(input.message, options);
  } else {
    sonnerToast(input.message, options);
  }
}

/**
 * Shim-провайдер — НИЧЕГО не оборачивает. Sonner `<Toaster />` уже
 * подключён в RootLayout. Оставлен только чтобы существующие импорты
 * `<ToastProvider>` не падали при сборке.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function useToast(): ToastContextValue {
  warnDeprecated();
  return useMemo<ToastContextValue>(
    () => ({
      toasts: [],
      addToast: dispatchLegacyToast,
      dismissToast: () => {
        /* sonner управляет своим жизненным циклом сам */
      },
    }),
    [],
  );
}
