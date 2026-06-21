"use client";

import type { FC } from "react";

import { WeeklyPerPersonWidget } from "@app/(authenticated)/dashboard/operations/weekly/WeeklyPerPersonWidget";

import type { Rhythm } from "../types";

function lastCompletedMondayUtc(): string {
  const d = new Date();
  const dow = d.getUTCDay();
  const offset = dow === 0 ? -13 : -(dow - 1) - 7;
  const monday = new Date(d);
  monday.setUTCDate(monday.getUTCDate() + offset);
  const y = monday.getUTCFullYear();
  const m = String(monday.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(monday.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export const WeeklyPlanFactWidget: FC<{ rhythm: Rhythm }> = () => {
  return <WeeklyPerPersonWidget weekStart={lastCompletedMondayUtc()} />;
};
