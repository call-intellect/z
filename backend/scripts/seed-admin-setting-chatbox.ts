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
    key: 'chatbox.session.idle_gap_hours',
    value: 12,
    category: 'chatbox',
    section: 'session',
    severity: 'low',
    description:
      'Порог паузы (часы) между сообщениями, после которого начинается новая сессия-сегмент чата для LLM-анализа.',
  },
  {
    key: 'chatbox.enabled',
    value: true,
    category: 'chatbox',
    section: 'general',
    severity: 'medium',
    description:
      'Kill-switch ChatBox-интеграции. False → синк-кроны и webhook работают в no-op без рестарта.',
  },
  {
    key: 'chatbox.analyze.stuckAnalyzingMin',
    value: 15,
    category: 'chatbox',
    section: 'general',
    severity: 'low',
    description:
      'Порог в минутах, после которого сессия в статусе analyzing считается зависшей (воркер умер между analyzing и done/failed) и переподбирается догоняющим sweep-кроном анализа.',
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
  console.log('=== seed-admin-setting-chatbox START ===');

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

  console.log('=== seed-admin-setting-chatbox DONE ===');
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('seed-admin-setting-chatbox FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });

export { SEEDS };
