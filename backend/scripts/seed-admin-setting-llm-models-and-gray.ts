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
    key: 'ai.anthropic.model',
    value: 'claude-sonnet-4-6',
    category: 'ai',
    section: 'models',
    severity: 'medium',
    description:
      'Модель Anthropic (Claude) по умолчанию для задач, маршрутизируемых на этого провайдера. По умолчанию claude-sonnet-4-6.',
  },
  {
    key: 'ai.vox.model',
    value: 'v3_rnnt',
    category: 'ai',
    section: 'models',
    severity: 'medium',
    description: 'Модель ASR Vox (транскрибация). По умолчанию v3_rnnt.',
  },
  {
    key: 'ai.deepseek.defaultModel',
    value: 'deepseek-v4-flash',
    category: 'ai',
    section: 'models',
    severity: 'medium',
    description:
      'Модель DeepSeek по умолчанию для задач без явной модели в цепочке роутера. По умолчанию deepseek-v4-flash.',
  },
  {
    key: 'gepa.reflectionLm',
    value: 'deepseek-v4-pro',
    category: 'ai',
    section: 'models',
    severity: 'low',
    description:
      'Модель рефлексии GEPA (эволюция промптов). По умолчанию deepseek-v4-pro.',
  },
  {
    key: 'gepa.taskLm',
    value: 'deepseek-v4-pro',
    category: 'ai',
    section: 'models',
    severity: 'low',
    description: 'Модель исполнения задачи GEPA (эволюция промптов). По умолчанию deepseek-v4-pro.',
  },

  {
    key: 'ai.mainReport.primary',
    value: 'deepseek',
    category: 'ai',
    section: 'main_report',
    severity: 'high',
    description:
      'Основной провайдер ГЛАВНОГО отчёта встречи (LlmFallbackService): deepseek (Ship-On) или откат minimax. Аварийный рубильник-откат каскада. По умолчанию deepseek.',
  },
  {
    key: 'mail.dryRun',
    value: false,
    category: 'platform',
    section: 'mail',
    severity: 'high',
    description:
      'Сухой прогон почты: при true письма не отправляются реально, а логируются. По умолчанию false.',
  },
  {
    key: 'operations.daily_digest.deliver_to_webpush',
    value: true,
    category: 'operations',
    section: 'daily_digest',
    severity: 'medium',
    description:
      'Доставка утреннего exec web-push «Требует тебя сегодня: N» (ExecMorningPushCron). Аварийный рубильник, действий владельца не требует. По умолчанию true (Ship-On).',
  },

  {
    key: 'betaOps.morningLocalHour',
    value: 9,
    category: 'operations',
    section: 'digest_hours',
    severity: 'low',
    description:
      'Локальный час утреннего ежедневного чек-ина (0..23). Читается per-run, применяется без рестарта. По умолчанию 9.',
  },
  {
    key: 'betaOps.eveningLocalHour',
    value: 18,
    category: 'operations',
    section: 'digest_hours',
    severity: 'low',
    description:
      'Локальный час вечернего ежедневного чек-ина (0..23). Читается per-run. По умолчанию 18.',
  },
  {
    key: 'betaOps.weeklyDigestLocalHour',
    value: 6,
    category: 'operations',
    section: 'digest_hours',
    severity: 'low',
    description:
      'Локальный час недельного COO-дайджеста (0..23). Читается per-run. По умолчанию 6.',
  },
  {
    key: 'betaOps.weeklyDigestLocalDay',
    value: 1,
    category: 'operations',
    section: 'digest_hours',
    severity: 'low',
    description:
      'День недели недельного COO-дайджеста (0=воскресенье..6=суббота). Читается per-run. По умолчанию 1 (понедельник).',
  },
  {
    key: 'betaOps.dailyDigestHourUtc',
    value: 22,
    category: 'operations',
    section: 'digest_hours',
    severity: 'low',
    description:
      'Час дневного COO-дайджеста в UTC (0..23). Читается per-run. По умолчанию 22.',
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
  console.log('=== seed-admin-setting-llm-models-and-gray START ===');

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
  console.log('=== seed-admin-setting-llm-models-and-gray DONE ===');
}

main()
  .catch((err) => {
    console.error('seed-admin-setting-llm-models-and-gray FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });

export { SEEDS };
