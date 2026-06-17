"use client";

import { useSupportStatus } from "@/hooks/useSupportStatus";
import { SupportWidget } from "./SupportWidget";

export function SupportWidgetMount() {
  const { deskEnabled } = useSupportStatus();
  if (!deskEnabled) return null;
  return <SupportWidget />;
}
