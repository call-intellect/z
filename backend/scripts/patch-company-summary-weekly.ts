import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

const KEY = 'companyProfile.summaryRebuildHours';
const OLD_DEFAULT = 24;
const NEW_DEFAULT = 168;

async function main(): Promise<void> {
  console.log(
    `=== patch-company-summary-weekly START (${KEY}: ${OLD_DEFAULT} → ${NEW_DEFAULT}) ===`,
  );
  const existing = await prisma.adminSetting.findUnique({ where: { key: KEY } });
  if (!existing) {
    console.log(
      `[skip] настройка ${KEY} не найдена — её создаст seed-admin-settings.ts уже с дефолтом ${NEW_DEFAULT}`,
    );
    return;
  }
  const current = existing.value;
  if (typeof current === 'number' && current === OLD_DEFAULT) {
    await prisma.adminSetting.update({
      where: { key: KEY },
      data: { value: NEW_DEFAULT },
    });
    console.log(`[updated] ${KEY}: ${OLD_DEFAULT} → ${NEW_DEFAULT}`);
  } else {
    console.log(
      `[skip] ${KEY} = ${JSON.stringify(current)} (не ${OLD_DEFAULT}) — владелец менял вручную, не трогаем`,
    );
  }
}

main()
  .catch((err) => {
    console.error('patch-company-summary-weekly FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    console.log('=== patch-company-summary-weekly DONE ===');
  });
