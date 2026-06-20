import { type Prisma } from '@prisma/client';

import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

type Severity = 'low' | 'medium' | 'high' | 'destructive';

interface SettingSeed {
  key: string;
  value: unknown;
  category: string;
  section: string;
  severity: Severity;
  description: string;
}

const SEEDS: SettingSeed[] = [
  {
    key: 'limits.clipMaxDurationSeconds',
    value: 300,
    category: 'platform',
    section: 'limits',
    severity: 'low',
    description: 'Максимальная длительность клипа (сек). По умолчанию 300.',
  },
  {
    key: 'limits.exportZipMaxMeetings',
    value: 100,
    category: 'platform',
    section: 'limits',
    severity: 'low',
    description: 'Максимум встреч в одном ZIP-экспорте. По умолчанию 100.',
  },
  {
    key: 'limits.exportZipMaxBytes',
    value: 21_474_836_480,
    category: 'platform',
    section: 'limits',
    severity: 'low',
    description: 'Максимальный размер ZIP-экспорта (байт). По умолчанию 20 ГБ.',
  },
  {
    key: 'limits.maxApiKeysPerUser',
    value: 10,
    category: 'platform',
    section: 'limits',
    severity: 'low',
    description: 'Максимум API-ключей на пользователя. По умолчанию 10.',
  },
  {
    key: 'limits.maxWebhookSubscriptionsPerUser',
    value: 20,
    category: 'platform',
    section: 'limits',
    severity: 'low',
    description: 'Максимум подписок на вебхуки на пользователя. По умолчанию 20.',
  },
  {
    key: 'limits.maxDestinationsPerUser',
    value: 20,
    category: 'platform',
    section: 'limits',
    severity: 'low',
    description: 'Максимум назначений доставки на пользователя. По умолчанию 20.',
  },
  {
    key: 'limits.maxTagsPerUser',
    value: 50,
    category: 'platform',
    section: 'limits',
    severity: 'low',
    description: 'Максимум тегов на пользователя. По умолчанию 50.',
  },
  {
    key: 'limits.maxUserTemplatesPerUser',
    value: 20,
    category: 'platform',
    section: 'limits',
    severity: 'low',
    description: 'Максимум пользовательских шаблонов на пользователя. По умолчанию 20.',
  },
  {
    key: 'limits.maxChatRequestsPerDay',
    value: 200,
    category: 'platform',
    section: 'limits',
    severity: 'medium',
    description: 'Максимум запросов в AI-чат на пользователя в сутки. По умолчанию 200.',
  },
  {
    key: 'limits.maxChatTokensPerDay',
    value: 2_000_000,
    category: 'platform',
    section: 'limits',
    severity: 'medium',
    description: 'Максимум токенов AI-чата на пользователя в сутки. По умолчанию 2 000 000.',
  },
  {
    key: 'limits.maxRenderJobsPerHour',
    value: 10,
    category: 'platform',
    section: 'limits',
    severity: 'low',
    description: 'Максимум задач рендера на пользователя в час. По умолчанию 10.',
  },
  {
    key: 'limits.maxBulkExportsPerDay',
    value: 5,
    category: 'platform',
    section: 'limits',
    severity: 'low',
    description: 'Максимум массовых экспортов на пользователя в сутки. По умолчанию 5.',
  },
  {
    key: 'limits.maxRegeneratePerMeetingPerDay',
    value: 5,
    category: 'platform',
    section: 'limits',
    severity: 'low',
    description: 'Максимум перегенераций отчёта одной встречи в сутки. По умолчанию 5.',
  },
  {
    key: 'limits.maxMeetingsCreatedPerDayViaApi',
    value: 100,
    category: 'platform',
    section: 'limits',
    severity: 'low',
    description: 'Максимум встреч, создаваемых через API в сутки. По умолчанию 100.',
  },
  {
    key: 'limits.maxEmbeddingTokensPerMonthPerUser',
    value: 10_000_000,
    category: 'platform',
    section: 'limits',
    severity: 'medium',
    description: 'Максимум токенов эмбеддингов на пользователя в месяц. По умолчанию 10 000 000.',
  },
  {
    key: 'limits.maxHighlightsPerMeeting',
    value: 50,
    category: 'platform',
    section: 'limits',
    severity: 'low',
    description: 'Максимум хайлайтов на одну встречу. По умолчанию 50.',
  },
  {
    key: 'limits.maxBulkOperationIds',
    value: 200,
    category: 'platform',
    section: 'limits',
    severity: 'low',
    description: 'Максимум идентификаторов в одной массовой операции. По умолчанию 200.',
  },
  {
    key: 'limits.maxChatMessageChars',
    value: 8_000,
    category: 'platform',
    section: 'limits',
    severity: 'low',
    description: 'Максимум символов в сообщении AI-чата. По умолчанию 8000.',
  },
  {
    key: 'limits.maxRoomMessageChars',
    value: 2_000,
    category: 'platform',
    section: 'limits',
    severity: 'low',
    description: 'Максимум символов в сообщении чата комнаты. По умолчанию 2000.',
  },
  {
    key: 'limits.maxCardsPerUser',
    value: 500,
    category: 'platform',
    section: 'limits',
    severity: 'low',
    description: 'Максимум карточек на пользователя. По умолчанию 500.',
  },
  {
    key: 'limits.maxCardRollupsPerDay',
    value: 100,
    category: 'platform',
    section: 'limits',
    severity: 'low',
    description: 'Максимум сверток карточек в сутки. По умолчанию 100.',
  },
  {
    key: 'limits.maxGoalRecomputePerDay',
    value: 5,
    category: 'platform',
    section: 'limits',
    severity: 'low',
    description: 'Максимум пересчётов целей в сутки. По умолчанию 5.',
  },
  {
    key: 'limits.maxParticipantsPerMeeting',
    value: 10,
    category: 'platform',
    section: 'limits',
    severity: 'medium',
    description: 'Максимум участников встречи. По умолчанию 10.',
  },
  {
    key: 'limits.maxMeetingDurationHours',
    value: 8,
    category: 'platform',
    section: 'limits',
    severity: 'medium',
    description: 'Максимальная длительность встречи (часы). По умолчанию 8.',
  },

  {
    key: 'share.tokenLengthBytes',
    value: 24,
    category: 'platform',
    section: 'share',
    severity: 'medium',
    description: 'Длина токена публичной ссылки (байт). По умолчанию 24.',
  },
  {
    key: 'share.defaultExpirationDays',
    value: 7,
    category: 'platform',
    section: 'share',
    severity: 'low',
    description: 'Срок действия публичной ссылки по умолчанию (дни). По умолчанию 7.',
  },
  {
    key: 'share.allowedExpirationDays',
    value: [1, 7, 14],
    category: 'platform',
    section: 'share',
    severity: 'low',
    description: 'Допустимые сроки действия публичной ссылки (дни). По умолчанию [1, 7, 14].',
  },

  {
    key: 'aiChatQuota.dailyLimitAdmin',
    value: 50,
    category: 'platform',
    section: 'ai_chat_quota',
    severity: 'medium',
    description: 'Суточная квота AI-чата для администраторов. По умолчанию 50.',
  },
  {
    key: 'aiChatQuota.dailyLimitMember',
    value: 20,
    category: 'platform',
    section: 'ai_chat_quota',
    severity: 'medium',
    description: 'Суточная квота AI-чата для участников. По умолчанию 20.',
  },
  {
    key: 'aiChatQuota.adminRoles',
    value: 'owner,admin,coo',
    category: 'platform',
    section: 'ai_chat_quota',
    severity: 'medium',
    description: 'Роли с админской квотой AI-чата (через запятую). По умолчанию owner,admin,coo.',
  },

  {
    key: 'smartTables.maxRowsPerTable',
    value: 100_000,
    category: 'platform',
    section: 'smart_tables',
    severity: 'medium',
    description: 'Максимум строк в одной умной таблице. По умолчанию 100 000.',
  },
  {
    key: 'smartTables.maxPropsPerTable',
    value: 200,
    category: 'platform',
    section: 'smart_tables',
    severity: 'low',
    description: 'Максимум свойств (колонок) в одной умной таблице. По умолчанию 200.',
  },
  {
    key: 'smartTables.maxTablesPerOrg',
    value: 1_000,
    category: 'platform',
    section: 'smart_tables',
    severity: 'medium',
    description: 'Максимум умных таблиц на организацию. По умолчанию 1000.',
  },
  {
    key: 'smartTables.maxCellSizeBytes',
    value: 1_048_576,
    category: 'platform',
    section: 'smart_tables',
    severity: 'low',
    description: 'Максимальный размер значения ячейки (байт). По умолчанию 1 МБ.',
  },
  {
    key: 'smartTables.importMaxFileMb',
    value: 25,
    category: 'platform',
    section: 'smart_tables',
    severity: 'low',
    description: 'Максимальный размер файла импорта в умную таблицу (МБ). По умолчанию 25.',
  },
  {
    key: 'smartTables.importMaxRows',
    value: 5_000,
    category: 'platform',
    section: 'smart_tables',
    severity: 'low',
    description: 'Максимум строк за один импорт в умную таблицу. По умолчанию 5000.',
  },
];

interface Counters {
  created: number;
  updated: number;
  skippedAdminEdited: number;
}

async function upsertSetting(seed: SettingSeed, counters: Counters): Promise<void> {
  const existing = await prisma.adminSetting.findUnique({
    where: { key: seed.key },
    select: { updatedBy: true },
  });
  const valueInput = seed.value as Prisma.InputJsonValue;

  if (!existing) {
    await prisma.adminSetting.create({
      data: {
        key: seed.key,
        value: valueInput,
        category: seed.category,
        section: seed.section,
        severity: seed.severity,
        description: seed.description,
      },
    });
    counters.created++;
    console.log(`[create] ${seed.key}`);
    return;
  }

  if (existing.updatedBy && existing.updatedBy !== 'system') {
    await prisma.adminSetting.update({
      where: { key: seed.key },
      data: {
        category: seed.category,
        section: seed.section,
        severity: seed.severity,
        description: seed.description,
      },
    });
    counters.skippedAdminEdited++;
    console.log(`[skip:admin-edited] ${seed.key}`);
    return;
  }

  await prisma.adminSetting.update({
    where: { key: seed.key },
    data: {
      value: valueInput,
      category: seed.category,
      section: seed.section,
      severity: seed.severity,
      description: seed.description,
    },
  });
  counters.updated++;
  console.log(`[update] ${seed.key}`);
}

async function main(): Promise<void> {
  console.log('=== seed-admin-setting-limits START ===');

  const counters: Counters = {
    created: 0,
    updated: 0,
    skippedAdminEdited: 0,
  };

  for (const seed of SEEDS) {
    await upsertSetting(seed, counters);
  }

  console.log(
    `created=${counters.created}, updated=${counters.updated}, skipped_admin_edited=${counters.skippedAdminEdited}`,
  );
  console.log('=== seed-admin-setting-limits DONE ===');
}

main()
  .catch((err) => {
    console.error('seed-admin-setting-limits FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });

export { SEEDS };
