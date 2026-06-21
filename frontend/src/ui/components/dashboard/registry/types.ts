import type { FC } from "react";

export type Rhythm = "today" | "week" | "month";

export type DashboardRole = "owner" | "coo" | "member";

export type WidgetSize = "sm" | "md" | "lg" | "xl";

export interface WidgetDescriptor {
  id: string;
  title: string;
  rhythm: Rhythm[];
  roles: DashboardRole[];
  size: WidgetSize;
  visibleWhen?: (data: unknown) => boolean;
  Component: FC<{ rhythm: Rhythm }>;
}

export interface DashboardPreset {
  role: DashboardRole;
  rhythm: Rhythm;
  layout: string[];
}
