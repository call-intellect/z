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
    key: 'operations.value_recap.enabled',
    value: true,
    category: 'operations',
    section: 'value_recap',
    severity: 'medium',
    description:
      'Kill-switch месячной витрины value-recap (cron 1-го числа месяца → build за прошлый месяц + push-first владельцу/COO). true (Ship-On).',
  },
  {
    key: 'chat_v2.feedback.enabled',
    value: true,
    category: 'operations',
    section: 'value_recap',
    severity: 'medium',
    description:
      'Kill-switch оценки ответов AI-чата (палец вверх/вниз на ChatV2Message, web + Telegram/in_app). Несущая часть helped-rate витрины. true (Ship-On).',
  },
  {
    key: 'chat_v2.feedback.min_rated',
    value: 10,
    category: 'operations',
    section: 'value_recap',
    severity: 'low',
    description:
      'Минимум оценок ответов, ниже которого helped-rate скрывается («мало данных»: 1/1=100% при крошечном знаменателе вводит в заблуждение). По умолчанию 10.',
  },
  {
    key: 'chat_v2.feedback.retry_dedup_seconds',
    value: 30,
    category: 'operations',
    section: 'value_recap',
    severity: 'low',
    description:
      'Окно дедупа повторных вопросов (ретраев) пользователя в метрике чата: user-сообщения одного диалога ближе N секунд считаются одним вопросом. По умолчанию 30.',
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
  console.log('=== seed-admin-setting-value-recap START ===');

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
  console.log('=== seed-admin-setting-value-recap DONE ===');
}

main()
  .catch((err) => {
    console.error('seed-admin-setting-value-recap FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });

export { SEEDS };
