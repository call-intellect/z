import type { Prisma } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

type Severity = 'low' | 'medium' | 'high' | 'destructive';

interface BillingSettingSeed {
  key: string;
  value: number;
  description: string;
  severity?: Severity;
}

const SEEDS: BillingSettingSeed[] = [
  {
    key: 'billing.baseMonthlyKopecks',
    value: 6_000_000,
    description: 'Базовая цена tier_standard в копейках (месяц)',
  },
  {
    key: 'billing.perExtraSeatKopecks',
    value: 100_000,
    description: 'Цена дополнительного места сверх базовых, в копейках (месяц)',
  },
  {
    key: 'billing.yearlyDiscountRate',
    value: 0.8,
    description: 'Множитель цены при годовой оплате (0.8 = -20%)',
  },
  {
    key: 'billing.baseSeatsIncluded',
    value: 31,
    description: 'Сколько мест включено в базовый tier_standard',
  },
  {
    key: 'billing.baseMeetingsGrant',
    value: 150,
    description: 'Грант встреч на месяц для tier_standard',
  },
  {
    key: 'billing.perExtraSeatMeetingsGrant',
    value: 5,
    description: 'Дополнительный грант встреч за каждое доп. место',
  },
  {
    key: 'billing.meetingUploadsPerMonth',
    value: 20,
    description: 'Месячный лимит ручных загрузок встреч на компанию',
    severity: 'medium',
  },
];

const CATEGORY = 'billing';
const SECTION = 'tariff-standard';
const SEVERITY: Severity = 'high';

async function main(): Promise<void> {
  console.log('=== seed-admin-settings-billing START ===');

  let created = 0;
  let skipped = 0;

  for (const seed of SEEDS) {
    const existing = await prisma.adminSetting.findUnique({
      where: { key: seed.key },
      select: { key: true },
    });

    if (existing) {
      skipped++;
      console.log(`  skip  ${seed.key} (уже есть)`);
      continue;
    }

    await prisma.adminSetting.create({
      data: {
        key: seed.key,
        value: seed.value as Prisma.InputJsonValue,
        category: CATEGORY,
        section: SECTION,
        severity: seed.severity ?? SEVERITY,
        description: seed.description,
        schemaId: null,
        updatedBy: null,
      },
    });
    created++;
    console.log(`  +     ${seed.key} = ${seed.value}`);
  }

  console.log('=== seed-admin-settings-billing SUMMARY ===');
  console.log(`создано: ${created}, пропущено: ${skipped}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('seed-admin-settings-billing: ERROR', err);
    await prisma.$disconnect();
    process.exit(1);
  });
