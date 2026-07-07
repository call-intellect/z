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
    key: 'probe.dedupTtlHours',
    value: 72,
    category: 'knowledge',
    section: 'probe',
    severity: 'low',
    description:
      'Окно дедупликации уточняющих вопросов (probe) в часах: повторный вопрос той же темы не задаётся раньше. По умолчанию 72.',
  },
  {
    key: 'probe.rateLimitPerHour',
    value: 5,
    category: 'knowledge',
    section: 'probe',
    severity: 'medium',
    description:
      'Лимит уточняющих вопросов (probe) одному пользователю в час. По умолчанию 5.',
  },
  {
    key: 'probe.rateLimitPerDay',
    value: 5,
    category: 'knowledge',
    section: 'probe',
    severity: 'medium',
    description:
      'Лимит уточняющих вопросов (probe) одному пользователю в сутки. По умолчанию 5.',
  },
  {
    key: 'probe.expiryDays',
    value: 14,
    category: 'knowledge',
    section: 'probe',
    severity: 'low',
    description:
      'Срок жизни неотвеченного уточняющего вопроса (probe) в днях до истечения. По умолчанию 14.',
  },
  {
    key: 'probe.quietHoursDefaultTzOffsetMin',
    value: 180,
    category: 'knowledge',
    section: 'probe',
    severity: 'low',
    description:
      'Смещение часового пояса по умолчанию (минуты) для тихих часов probe, когда у пользователя нет своего. По умолчанию 180 (UTC+3).',
  },
  {
    key: 'probe.coldStartModeHours',
    value: 24,
    category: 'knowledge',
    section: 'probe',
    severity: 'low',
    description:
      'Длительность режима холодного старта probe (часы) для нового пользователя/орг. По умолчанию 24.',
  },
  {
    key: 'probe.responseClassifyEnabled',
    value: true,
    category: 'knowledge',
    section: 'probe',
    severity: 'medium',
    description:
      'Распознавание свободного ответа на probe входным классификатором (без явного reply). По умолчанию true (Ship-On).',
  },
  {
    key: 'probe.subjectAddressingEnabled',
    value: true,
    category: 'knowledge',
    section: 'probe',
    severity: 'medium',
    description:
      'Адресация probe про сотрудника самому сотруднику → главе отдела → владельцу (не владельцу напрямую). По умолчанию true (Ship-On).',
  },
  {
    key: 'probe.voiceInputEnabled',
    value: true,
    category: 'knowledge',
    section: 'probe',
    severity: 'low',
    description:
      'Голосовой ввод ответа на probe (микрофон → ASR). По умолчанию true (Ship-On).',
  },
  {
    key: 'probe.responseClassifyMinConfidence',
    value: 0.5,
    category: 'knowledge',
    section: 'probe',
    severity: 'low',
    description:
      'Порог уверенности входного классификатора для распознавания свободного ответа на probe (0..1). По умолчанию 0.5.',
  },

  {
    key: 'knowledge.curationItemExpiryDays',
    value: 30,
    category: 'knowledge',
    section: 'curation',
    severity: 'low',
    description:
      'Срок жизни элемента очереди курации (дни) до истечения. По умолчанию 30.',
  },
  {
    key: 'knowledge.curationStaleMonthsThreshold',
    value: 6,
    category: 'knowledge',
    section: 'curation',
    severity: 'low',
    description:
      'Порог «устаревания» карточки (месяцы без обновления) для детектора устаревших карточек. По умолчанию 6.',
  },
  {
    key: 'knowledge.curationStaleDynamicScoreThreshold',
    value: 0.3,
    category: 'knowledge',
    section: 'curation',
    severity: 'low',
    description:
      'Порог динамического балла (0..1), ниже которого карточка считается устаревшей. По умолчанию 0.3.',
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
  console.log('=== seed-admin-setting-probe-curation START ===');

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
  console.log('=== seed-admin-setting-probe-curation DONE ===');
}

main()
  .catch((err) => {
    console.error('seed-admin-setting-probe-curation FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });

export { SEEDS };
