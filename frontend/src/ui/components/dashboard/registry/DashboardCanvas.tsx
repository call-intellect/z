"use client";

import { useDashboardLayout } from "./use-dashboard-layout";
import { WIDGET_REGISTRY } from "./widget-registry";
import type {
  DashboardRole,
  Rhythm,
  WidgetDescriptor,
  WidgetSize,
} from "./types";

const SIZE_SPAN: Record<WidgetSize, string> = {
  sm: "col-span-12 md:col-span-3",
  md: "col-span-12 md:col-span-6",
  lg: "col-span-12 md:col-span-8",
  xl: "col-span-12",
};

export const DashboardCanvas: React.FC<{
  role: DashboardRole;
  rhythm: Rhythm;
}> = ({ role, rhythm }) => {
  const { layout } = useDashboardLayout(role, rhythm);

  const descriptors = layout
    .map((id) => WIDGET_REGISTRY[id])
    .filter(
      (d): d is WidgetDescriptor =>
        Boolean(d) && d.rhythm.includes(rhythm) && d.roles.includes(role),
    );

  return (
    <div className="grid grid-cols-12 gap-4">
      {descriptors.map((descriptor) => {
        const { Component } = descriptor;
        return (
          <div
            key={descriptor.id}
            className={`${SIZE_SPAN[descriptor.size]} empty:hidden`}
          >
            <Component rhythm={rhythm} />
          </div>
        );
      })}
    </div>
  );
};
