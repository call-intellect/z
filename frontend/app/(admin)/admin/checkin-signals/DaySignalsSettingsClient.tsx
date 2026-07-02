"use client";

import type { JSX } from "react";
import { z } from "zod";

import {
  DomainSettingsClient,
  type SettingsGroup,
} from "@/ui/components/admin/DomainSettings";

const GROUPS: SettingsGroup[] = [
  {
    title: "Рубильник",
    description:
      "Включение и выключение дневного фиксатора чек-инов (сбор сообщений сотрудника из всех каналов + фиксация «план/отчёт»). По умолчанию включён (Ship-On).",
    specs: [
      {
        key: "dayReport.enabled",
        label: "Фиксатор чек-инов",
        description:
          "Рубильник дневного фиксатора: cron-коллектор (day-report-collector) собирает сообщения сотрудника за день из всех каналов и мост встреч (meeting-checkin) фиксирует чек-ин «план/отчёт». Выкл → коллектор и мост встреч не работают. По умолчанию вкл (Ship-On).",
        schema: z.boolean(),
        defaultValue: true,
        requiresReason: "high",
      },
    ],
  },
  {
    title: "Пороги качества",
    description:
      "Порог полноты вечернего отчёта и порог «залежавшегося» чек-ина.",
    specs: [
      {
        key: "dayReport.completenessQualityThreshold",
        label: "Порог полноты вечернего отчёта",
        description:
          "Минимальная итоговая оценка полноты (0..1) вечернего отчёта: ниже — отчёт считается неполным. По умолчанию 0.5.",
        schema: z.number().min(0).max(1),
        defaultValue: 0.5,
      },
      {
        key: "daily-checkin.staleDaysThreshold",
        label: "Порог «залежавшегося» чек-ина (дни)",
        description:
          "Через сколько дней без чек-ина сотрудник/задача считается «залежавшимся» в дневном дайджесте (1..30). По умолчанию 2.",
        schema: z.number().int().min(1).max(30),
        defaultValue: 2,
      },
    ],
  },
  {
    title: "Пропуски дней",
    description: "Когда дневной промпт чек-ина не отправляется.",
    specs: [
      {
        key: "daily-checkin.skipNonWorkingDays",
        label: "Пропускать нерабочие дни",
        description:
          "Не отправлять промпт чек-ина в нерабочие дни сотрудника (по его графику). По умолчанию вкл.",
        schema: z.boolean(),
        defaultValue: true,
      },
      {
        key: "daily-checkin.skipHolidays",
        label: "Пропускать праздники",
        description:
          "Не отправлять промпт чек-ина в государственные праздники. По умолчанию вкл.",
        schema: z.boolean(),
        defaultValue: true,
      },
    ],
  },
];

export function DaySignalsSettingsClient(): JSX.Element {
  return (
    <DomainSettingsClient
      breadcrumbLabel="Фиксатор чек-инов"
      title="Фиксатор чек-инов"
      description="Рубильник и пороги универсального фиксатора дневных чек-инов (план/отчёт из всех каналов)."
      groups={GROUPS}
    />
  );
}
