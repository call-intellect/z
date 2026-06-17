"use client";

import { useEffect, useState, type ReactNode } from "react";

import { useIsMobile } from "@/hooks/useIsMobile";

interface MobileShellProps {
  mobile: ReactNode;
  desktop: ReactNode;
  fallback?: ReactNode;
}

export function MobileShell({
  mobile,
  desktop,
  fallback = null,
}: MobileShellProps) {
  const [mounted, setMounted] = useState(false);
  const isMobile = useIsMobile();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return <>{fallback}</>;

  return <>{isMobile ? mobile : desktop}</>;
}
