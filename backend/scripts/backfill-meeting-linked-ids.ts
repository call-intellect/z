import { createPrismaClient } from './_lib/prisma';

/**
 * Backfill linkedMeetingIds для Issues, созданных из meeting-intake ДО фикса 2026-06-17.
 * Идемпотентен: обновляет только записи, где linkedMeetingIds пуст И externalId
 * начинается с 'meeting:' (формат intake.service.ts: meeting:<meetingId>:<hash>).
 * Issues с 'mea_'-externalId (meeting-extract-actions) НЕ восстановимы — meetingId
 * там в необратимом sha1-хэше.
 */
async function main() {
  const prisma = createPrismaClient();
  let updated = 0;

  const issues = await prisma.issue.findMany({
    where: {
      externalSource: 'meeting',
      linkedMeetingIds: { equals: [] },
    },
    select: { id: true, externalId: true },
  });

  for (const issue of issues) {
    if (!issue.externalId?.startsWith('meeting:')) continue;
    const meetingId = issue.externalId.split(':')[1];
    if (!meetingId) continue;
    await prisma.issue.update({
      where: { id: issue.id },
      data: { linkedMeetingIds: [meetingId] },
    });
    updated++;
  }

  console.log(`backfill-meeting-linked-ids: updated ${updated} из ${issues.length} кандидатов`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
