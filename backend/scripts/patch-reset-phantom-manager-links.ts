import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

async function main() {
  const bitrix = await prisma.bitrixUser.updateMany({
    where: { linkedPersonId: { not: null } },
    data: { linkedPersonId: null, linkMode: 'none' },
  });
  console.log(`Bitrix: сброшено ${bitrix.count} записей`);

  const chatbox = await prisma.chatboxMember.updateMany({
    where: { linkedPersonId: { not: null } },
    data: { linkedPersonId: null, linkMode: 'none' },
  });
  console.log(`Chatbox: сброшено ${chatbox.count} записей`);

  console.log('Готово.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
