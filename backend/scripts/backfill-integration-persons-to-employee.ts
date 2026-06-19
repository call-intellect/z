import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

async function collectLinkedPersonIds(): Promise<string[]> {
  const [bitrix, members] = await Promise.all([
    prisma.bitrixUser.findMany({
      where: { linkedPersonId: { not: null } },
      select: { linkedPersonId: true },
    }),
    prisma.chatboxMember.findMany({
      where: { linkedPersonId: { not: null } },
      select: { linkedPersonId: true },
    }),
  ]);
  const ids = new Set<string>();
  for (const r of bitrix) if (r.linkedPersonId) ids.add(r.linkedPersonId);
  for (const r of members) if (r.linkedPersonId) ids.add(r.linkedPersonId);
  return [...ids];
}

async function main() {
  const personIds = await collectLinkedPersonIds();
  if (personIds.length === 0) {
    console.log('Связанных с Bitrix/Chatbox-менеджерами персон нет — нечего делать.');
    return;
  }

  const result = await prisma.person.updateMany({
    where: { id: { in: personIds }, relationship: 'external', deletedAt: null },
    data: { relationship: 'employee' },
  });

  console.log(
    `Связанных персон: ${personIds.length}; переведено external → employee: ${result.count}`,
  );
  console.log('Готово.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
