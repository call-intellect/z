"use client";

import { forwardRef } from "react";

import { useCanCreate } from "@/hooks/useCanCreate";
import { Button, type ButtonProps } from "@/ui/shadcn/button";
import { cn } from "@/ui/shadcn/lib/utils";

export interface PaywallGuardButtonProps extends ButtonProps {
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
}

export const PaywallGuardButton = forwardRef<
  HTMLButtonElement,
  PaywallGuardButtonProps
>(({ onClick, className, title, children, ...rest }, ref) => {
  const { canCreate, isReadOnly, loading, reason, showPaywall } =
    useCanCreate();

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
      data-paywall-readonly={isReadOnly ? "true" : undefined}
      className={cn(isReadOnly && "opacity-60", className)}
      disabled={loading || rest.disabled}
      {...rest}
    >
      {children}
    </Button>
  );
});

PaywallGuardButton.displayName = "PaywallGuardButton";
