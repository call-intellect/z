import { type Prisma } from '@prisma/client';

import { createPrismaClient } from './_lib/prisma';

const OLD_KEY = 'operations.personal_day_narrative.evening_hour';
const NEW_KEY = 'operations.personal_day_narrative.morning_hour';
const DEFAULT_MORNING_HOUR = 7;
const NEW_DESCRIPTION =
  'Час локального времени сотрудника (0–23), в который УТРОМ генерится и рассылается письмо-отчёт «Твой день» про ВЧЕРАШНИЙ день. По умолчанию 7.';

function toMorningHour(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 23) {
    return value;
  }
  return DEFAULT_MORNING_HOUR;
}

async function main(): Promise<void> {
  console.log('=== patch-personal-day-narrative-morning-hour START ===');
  const prisma = createPrismaClient();
  try {
    const old = await prisma.adminSetting.findUnique({
      where: { key: OLD_KEY },
      select: { value: true },
    });
    if (!old) {
      console.log(`[skip] ${OLD_KEY} отсутствует — нечего переименовывать (no-op).`);
      return;
    }

    const existingNew = await prisma.adminSetting.findUnique({
      where: { key: NEW_KEY },
      select: { key: true },
    });

    if (!existingNew) {
      const hour = toMorningHour(old.value);
      await prisma.adminSetting.create({
        data: {
          key: NEW_KEY,
          value: hour as unknown as Prisma.InputJsonValue,
          category: 'operations',
          section: 'workers',
          severity: 'low',
          description: NEW_DESCRIPTION,
        },
      });
      console.log(`[create] ${NEW_KEY}=${hour} (из ${OLD_KEY})`);
    } else {
      console.log(`[ok] ${NEW_KEY} уже существует — не трогаю.`);
    }

    await prisma.adminSetting.delete({ where: { key: OLD_KEY } });
    console.log(`[delete] ${OLD_KEY}`);
  } finally {
    await prisma.$disconnect();
    console.log('=== patch-personal-day-narrative-morning-hour DONE ===');
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('patch-personal-day-narrative-morning-hour FAILED:', err);
    process.exit(1);
  });
}

export { main };
