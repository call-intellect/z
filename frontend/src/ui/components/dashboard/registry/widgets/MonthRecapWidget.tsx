"use client";

import type { FC } from "react";

import { ValueRecapDashboardClient } from "@app/(authenticated)/dashboard/value-recap/ValueRecapDashboardClient";

import type { Rhythm } from "../types";

export const MonthRecapWidget: FC<{ rhythm: Rhythm }> = () => {
  return <ValueRecapDashboardClient embedded />;
};
