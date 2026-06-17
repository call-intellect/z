"use client";

import { usePathname } from "next/navigation";

import { ConciergeChat } from "./ConciergeChat";
import type { ConciergePageContextApi } from "@/api/concierge.api";

export interface ConciergeSlotProps {
  context?: ConciergePageContextApi;
  className?: string;
}

export function ConciergeSlot({ context, className }: ConciergeSlotProps) {
  const pathname = usePathname();
  const pageContext: ConciergePageContextApi = {
    clientPath: pathname ?? undefined,
    ...(context ?? {}),
  };
  return <ConciergeChat pageContext={pageContext} className={className} />;
}
