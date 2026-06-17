import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

const REAL_IDENTITY_PREFIXES = ['host:', 'guest:'];

const PHANTOM_WHERE = {
  AND: REAL_IDENTITY_PREFIXES.map((prefix) => ({
    NOT: { livekitIdentity: { startsWith: prefix } },
  })),
} as const;

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  // eslint-disable-next-line no-console
  console.log(`=== patch-cleanup-egress-phantom-participants START (dryRun=${dryRun}) ===`);

  const phantoms = await prisma.participant.findMany({
    where: PHANTOM_WHERE,
    select: { id: true, meetingId: true, livekitIdentity: true, name: true },
  });

  // eslint-disable-next-line no-console
  console.log(`[count] фантомных Participant'ов: ${phantoms.length}`);

  if (phantoms.length === 0) {
    // eslint-disable-next-line no-console
    console.log('[skip] Нечего чистить — выходим');
    return;
  }

  for (const p of phantoms.slice(0, 10)) {
    // eslint-disable-next-line no-console
    console.log(
      `  - ${p.id} meeting=${p.meetingId} identity="${p.livekitIdentity}" name="${p.name}"`,
    );
  }
  if (phantoms.length > 10) {
    // eslint-disable-next-line no-console
    console.log(`  … и ещё ${phantoms.length - 10}`);
  }

  if (dryRun) {
    // eslint-disable-next-line no-console
    console.log(`[dry-run] Было бы удалено ${phantoms.length} Participant'ов + их behavior-записи`);
    return;
  }

  const ids = phantoms.map((p) => p.id);

  const behaviorDeleted = await prisma.meetingParticipantBehavior.deleteMany({
    where: { participantId: { in: ids } },
  });
  // eslint-disable-next-line no-console
  console.log(`[delete] MeetingParticipantBehavior: ${behaviorDeleted.count}`);

  const participantsDeleted = await prisma.participant.deleteMany({
    where: { id: { in: ids } },
  });
  // eslint-disable-next-line no-console
  console.log(`[delete] Participant: ${participantsDeleted.count}`);

  // eslint-disable-next-line no-console
  console.log('=== patch-cleanup-egress-phantom-participants DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('patch-cleanup-egress-phantom-participants FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });
