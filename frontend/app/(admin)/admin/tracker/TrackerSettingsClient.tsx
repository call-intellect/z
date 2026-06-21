"use client";

import type { JSX } from "react";
import { z } from "zod";

import {
  DomainSettingsClient,
  type SettingsGroup,
} from "@/ui/components/admin/DomainSettings";

const GROUPS: SettingsGroup[] = [
  {
    title: "Авто-черновик прогресса",
    description:
      "Воркер собирает черновик обновления прогресса из графа знаний; человек подтверждает (авто-публикации нет).",
    specs: [
      {
        key: "tracker.progressAutoDraftEnabled",
        label: "Авто-черновик прогресса",
        description:
          "Рубильник воркера авто-черновика прогресса задач. Выкл — черновики не создаются. По умолчанию вкл (Ship-On).",
        schema: z.boolean(),
        defaultValue: true,
      },
      {
        key: "tracker.progressAutoDraftMinSignals",
        label: "Минимум сигналов для черновика",
        description:
          "Сколько дельта-сигналов по задаче нужно, чтобы Кора собрала черновик прогресса. По умолчанию 2 (минимум 1).",
        schema: z.number().int().min(1),
        defaultValue: 2,
      },
      {
        key: "tracker.progressAutoDraftCron",
        label: "Расписание (cron) авто-черновика",
        description:
          "Когда запускается воркер авто-черновика прогресса. По умолчанию ежедневно в 07:00 UTC.",
        schema: z.string().min(1),
        defaultValue: "0 7 * * *",
      },
    ],
  },
  {
    title: "Сводка изменений",
    description:
      "AI-сводка «что произошло по задаче» по запросу пользователя (catch-up).",
    specs: [
      {
        key: "tracker.activityDigestEnabled",
        label: "Сводка изменений по задаче",
        description:
          "Рубильник кнопки «Что произошло по задаче». Выкл — сводка недоступна. По умолчанию вкл (Ship-On).",
        schema: z.boolean(),
        defaultValue: true,
      },
    ],
  },
  {
    title: "Автоматизации",
    description:
      "Рубильник пользовательских автоматизаций трекера (правила «если — то»). По умолчанию включён (Ship-On).",
    specs: [
      {
        key: "tracker.automationsEnabled",
        label: "Автоматизации трекера",
        description:
          "Рубильник движка пользовательских правил «если — то». Выкл — ни одно правило не применяется. По умолчанию вкл (Ship-On).",
        schema: z.boolean(),
        defaultValue: true,
      },
    ],
  },
];

export function TrackerSettingsClient(): JSX.Element {
  return (
    <DomainSettingsClient
      breadcrumbLabel="Трекер"
      title="Трекер"
      description="Рубильники и параметры задачного трекера."
      groups={GROUPS}
    />
  );
}
