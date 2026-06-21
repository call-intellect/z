"use client";

import { z } from "zod";

import {
  DomainSettingsClient,
  type SettingsGroup,
} from "@/ui/components/admin/DomainSettings";

const GROUPS: SettingsGroup[] = [
  {
    title: "Лимиты",
    description:
      "Платформенные потолки на пользователя, встречу и организацию.",
    specs: [
      {
        key: "limits.clipMaxDurationSeconds",
        label: "Длительность клипа, сек",
        description:
          "Максимальная длительность клипа (сек). По умолчанию 300.",
        schema: z.number().int().min(1),
        defaultValue: 300,
      },
      {
        key: "limits.exportZipMaxMeetings",
        label: "Встреч в ZIP-экспорте",
        description:
          "Максимум встреч в одном ZIP-экспорте. По умолчанию 100.",
        schema: z.number().int().min(1),
        defaultValue: 100,
      },
      {
        key: "limits.exportZipMaxBytes",
        label: "Размер ZIP-экспорта, байт",
        description:
          "Максимальный размер ZIP-экспорта (байт). По умолчанию 20 ГБ.",
        schema: z.number().int().min(1),
        defaultValue: 21_474_836_480,
      },
      {
        key: "limits.maxApiKeysPerUser",
        label: "API-ключей на пользователя",
        description:
          "Максимум API-ключей на пользователя. По умолчанию 10.",
        schema: z.number().int().min(1),
        defaultValue: 10,
      },
      {
        key: "limits.maxWebhookSubscriptionsPerUser",
        label: "Подписок на вебхуки",
        description:
          "Максимум подписок на вебхуки на пользователя. По умолчанию 20.",
        schema: z.number().int().min(1),
        defaultValue: 20,
      },
      {
        key: "limits.maxDestinationsPerUser",
        label: "Назначений доставки",
        description:
          "Максимум назначений доставки на пользователя. По умолчанию 20.",
        schema: z.number().int().min(1),
        defaultValue: 20,
      },
      {
        key: "limits.maxTagsPerUser",
        label: "Тегов на пользователя",
        description:
          "Максимум тегов на пользователя. По умолчанию 50.",
        schema: z.number().int().min(1),
        defaultValue: 50,
      },
      {
        key: "limits.maxUserTemplatesPerUser",
        label: "Шаблонов на пользователя",
        description:
          "Максимум пользовательских шаблонов на пользователя. По умолчанию 20.",
        schema: z.number().int().min(1),
        defaultValue: 20,
      },
      {
        key: "limits.maxChatRequestsPerDay",
        label: "Запросов в AI-чат в сутки",
        description:
          "Максимум запросов в AI-чат на пользователя в сутки. По умолчанию 200.",
        schema: z.number().int().min(1),
        defaultValue: 200,
      },
      {
        key: "limits.maxChatTokensPerDay",
        label: "Токенов AI-чата в сутки",
        description:
          "Максимум токенов AI-чата на пользователя в сутки. По умолчанию 2 000 000.",
        schema: z.number().int().min(1),
        defaultValue: 2_000_000,
      },
      {
        key: "limits.maxRenderJobsPerHour",
        label: "Задач рендера в час",
        description:
          "Максимум задач рендера на пользователя в час. По умолчанию 10.",
        schema: z.number().int().min(1),
        defaultValue: 10,
      },
      {
        key: "limits.maxBulkExportsPerDay",
        label: "Массовых экспортов в сутки",
        description:
          "Максимум массовых экспортов на пользователя в сутки. По умолчанию 5.",
        schema: z.number().int().min(1),
        defaultValue: 5,
      },
      {
        key: "limits.maxRegeneratePerMeetingPerDay",
        label: "Перегенераций отчёта в сутки",
        description:
          "Максимум перегенераций отчёта одной встречи в сутки. По умолчанию 5.",
        schema: z.number().int().min(1),
        defaultValue: 5,
      },
      {
        key: "limits.maxMeetingsCreatedPerDayViaApi",
        label: "Встреч через API в сутки",
        description:
          "Максимум встреч, создаваемых через API в сутки. По умолчанию 100.",
        schema: z.number().int().min(1),
        defaultValue: 100,
      },
      {
        key: "limits.maxEmbeddingTokensPerMonthPerUser",
        label: "Токенов эмбеддингов в месяц",
        description:
          "Максимум токенов эмбеддингов на пользователя в месяц. По умолчанию 10 000 000.",
        schema: z.number().int().min(1),
        defaultValue: 10_000_000,
      },
      {
        key: "limits.maxHighlightsPerMeeting",
        label: "Хайлайтов на встречу",
        description:
          "Максимум хайлайтов на одну встречу. По умолчанию 50.",
        schema: z.number().int().min(1),
        defaultValue: 50,
      },
      {
        key: "limits.maxBulkOperationIds",
        label: "ID в массовой операции",
        description:
          "Максимум идентификаторов в одной массовой операции. По умолчанию 200.",
        schema: z.number().int().min(1),
        defaultValue: 200,
      },
      {
        key: "limits.maxChatMessageChars",
        label: "Символов в сообщении AI-чата",
        description:
          "Максимум символов в сообщении AI-чата. По умолчанию 8000.",
        schema: z.number().int().min(1),
        defaultValue: 8_000,
      },
      {
        key: "limits.maxRoomMessageChars",
        label: "Символов в сообщении комнаты",
        description:
          "Максимум символов в сообщении чата комнаты. По умолчанию 2000.",
        schema: z.number().int().min(1),
        defaultValue: 2_000,
      },
      {
        key: "limits.maxCardsPerUser",
        label: "Карточек на пользователя",
        description:
          "Максимум карточек на пользователя. По умолчанию 500.",
        schema: z.number().int().min(1),
        defaultValue: 500,
      },
      {
        key: "limits.maxCardRollupsPerDay",
        label: "Сверток карточек в сутки",
        description:
          "Максимум сверток карточек в сутки. По умолчанию 100.",
        schema: z.number().int().min(1),
        defaultValue: 100,
      },
      {
        key: "limits.maxGoalRecomputePerDay",
        label: "Пересчётов целей в сутки",
        description:
          "Максимум пересчётов целей в сутки. По умолчанию 5.",
        schema: z.number().int().min(1),
        defaultValue: 5,
      },
      {
        key: "limits.maxParticipantsPerMeeting",
        label: "Участников встречи",
        description:
          "Максимум участников встречи. По умолчанию 10.",
        schema: z.number().int().min(1),
        defaultValue: 10,
      },
      {
        key: "limits.maxMeetingDurationHours",
        label: "Длительность встречи, часы",
        description:
          "Максимальная длительность встречи (часы). По умолчанию 8.",
        schema: z.number().int().min(1),
        defaultValue: 8,
      },
    ],
  },
  {
    title: "Публичные ссылки (share)",
    description:
      "Параметры токенов и сроков действия публичных ссылок на отчёты.",
    specs: [
      {
        key: "share.tokenLengthBytes",
        label: "Длина токена, байт",
        description:
          "Длина токена публичной ссылки (байт). По умолчанию 24.",
        schema: z.number().int().min(1),
        defaultValue: 24,
      },
      {
        key: "share.defaultExpirationDays",
        label: "Срок по умолчанию, дни",
        description:
          "Срок действия публичной ссылки по умолчанию (дни). По умолчанию 7.",
        schema: z.number().int().min(1),
        defaultValue: 7,
      },
      {
        key: "share.allowedExpirationDays",
        label: "Допустимые сроки, дни",
        description:
          "Допустимые сроки действия публичной ссылки (дни). По умолчанию [1, 7, 14].",
        schema: z.array(z.number().int().min(1)),
        defaultValue: [1, 7, 14],
      },
    ],
  },
  {
    title: "Квоты AI-чата",
    description:
      "Суточные квоты обращений к AI-чату по ролям.",
    specs: [
      {
        key: "aiChatQuota.dailyLimitAdmin",
        label: "Квота для администраторов",
        description:
          "Суточная квота AI-чата для администраторов. По умолчанию 50.",
        schema: z.number().int().min(1),
        defaultValue: 50,
      },
      {
        key: "aiChatQuota.dailyLimitMember",
        label: "Квота для участников",
        description:
          "Суточная квота AI-чата для участников. По умолчанию 20.",
        schema: z.number().int().min(1),
        defaultValue: 20,
      },
      {
        key: "aiChatQuota.adminRoles",
        label: "Роли с админской квотой",
        description:
          "Роли с админской квотой AI-чата (через запятую). По умолчанию owner,admin,coo.",
        schema: z.string().min(1),
        defaultValue: "owner,admin,coo",
      },
    ],
  },
  {
    title: "Умные таблицы",
    description:
      "Потолки размера, числа таблиц и параметров импорта умных таблиц.",
    specs: [
      {
        key: "smartTables.maxRowsPerTable",
        label: "Строк в таблице",
        description:
          "Максимум строк в одной умной таблице. По умолчанию 100 000.",
        schema: z.number().int().min(1),
        defaultValue: 100_000,
      },
      {
        key: "smartTables.maxPropsPerTable",
        label: "Свойств в таблице",
        description:
          "Максимум свойств (колонок) в одной умной таблице. По умолчанию 200.",
        schema: z.number().int().min(1),
        defaultValue: 200,
      },
      {
        key: "smartTables.maxTablesPerOrg",
        label: "Таблиц на организацию",
        description:
          "Максимум умных таблиц на организацию. По умолчанию 1000.",
        schema: z.number().int().min(1),
        defaultValue: 1_000,
      },
      {
        key: "smartTables.maxCellSizeBytes",
        label: "Размер ячейки, байт",
        description:
          "Максимальный размер значения ячейки (байт). По умолчанию 1 МБ.",
        schema: z.number().int().min(1),
        defaultValue: 1_048_576,
      },
      {
        key: "smartTables.importMaxFileMb",
        label: "Размер файла импорта, МБ",
        description:
          "Максимальный размер файла импорта в умную таблицу (МБ). По умолчанию 25.",
        schema: z.number().int().min(1),
        defaultValue: 25,
      },
      {
        key: "smartTables.importMaxRows",
        label: "Строк за импорт",
        description:
          "Максимум строк за один импорт в умную таблицу. По умолчанию 5000.",
        schema: z.number().int().min(1),
        defaultValue: 5_000,
      },
    ],
  },
];

export function QuotasSettingsClient() {
  return (
    <DomainSettingsClient
      breadcrumbLabel="Квоты и пользовательские лимиты"
      title="Квоты и пользовательские лимиты"
      description="Платформенные лимиты, параметры публичных ссылок, суточные квоты AI-чата и потолки умных таблиц. БД-override поверх ENV с историей и аудитом."
      groups={GROUPS}
    />
  );
}
