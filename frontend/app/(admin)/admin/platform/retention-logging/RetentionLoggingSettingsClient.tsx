"use client";

import type { JSX } from "react";
import { z } from "zod";

import {
  DomainSettingsClient,
  type SettingsGroup,
} from "@/ui/components/admin/DomainSettings";

const GROUPS: SettingsGroup[] = [
  {
    title: "Хранение (retention)",
    description:
      "Сроки хранения и рубильники удаления данных по retention-sweep.",
    specs: [
      {
        key: "retention.defaultDays",
        label: "Срок хранения по умолчанию (дни)",
        description:
          "Срок хранения по умолчанию (дни) до удаления данных по retention-sweep. По умолчанию 30.",
        schema: z.number().int().min(1),
        defaultValue: 30,
      },
      {
        key: "retention.softDeleteGraceDays",
        label: "Льготный период мягкого удаления (дни)",
        description:
          "Льготный период (дни) после мягкого удаления до физического удаления. По умолчанию 30.",
        schema: z.number().int().min(1),
        defaultValue: 30,
      },
      {
        key: "retention.webhookDeliveryDays",
        label: "Журналы доставки вебхуков (дни)",
        description:
          "Срок хранения журналов доставки вебхуков (дни). По умолчанию 30.",
        schema: z.number().int().min(1),
        defaultValue: 30,
      },
      {
        key: "retention.shareViewDays",
        label: "События просмотра публичных ссылок (дни)",
        description:
          "Срок хранения событий просмотра публичных ссылок (дни). По умолчанию 90.",
        schema: z.number().int().min(1),
        defaultValue: 90,
      },
      {
        key: "retention.apiAccessLogDays",
        label: "Журнал доступа к API (дни)",
        description:
          "Срок хранения журнала доступа к API (дни). По умолчанию 30.",
        schema: z.number().int().min(1),
        defaultValue: 30,
      },
      {
        key: "retention.sweepBatchSize",
        label: "Размер пачки прохода sweep (строк)",
        description:
          "Размер пачки одного прохода retention-sweep (строк). По умолчанию 500.",
        schema: z.number().int().min(1),
        defaultValue: 500,
      },
      {
        key: "retention.rawEventsEnabled",
        label: "Удаление сырых событий",
        description:
          "Включить удаление сырых событий по retention. По умолчанию выключено.",
        schema: z.boolean(),
        defaultValue: false,
      },
      {
        key: "retention.auditEnabled",
        label: "Удаление записей аудита",
        description:
          "Включить удаление записей аудита по retention. По умолчанию выключено.",
        schema: z.boolean(),
        defaultValue: false,
      },
      {
        key: "retention.chatEnabled",
        label: "Удаление истории чата",
        description:
          "Включить удаление истории чата по retention. По умолчанию включено.",
        schema: z.boolean(),
        defaultValue: true,
      },
      {
        key: "retention.blocksEnabled",
        label: "Удаление блоков знаний",
        description:
          "Включить удаление блоков знаний по retention. По умолчанию выключено.",
        schema: z.boolean(),
        defaultValue: false,
      },
    ],
  },
  {
    title: "Логирование",
    description: "Запись логов приложения в БД, уровни, буферизация и хранение.",
    specs: [
      {
        key: "logging.dbLoggingEnabled",
        label: "Запись логов в БД",
        description: "Запись логов приложения в БД. По умолчанию включено.",
        schema: z.boolean(),
        defaultValue: true,
      },
      {
        key: "logging.minLevel",
        label: "Минимальный уровень логов",
        description:
          "Минимальный уровень логов, записываемых в БД (DEBUG/INFO/WARN/ERROR/FATAL). По умолчанию INFO.",
        schema: z.enum(["DEBUG", "INFO", "WARN", "ERROR", "FATAL"]),
        defaultValue: "INFO",
      },
      {
        key: "logging.batchSize",
        label: "Размер пачки записи логов (строк)",
        description: "Размер пачки записи логов в БД (строк). По умолчанию 50.",
        schema: z.number().int().min(1).max(1000),
        defaultValue: 50,
      },
      {
        key: "logging.flushIntervalMs",
        label: "Интервал сброса буфера (мс)",
        description:
          "Интервал сброса буфера логов в БД (мс). По умолчанию 5000.",
        schema: z.number().int().min(500).max(600_000),
        defaultValue: 5_000,
      },
      {
        key: "logging.maxBufferSize",
        label: "Максимальный размер буфера (строк)",
        description:
          "Максимальный размер буфера логов до принудительного сброса (строк). По умолчанию 5000.",
        schema: z.number().int().min(100).max(100_000),
        defaultValue: 5_000,
      },
      {
        key: "logging.retentionDays",
        label: "Срок хранения логов в БД (дни)",
        description: "Срок хранения логов в БД (дни). По умолчанию 30.",
        schema: z.number().int().min(1).max(3_650),
        defaultValue: 30,
      },
      {
        key: "logging.logStackTraces",
        label: "Сохранять стектрейсы",
        description: "Сохранять стектрейсы в логах БД. По умолчанию включено.",
        schema: z.boolean(),
        defaultValue: true,
      },
      {
        key: "logging.requestBodyLogging",
        label: "Логировать тело запросов",
        description:
          "Логировать тело входящих запросов (может содержать ПДн). По умолчанию выключено.",
        schema: z.boolean(),
        defaultValue: false,
      },
      {
        key: "logging.responseBodyLogging",
        label: "Логировать тело ответов",
        description:
          "Логировать тело ответов (может содержать ПДн). По умолчанию выключено.",
        schema: z.boolean(),
        defaultValue: false,
      },
      {
        key: "logging.logSuccessfulRequests",
        label: "Логировать успешные запросы",
        description:
          "Логировать успешные запросы (не только ошибки). По умолчанию выключено.",
        schema: z.boolean(),
        defaultValue: false,
      },
      {
        key: "logging.slowRequestThresholdMs",
        label: "Порог медленного запроса (мс)",
        description:
          "Порог «медленного запроса» для логирования (мс). По умолчанию 2000.",
        schema: z.number().int().min(0).max(600_000),
        defaultValue: 2_000,
      },
    ],
  },
];

export function RetentionLoggingSettingsClient(): JSX.Element {
  return (
    <DomainSettingsClient
      breadcrumbLabel="Хранение и логи"
      title="Хранение и логи"
      description="Сроки хранения данных, рубильники retention-sweep и параметры записи логов приложения в БД."
      groups={GROUPS}
    />
  );
}
