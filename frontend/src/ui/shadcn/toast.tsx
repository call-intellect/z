'use client';

/**
 * Toast — обёртка над `sonner`. Экспортируем `<Toaster>` для подключения
 * в RootLayout и `toast` для вызова. Пока оставлены оба механизма
 * (старый `useToast` из `@/contexts/toast-context` ещё может использоваться
 * legacy-компонентами — будет удалён в M5).
 */

import { Toaster as SonnerToaster, toast as sonnerToast } from 'sonner';

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
            'bg-bg-card border border-border-subtle text-fg-primary shadow-elevated rounded-md',
          description: 'text-fg-secondary',
          actionButton: 'bg-accent text-accent-fg',
          cancelButton: 'bg-bg-overlay text-fg-primary',
        },
      }}
    />
  );
}

export const toast = sonnerToast;
