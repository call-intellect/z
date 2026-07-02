"use client";

import type { JSX } from "react";
import { z } from "zod";

import {
  DomainSettingsClient,
  type SettingsGroup,
} from "@/ui/components/admin/DomainSettings";

const GROUPS: SettingsGroup[] = [
  {
    title: "Модели LLM",
    description:
      "Идентификаторы моделей для провайдеров и провайдер главного отчёта встречи.",
    specs: [
      {
        key: "ai.anthropic.model",
        label: "Модель Anthropic (Claude)",
        description:
          "Идентификатор модели Anthropic (Claude) для задач, маршрутизируемых на этого провайдера (например claude-sonnet-4-6 из сида). Это строка-идентификатор модели, не список вариантов.",
        schema: z.string().min(1),
        defaultValue: "claude-sonnet-4-6",
      },
      {
        key: "ai.vox.model",
        label: "Модель ASR Vox",
        description:
          "Идентификатор модели ASR Vox (транскрибация), например v3_rnnt из сида. Это строка-идентификатор модели, не список вариантов.",
        schema: z.string().min(1),
        defaultValue: "v3_rnnt",
      },
      {
        key: "ai.deepseek.defaultModel",
        label: "Модель DeepSeek по умолчанию",
        description:
          "Идентификатор модели DeepSeek для задач без явной модели в цепочке роутера (например deepseek-v4-flash из сида). Это строка-идентификатор модели, не список вариантов.",
        schema: z.string().min(1),
        defaultValue: "deepseek-v4-flash",
      },
      {
        key: "gepa.reflectionLm",
        label: "Модель рефлексии GEPA",
        description:
          "Идентификатор модели рефлексии GEPA (эволюция промптов), например deepseek-v4-pro из сида. Это строка-идентификатор модели, не список вариантов.",
        schema: z.string().min(1),
        defaultValue: "deepseek-v4-pro",
      },
      {
        key: "gepa.taskLm",
        label: "Модель задачи GEPA",
        description:
          "Идентификатор модели исполнения задачи GEPA (эволюция промптов), например deepseek-v4-pro из сида. Это строка-идентификатор модели, не список вариантов.",
        schema: z.string().min(1),
        defaultValue: "deepseek-v4-pro",
      },
      {
        key: "ai.mainReport.primary",
        label: "Провайдер главного отчёта",
        description:
          "Основной провайдер ГЛАВНОГО отчёта встречи (LlmFallbackService): deepseek (Ship-On) или откат minimax. Аварийный рубильник-откат каскада. По умолчанию deepseek.",
        schema: z.enum(["minimax", "deepseek"]),
        defaultValue: "deepseek",
        requiresReason: "high",
      },
    ],
  },
  {
    title: "Рубильники доставки",
    description: "Аварийные рубильники доставки почты и web-push дайджеста.",
    specs: [
      {
        key: "mail.dryRun",
        label: "Сухой прогон почты",
        description:
          "Сухой прогон почты: при true письма не отправляются реально, а логируются. По умолчанию false.",
        schema: z.boolean(),
        defaultValue: false,
        requiresReason: "high",
      },
      {
        key: "operations.daily_digest.deliver_to_webpush",
        label: "Доставка утреннего web-push",
        description:
          "Доставка утреннего exec web-push «Требует тебя сегодня: N» (ExecMorningPushCron). Аварийный рубильник, действий владельца не требует. По умолчанию true (Ship-On).",
        schema: z.boolean(),
        defaultValue: true,
      },
    ],
  },
  {
    title: "Часы дайджестов",
    description:
      "Локальные и UTC часы доставки чек-инов и COO-дайджестов. Читаются per-run, применяются без рестарта.",
    specs: [
      {
        key: "betaOps.morningLocalHour",
        label: "Час утреннего чек-ина",
        description:
          "Локальный час утреннего ежедневного чек-ина (0..23). Читается per-run, применяется без рестарта. По умолчанию 9.",
        schema: z.number().int().min(0).max(23),
        defaultValue: 9,
      },
      {
        key: "betaOps.eveningLocalHour",
        label: "Час вечернего чек-ина",
        description:
          "Локальный час вечернего ежедневного чек-ина (0..23). Читается per-run. По умолчанию 18.",
        schema: z.number().int().min(0).max(23),
        defaultValue: 18,
      },
      {
        key: "betaOps.weeklyDigestLocalHour",
        label: "Час недельного дайджеста",
        description:
          "Локальный час недельного COO-дайджеста (0..23). Читается per-run. По умолчанию 8.",
        schema: z.number().int().min(0).max(23),
        defaultValue: 8,
      },
      {
        key: "betaOps.weeklyDigestLocalDay",
        label: "День недельного дайджеста",
        description:
          "День недели недельного COO-дайджеста (0=воскресенье..6=суббота). Читается per-run. По умолчанию 1 (понедельник).",
        schema: z.number().int().min(0).max(6),
        defaultValue: 1,
      },
      {
        key: "betaOps.dailyDigestHourUtc",
        label: "Час дневного дайджеста (UTC)",
        description:
          "Час дневного COO-дайджеста в UTC (0..23). Читается per-run. По умолчанию 22.",
        schema: z.number().int().min(0).max(23),
        defaultValue: 22,
      },
    ],
  },
];

export function ModelsSettingsClient(): JSX.Element {
  return (
    <DomainSettingsClient
      breadcrumbLabel="Модели LLM и часы"
      title="Модели LLM и часы дайджестов"
      description="Идентификаторы моделей LLM, провайдер главного отчёта, аварийные рубильники доставки и часы дайджестов."
      groups={GROUPS}
    />
  );
}
