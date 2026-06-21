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
      "Включение и выключение универсального фиксатора чек-инов (детектор плана/отчёта из всех каналов). По умолчанию включён (Ship-On).",
    specs: [
      {
        key: "daySignals.enabled",
        label: "Фиксатор чек-инов",
        description:
          "Рубильник универсального фиксатора: дневной сбор сообщений сотрудника из всех каналов (встречи, Bitrix, чаты, почта, заметки) и фиксация чек-ина «план/отчёт». Выкл → дневной cron-агрегатор и мост встреч не работают. По умолчанию вкл (Ship-On).",
        schema: z.boolean(),
        defaultValue: true,
        requiresReason: "high",
      },
    ],
  },
  {
    title: "Пороги и время",
    description:
      "Порог уверенности детектора и локальный час суточной обработки.",
    specs: [
      {
        key: "daySignals.detectThreshold",
        label: "Порог уверенности детектора",
        description:
          "Минимальная уверенность (0..1) LLM-детектора плана/отчёта, с которой чек-ин фиксируется; ниже — сигнал отбрасывается. По умолчанию 0.7.",
        schema: z.number().min(0).max(1),
        defaultValue: 0.7,
      },
      {
        key: "daySignals.processLocalHour",
        label: "Локальный час обработки",
        description:
          "Локальный час сотрудника (0–23), в который дневной cron собирает его сообщения за день и фиксирует чек-ин. По умолчанию 21.",
        schema: z.number().int().min(0).max(23),
        defaultValue: 21,
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
