"use client";

import { z } from "zod";

import {
  DomainSettingsClient,
  type SettingsGroup,
} from "@/ui/components/admin/DomainSettings";

const GROUPS: SettingsGroup[] = [
  {
    title: "Оркестратор",
    description: "Рубильник и лимиты прогона оркестратора суб-агентов.",
    specs: [
      {
        key: "orchestrator.enabled",
        label: "Оркестратор включён",
        description:
          "Рубильник оркестратора суб-агентов. По умолчанию выкл (фича незрелая).",
        schema: z.boolean(),
        defaultValue: false,
        requiresReason: "high",
      },
      {
        key: "orchestrator.maxSubagentsPerRun",
        label: "Макс. суб-агентов на прогон",
        description:
          "Максимум суб-агентов на один прогон оркестратора. По умолчанию 5.",
        schema: z.number().int().min(1),
        defaultValue: 5,
      },
      {
        key: "orchestrator.runTimeoutMinutes",
        label: "Таймаут прогона, мин",
        description: "Таймаут прогона оркестратора (мин). По умолчанию 15.",
        schema: z.number().int().min(1),
        defaultValue: 15,
      },
    ],
  },
  {
    title: "Маршрутизатор (fallback)",
    description:
      "LLM-фолбэк роутера специалистов и TTL кэшей решений и негативного кэша.",
    specs: [
      {
        key: "router.llmFallbackEnabled",
        label: "LLM-фолбэк включён",
        description:
          "Рубильник LLM-фолбэка роутера специалистов. По умолчанию выкл.",
        schema: z.boolean(),
        defaultValue: false,
        requiresReason: "high",
      },
      {
        key: "router.fallbackNegativeTtlSeconds",
        label: "TTL негативного кэша, сек",
        description:
          "TTL (сек) негативного кэша роутера: как долго помнить, что провайдер только что упал. По умолчанию 60.",
        schema: z.number().int().min(1),
        defaultValue: 60,
      },
      {
        key: "router.fallbackCacheTtlSeconds",
        label: "TTL кэша решений, сек",
        description:
          "TTL (сек) кэша решений фолбэка роутера. По умолчанию 86400 (сутки).",
        schema: z.number().int().min(1),
        defaultValue: 86_400,
      },
    ],
  },
];

export function OrchestratorSettingsClient() {
  return (
    <DomainSettingsClient
      breadcrumbLabel="Оркестратор и маршрутизатор"
      title="Оркестратор и маршрутизатор"
      description="Рубильники и лимиты оркестратора суб-агентов и LLM-фолбэка роутера специалистов. БД-override поверх ENV, инвалидируется на всех процессах через Redis pub/sub."
      groups={GROUPS}
    />
  );
}
