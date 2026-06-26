import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

interface SourceTypeRow {
  sourceType: string | null;
  count: bigint;
}

async function main(): Promise<void> {
  const reg = await prisma.$queryRaw<
    { r: string | null }[]
  >`SELECT to_regclass('public."Task"')::text AS r`;
  if (!reg[0]?.r) {
    console.log('[diag] таблица Task отсутствует — нечего измерять');
    return;
  }

  const totalRows = await prisma.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*)::bigint AS count FROM "Task"`;
  const total = Number(totalRows[0]?.count ?? 0n);

  const bySource = await prisma.$queryRaw<SourceTypeRow[]>`
    SELECT "sourceType" AS "sourceType", COUNT(*)::bigint AS count
    FROM "Task"
    GROUP BY "sourceType"
    ORDER BY count DESC
  `;

  const meetingTaskRows = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count
    FROM "Task"
    WHERE "meetingId" IS NOT NULL
  `;
  const meetingTaskTotal = Number(meetingTaskRows[0]?.count ?? 0n);

  const meetingTaskWithIssueRows = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count
    FROM "Task" t
    WHERE t."meetingId" IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM "Issue" i
        WHERE i."tenantId" = t."tenantId"
          AND (
            i."meetingId" = t."meetingId"
            OR i."linkedMeetingIds" @> ARRAY[t."meetingId"]
          )
      )
  `;
  const meetingTaskWithIssue = Number(meetingTaskWithIssueRows[0]?.count ?? 0n);

  const duplicatePairRows = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count
    FROM "Issue" legacy
    JOIN "Issue" canon
      ON canon."tenantId" = legacy."tenantId"
     AND canon."id" <> legacy."id"
     AND canon."externalSource" = 'meeting'
     AND canon."linkedMeetingIds" && legacy."linkedMeetingIds"
    WHERE legacy."externalSource" = 'meeting_legacy'
      AND array_length(legacy."linkedMeetingIds", 1) IS NOT NULL
  `;
  const duplicatePairs = Number(duplicatePairRows[0]?.count ?? 0n);

  console.log('=== diag: пересечение legacy-Task и spine-Issue ===\n');

  console.log(`Всего Task: ${total}`);

  console.log('\nПо sourceType:');
  if (bySource.length === 0) {
    console.log('  (нет строк)');
  } else {
    for (const row of bySource) {
      const label = row.sourceType ?? '(null)';
      console.log(`  ${label}: ${Number(row.count)}`);
    }
  }

  console.log('\nMeeting-Task (meetingId непустой):');
  console.log(`  всего meeting-Task: ${meetingTaskTotal}`);
  console.log(
    `  имеют ≥1 Issue по той же встрече: ${meetingTaskWithIssue} из ${meetingTaskTotal}`,
  );

  console.log('\nПары-дубли Issue (legacy ↔ канон по той же встрече):');
  console.log(
    `  Issue(externalSource='meeting_legacy') с каноном Issue(externalSource='meeting') по пересечению linkedMeetingIds: ${duplicatePairs}`,
  );

  console.log('\n=== diag завершён ===');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
