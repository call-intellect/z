import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

async function main() {
  const bitrix = await prisma.bitrixUser.updateMany({
    where: { linkedPersonId: { not: null } },
    data: { linkedPersonId: null, linkMode: 'none' },
  });
  console.log(`Bitrix (сотрудники): сброшено ${bitrix.count} записей`);

  const members = await prisma.chatboxMember.updateMany({
    where: { linkedPersonId: { not: null } },
    data: { linkedPersonId: null, linkMode: 'none' },
  });
  console.log(`Chatbox (менеджеры): сброшено ${members.count} записей`);

  const customers = await prisma.chatboxCustomer.updateMany({
    where: { linkedPersonId: { not: null } },
    data: { linkedPersonId: null, linkMode: 'none' },
  });
  console.log(`Chatbox (клиенты): сброшено ${customers.count} записей`);

  const channelClients = await prisma.chatboxChannelClient.updateMany({
    where: { linkedPersonId: { not: null } },
    data: { linkedPersonId: null, linkMode: 'none' },
  });
  console.log(`Chatbox (собеседники каналов): сброшено ${channelClients.count} записей`);

  console.log('Готово.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
