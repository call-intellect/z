'use client';

/**
 * PaywallGuardButton — обёртка над shadcn Button, которая:
 *   - в режиме ACTIVE (canCreate) — ведёт себя как обычная кнопка;
 *   - в read-only (DEMO/SUSPENDED/EXPIRED/CANCELED/PAST_DUE) — при клике
 *     открывает PaywallModal вместо выполнения действия, и показывает
 *     приглушённый стиль + tooltip с причиной;
 *   - пока loading — показывает обычную кнопку с disabled.
 *
 * Зачем: единая точка визуальной + поведенческой блокировки create-кнопок,
 * чтобы DEMO-юзер не упирался в 403 после клика — paywall открывается сразу.
 *
 * ТЗ: plans/tz/2026-05-28-paywall-no-trial.md §4.2.
 */

import { forwardRef } from 'react';

import { useCanCreate } from '@/hooks/useCanCreate';
import { Button, type ButtonProps } from '@/ui/shadcn/button';
import { cn } from '@/ui/shadcn/lib/utils';

export interface PaywallGuardButtonProps extends ButtonProps {
  /**
   * Обработчик клика для ACTIVE-режима. В read-only вызывается showPaywall()
   * вместо этого.
   */
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
}

export const PaywallGuardButton = forwardRef<
  HTMLButtonElement,
  PaywallGuardButtonProps
>(({ onClick, className, title, children, ...rest }, ref) => {
  const { canCreate, isReadOnly, loading, reason, showPaywall } = useCanCreate();

  const handleClick: React.MouseEventHandler<HTMLButtonElement> = (e) => {
    if (isReadOnly) {
      e.preventDefault();
      e.stopPropagation();
      showPaywall();
      return;
    }
    onClick?.(e);
  };

  return (
    <Button
      ref={ref}
      onClick={handleClick}
      title={isReadOnly ? (reason ?? title) : title}
      aria-disabled={isReadOnly || loading}
      data-paywall-readonly={isReadOnly ? 'true' : undefined}
      className={cn(
        isReadOnly && 'opacity-60',
        className,
      )}
      disabled={loading || rest.disabled}
      {...rest}
    >
      {children}
    </Button>
  );
});

PaywallGuardButton.displayName = 'PaywallGuardButton';
