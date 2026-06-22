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
    key: 'retention.defaultDays',
    value: 30,
    category: 'platform',
    section: 'retention',
    severity: 'medium',
    description: 'Срок хранения по умолчанию (дни) до удаления данных по retention-sweep. По умолчанию 30.',
  },
  {
    key: 'retention.softDeleteGraceDays',
    value: 30,
    category: 'platform',
    section: 'retention',
    severity: 'medium',
    description: 'Льготный период (дни) после мягкого удаления до физического удаления. По умолчанию 30.',
  },
  {
    key: 'retention.webhookDeliveryDays',
    value: 30,
    category: 'platform',
    section: 'retention',
    severity: 'low',
    description: 'Срок хранения журналов доставки вебхуков (дни). По умолчанию 30.',
  },
  {
    key: 'retention.shareViewDays',
    value: 90,
    category: 'platform',
    section: 'retention',
    severity: 'low',
    description: 'Срок хранения событий просмотра публичных ссылок (дни). По умолчанию 90.',
  },
  {
    key: 'retention.apiAccessLogDays',
    value: 30,
    category: 'platform',
    section: 'retention',
    severity: 'low',
    description: 'Срок хранения журнала доступа к API (дни). По умолчанию 30.',
  },
  {
    key: 'retention.sweepBatchSize',
    value: 500,
    category: 'platform',
    section: 'retention',
    severity: 'low',
    description: 'Размер пачки одного прохода retention-sweep (строк). По умолчанию 500.',
  },
  {
    key: 'retention.rawEventsEnabled',
    value: false,
    category: 'platform',
    section: 'retention',
    severity: 'medium',
    description: 'Включить удаление сырых событий по retention. По умолчанию выключено.',
  },
  {
    key: 'retention.auditEnabled',
    value: false,
    category: 'platform',
    section: 'retention',
    severity: 'medium',
    description: 'Включить удаление записей аудита по retention. По умолчанию выключено.',
  },
  {
    key: 'retention.chatEnabled',
    value: true,
    category: 'platform',
    section: 'retention',
    severity: 'medium',
    description: 'Включить удаление истории чата по retention. По умолчанию включено.',
  },
  {
    key: 'retention.blocksEnabled',
    value: false,
    category: 'platform',
    section: 'retention',
    severity: 'medium',
    description: 'Включить удаление блоков знаний по retention. По умолчанию выключено.',
  },

  {
    key: 'logging.dbLoggingEnabled',
    value: true,
    category: 'platform',
    section: 'logging',
    severity: 'low',
    description: 'Запись логов приложения в БД. По умолчанию включено.',
  },
  {
    key: 'logging.minLevel',
    value: 'INFO',
    category: 'platform',
    section: 'logging',
    severity: 'low',
    description: 'Минимальный уровень логов, записываемых в БД (DEBUG/INFO/WARN/ERROR/FATAL). По умолчанию INFO.',
  },
  {
    key: 'logging.batchSize',
    value: 50,
    category: 'platform',
    section: 'logging',
    severity: 'low',
    description: 'Размер пачки записи логов в БД (строк). По умолчанию 50.',
  },
  {
    key: 'logging.flushIntervalMs',
    value: 5_000,
    category: 'platform',
    section: 'logging',
    severity: 'low',
    description: 'Интервал сброса буфера логов в БД (мс). По умолчанию 5000.',
  },
  {
    key: 'logging.maxBufferSize',
    value: 5_000,
    category: 'platform',
    section: 'logging',
    severity: 'low',
    description: 'Максимальный размер буфера логов до принудительного сброса (строк). По умолчанию 5000.',
  },
  {
    key: 'logging.retentionDays',
    value: 30,
    category: 'platform',
    section: 'logging',
    severity: 'low',
    description: 'Срок хранения логов в БД (дни). По умолчанию 30.',
  },
  {
    key: 'logging.logStackTraces',
    value: true,
    category: 'platform',
    section: 'logging',
    severity: 'low',
    description: 'Сохранять стектрейсы в логах БД. По умолчанию включено.',
  },
  {
    key: 'logging.requestBodyLogging',
    value: false,
    category: 'platform',
    section: 'logging',
    severity: 'medium',
    description: 'Логировать тело входящих запросов (может содержать ПДн). По умолчанию выключено.',
  },
  {
    key: 'logging.responseBodyLogging',
    value: false,
    category: 'platform',
    section: 'logging',
    severity: 'medium',
    description: 'Логировать тело ответов (может содержать ПДн). По умолчанию выключено.',
  },
  {
    key: 'logging.logSuccessfulRequests',
    value: false,
    category: 'platform',
    section: 'logging',
    severity: 'low',
    description: 'Логировать успешные запросы (не только ошибки). По умолчанию выключено.',
  },
  {
    key: 'logging.slowRequestThresholdMs',
    value: 2_000,
    category: 'platform',
    section: 'logging',
    severity: 'low',
    description: 'Порог «медленного запроса» для логирования (мс). По умолчанию 2000.',
  },
  {
    key: 'ai.usageLog.previewMaxBytes',
    value: 32_768,
    category: 'platform',
    section: 'logging',
    severity: 'low',
    description:
      'Сколько байт промпта/ответа модели хранить в журнале вызовов (для диагностики и A/B). Больше — полнее diag, но крупнее БД.',
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
  console.log('=== seed-admin-setting-retention-logging START ===');

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
  console.log('=== seed-admin-setting-retention-logging DONE ===');
}

main()
  .catch((err) => {
    console.error('seed-admin-setting-retention-logging FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });

export { SEEDS };
