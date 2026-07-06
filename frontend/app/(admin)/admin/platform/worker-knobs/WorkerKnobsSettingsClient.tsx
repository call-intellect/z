"use client";

import type { JSX } from "react";
import { z } from "zod";

import {
  DomainSettingsClient,
  type SettingsGroup,
} from "@/ui/components/admin/DomainSettings";

const GROUPS: SettingsGroup[] = [
  {
    title: "Классификация и профили",
    specs: [
      {
        key: "knowledge.axisClassifyEnabled",
        label: "Классификатор осей блока",
        description:
          "Рубильник классификатора осей блока графа. По умолчанию вкл (Ship-On).",
        schema: z.boolean(),
        defaultValue: true,
        requiresReason: "high",
      },
      {
        key: "roleProfiles.minBlocks",
        label: "Минимум блоков для профиля роли",
        description:
          "Минимум блоков для построения профиля роли. По умолчанию 5.",
        schema: z.number().int().min(1),
        defaultValue: 5,
      },
    ],
  },
  {
    title: "Курация",
    specs: [
      {
        key: "curation.completenessScannerEnabled",
        label: "Сканер полноты карточек",
        description:
          "Рубильник сканера полноты карточек знаний. По умолчанию вкл (Ship-On).",
        schema: z.boolean(),
        defaultValue: true,
        requiresReason: "high",
      },
    ],
  },
  {
    title: "Трекер и дайджест",
    specs: [
      {
        key: "tracker.goalAlignmentLowEnabled",
        label: "Детектор слабой связи задач с целями",
        description:
          "Рубильник детектора слабой связи задач с целями. По умолчанию вкл (Ship-On).",
        schema: z.boolean(),
        defaultValue: true,
        requiresReason: "high",
      },
      {
        key: "conversational.telegramDigestHourLocal",
        label: "Час доставки Telegram-дайджеста",
        description:
          "Локальный час доставки Telegram-дайджеста (0–23). По умолчанию 9.",
        schema: z.number().int().min(0).max(23),
        defaultValue: 9,
      },
    ],
  },
];

export function WorkerKnobsSettingsClient(): JSX.Element {
  return (
    <DomainSettingsClient
      breadcrumbLabel="Рубильники воркеров"
      title="Рубильники воркеров"
      description="Включение фоновых воркеров знаний и параметры классификации, курации, трекера и дайджеста."
      groups={GROUPS}
    />
  );
}
