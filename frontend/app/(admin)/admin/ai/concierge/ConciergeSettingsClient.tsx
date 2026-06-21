"use client";

import { z } from "zod";

import {
  DomainSettingsClient,
  type SettingsGroup,
} from "@/ui/components/admin/DomainSettings";

const GROUPS: SettingsGroup[] = [
  {
    title: "Рубильники",
    description:
      "Включение помощника и его ключевых слоёв. Выкат включённым (Ship-On).",
    specs: [
      {
        key: "concierge.enabled",
        label: "Помощник включён",
        description:
          "Рубильник помощника-консьержа: при выкл помощник недоступен. По умолчанию вкл (Ship-On).",
        schema: z.boolean(),
        defaultValue: true,
        requiresReason: "high",
      },
      {
        key: "concierge.dialogLayerEnabled",
        label: "Слой понимания запроса",
        description:
          "Слой понимания/синтеза запроса помощника (dialog-layer). По умолчанию вкл.",
        schema: z.boolean(),
        defaultValue: true,
      },
      {
        key: "concierge.nativeToolsEnabled",
        label: "Нативные инструменты",
        description:
          "Native function-calling в помощнике (инструменты уходят провайдеру вместо regex-эмуляции в тексте). По умолчанию вкл.",
        schema: z.boolean(),
        defaultValue: true,
      },
    ],
  },
  {
    title: "PRM-реранкер",
    description:
      "Реранжирование кандидатов ответа помощника, в боевом и теневом режимах.",
    specs: [
      {
        key: "concierge.prmEnabled",
        label: "Боевой PRM",
        description:
          "Боевой PRM-реранкер кандидатов помощника. По умолчанию выкл.",
        schema: z.boolean(),
        defaultValue: false,
      },
      {
        key: "concierge.prmShadowEnabled",
        label: "Теневой PRM",
        description:
          "Теневой режим PRM-реранкера помощника (считает, но не влияет на ответ). По умолчанию выкл.",
        schema: z.boolean(),
        defaultValue: false,
      },
      {
        key: "concierge.prmTopK",
        label: "Верхних кандидатов PRM",
        description:
          "Сколько верхних кандидатов берёт PRM-реранкер помощника. По умолчанию 3.",
        schema: z.number().int().min(1),
        defaultValue: 3,
      },
      {
        key: "concierge.prmShadowSampleRate",
        label: "Доля выборки теневого PRM",
        description:
          "Доля запросов (0–1), на которых считается теневой PRM помощника. По умолчанию 1.0.",
        schema: z.number().min(0).max(1),
        defaultValue: 1.0,
      },
    ],
  },
  {
    title: "Лимиты сообщений",
    description: "Дневной и месячный потолок сообщений помощнику на пользователя.",
    specs: [
      {
        key: "concierge.dailyMessagesLimit",
        label: "Дневной лимит сообщений",
        description:
          "Дневной лимит сообщений помощнику на пользователя. По умолчанию 100.",
        schema: z.number().int().min(1),
        defaultValue: 100,
      },
      {
        key: "concierge.monthlyMessagesLimit",
        label: "Месячный лимит сообщений",
        description:
          "Месячный лимит сообщений помощнику на пользователя. По умолчанию 3000.",
        schema: z.number().int().min(1),
        defaultValue: 3000,
      },
    ],
  },
  {
    title: "Pre-retrieval и поток",
    description:
      "Предварительная подгрузка контекста и параметры SSE-потока помощника.",
    specs: [
      {
        key: "concierge.preRetrievalTopK",
        label: "Блоков в pre-retrieval",
        description:
          "Сколько блоков подтягивается в pre-retrieval помощника. По умолчанию 12.",
        schema: z.number().int().min(1),
        defaultValue: 12,
      },
      {
        key: "concierge.preRetrievalTimeoutMs",
        label: "Таймаут pre-retrieval, мс",
        description:
          "Таймаут pre-retrieval помощника (мс). По умолчанию 3000.",
        schema: z.number().int().min(1),
        defaultValue: 3000,
      },
      {
        key: "concierge.sseHeartbeatSeconds",
        label: "Интервал heartbeat SSE, сек",
        description:
          "Интервал heartbeat SSE-потока помощника (сек). По умолчанию 15.",
        schema: z.number().int().min(1),
        defaultValue: 15,
      },
    ],
  },
];

export function ConciergeSettingsClient() {
  return (
    <DomainSettingsClient
      breadcrumbLabel="Помощник"
      title="Помощник (Concierge)"
      description="Рубильники, PRM-реранкер, лимиты сообщений и pre-retrieval помощника. БД-override поверх ENV, инвалидируется на всех процессах через Redis pub/sub."
      groups={GROUPS}
    />
  );
}
