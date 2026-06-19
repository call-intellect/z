import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

async function main() {
  const phantomPersonIds = await prisma.person
    .findMany({
      where: { userId: null, deletedAt: null },
      select: { id: true },
    })
    .then((rows) => rows.map((r) => r.id));

  if (phantomPersonIds.length === 0) {
    console.log('Фантомных персон нет — ничего не делаем');
    return;
  }

  console.log(`Найдено ${phantomPersonIds.length} персон без Кора-аккаунта`);

  const bitrixReset = await prisma.bitrixUser.updateMany({
    where: {
      linkMode: 'auto',
      linkedPersonId: { in: phantomPersonIds },
    },
    data: { linkedPersonId: null, linkMode: 'none' },
  });
  console.log(`Bitrix: сброшено ${bitrixReset.count} авто-связей к фантомным персонам`);

  const chatboxReset = await prisma.chatboxMember.updateMany({
    where: {
      linkMode: 'auto',
      linkedPersonId: { in: phantomPersonIds },
    },
    data: { linkedPersonId: null, linkMode: 'none' },
  });
  console.log(`Chatbox: сброшено ${chatboxReset.count} авто-связей к фантомным персонам`);

  console.log('Готово. Фантомные персоны НЕ удалены — они могут использоваться в атрибуции переписок.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
