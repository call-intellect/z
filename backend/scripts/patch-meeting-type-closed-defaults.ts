import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

const INTERVIEW_ID = 'interview';
const PERSONAL = 'personal';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  // eslint-disable-next-line no-console
  console.log(`=== patch-meeting-type-closed-defaults START (dryRun=${dryRun}) ===`);

  const row = await prisma.meetingTypeConfig.findUnique({
    where: { id: INTERVIEW_ID },
    select: { id: true, defaultClosedGroupKind: true, sortOrder: true },
  });

  if (!row) {
    if (dryRun) {
      // eslint-disable-next-line no-console
      console.log(
        `[dry-run] Строки MeetingTypeConfig id='${INTERVIEW_ID}' нет — была бы создана с ` +
          `defaultClosedGroupKind='${PERSONAL}'.`,
      );
      return;
    }
    await prisma.meetingTypeConfig.create({
      data: {
        id: INTERVIEW_ID,
        displayName: INTERVIEW_ID,
        isActive: true,
        sortOrder: 7,
        defaultClosedGroupKind: PERSONAL,
      },
    });
    // eslint-disable-next-line no-console
    console.log(
      `[create] Создана минимальная строка interview с defaultClosedGroupKind='${PERSONAL}' ` +
        `(bootstrap при первом GET пересоздавать не будет — count>0).`,
    );
    // eslint-disable-next-line no-console
    console.log('=== patch-meeting-type-closed-defaults DONE ===');
    return;
  }

  if (row.defaultClosedGroupKind !== null) {
    // eslint-disable-next-line no-console
    console.log(
      `[skip] interview.defaultClosedGroupKind уже задан ('${row.defaultClosedGroupKind}') — ` +
        `не перезаписываем (safe-seed).`,
    );
    // eslint-disable-next-line no-console
    console.log('=== patch-meeting-type-closed-defaults DONE ===');
    return;
  }

  if (dryRun) {
    // eslint-disable-next-line no-console
    console.log(
      `[dry-run] interview.defaultClosedGroupKind IS NULL → было бы выставлено '${PERSONAL}'.`,
    );
    return;
  }

  const result = await prisma.meetingTypeConfig.updateMany({
    where: { id: INTERVIEW_ID, defaultClosedGroupKind: null },
    data: { defaultClosedGroupKind: PERSONAL },
  });
  // eslint-disable-next-line no-console
  console.log(
    `[update] Обновлено строк MeetingTypeConfig: ${result.count} ` +
      `(interview → defaultClosedGroupKind='${PERSONAL}')`,
  );

  // eslint-disable-next-line no-console
  console.log('=== patch-meeting-type-closed-defaults DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('patch-meeting-type-closed-defaults FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });
