import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

async function fixBitrix() {
  const users = await prisma.bitrixUser.findMany({
    where: { linkedPersonId: { not: null } },
    select: { id: true, tenantId: true, email: true, linkedPersonId: true, linkMode: true },
  });

  const personIds = [...new Set(users.map((u) => u.linkedPersonId!))];
  const persons = await prisma.person.findMany({
    where: { id: { in: personIds } },
    select: { id: true, email: true, userId: true },
  });
  const personMap = new Map(persons.map((p) => [p.id, p]));

  let reset = 0;
  for (const u of users) {
    const person = personMap.get(u.linkedPersonId!);
    const emailMatch =
      person &&
      person.userId !== null &&
      u.email &&
      person.email &&
      u.email.trim().toLowerCase() === person.email.trim().toLowerCase();
    if (!emailMatch) {
      await prisma.bitrixUser.update({
        where: { id: u.id },
        data: { linkedPersonId: null, linkMode: 'none' },
      });
      reset++;
    }
  }
  console.log(`Bitrix: сброшено ${reset} неправильных/фантомных связей`);

  const unlinked = await prisma.bitrixUser.findMany({
    where: { linkedPersonId: null, email: { not: null } },
    select: { id: true, tenantId: true, email: true },
  });

  const emails = [...new Set(unlinked.map((u) => u.email!.trim().toLowerCase()))];
  const koraPersons = await prisma.person.findMany({
    where: {
      email: { in: emails, mode: 'insensitive' },
      userId: { not: null },
      deletedAt: null,
    },
    select: { id: true, email: true, tenantId: true, userId: true },
  });
  const emailToPersonId = new Map(koraPersons.map((p) => [p.email.trim().toLowerCase(), p]));

  let linked = 0;
  for (const u of unlinked) {
    const key = u.email!.trim().toLowerCase();
    const person = emailToPersonId.get(key);
    if (!person || person.tenantId !== u.tenantId) continue;
    await prisma.bitrixUser.update({
      where: { id: u.id },
      data: { linkedPersonId: person.id, linkMode: 'auto' },
    });
    linked++;
  }
  console.log(`Bitrix: привязано ${linked} сотрудников по точному email`);
}

async function fixChatbox() {
  const members = await prisma.chatboxMember.findMany({
    where: { linkedPersonId: { not: null } },
    select: { id: true, tenantId: true, email: true, linkedPersonId: true, linkMode: true },
  });

  const personIds = [...new Set(members.map((m) => m.linkedPersonId!))];
  const persons = await prisma.person.findMany({
    where: { id: { in: personIds } },
    select: { id: true, email: true, userId: true },
  });
  const personMap = new Map(persons.map((p) => [p.id, p]));

  let reset = 0;
  for (const m of members) {
    const person = personMap.get(m.linkedPersonId!);
    const emailMatch =
      person &&
      person.userId !== null &&
      m.email &&
      person.email &&
      m.email.trim().toLowerCase() === person.email.trim().toLowerCase();
    if (!emailMatch) {
      await prisma.chatboxMember.update({
        where: { id: m.id },
        data: { linkedPersonId: null, linkMode: 'none' },
      });
      reset++;
    }
  }
  console.log(`Chatbox: сброшено ${reset} неправильных/фантомных связей`);

  const unlinked = await prisma.chatboxMember.findMany({
    where: { linkedPersonId: null, email: { not: null } },
    select: { id: true, tenantId: true, email: true },
  });

  const emails = [...new Set(unlinked.map((m) => m.email!.trim().toLowerCase()))];
  const koraPersons = await prisma.person.findMany({
    where: {
      email: { in: emails, mode: 'insensitive' },
      userId: { not: null },
      deletedAt: null,
    },
    select: { id: true, email: true, tenantId: true, userId: true },
  });
  const emailToPersonId = new Map(koraPersons.map((p) => [p.email.trim().toLowerCase(), p]));

  let linked = 0;
  for (const m of unlinked) {
    const key = m.email!.trim().toLowerCase();
    const person = emailToPersonId.get(key);
    if (!person || person.tenantId !== m.tenantId) continue;
    await prisma.chatboxMember.update({
      where: { id: m.id },
      data: { linkedPersonId: person.id, linkMode: 'auto' },
    });
    linked++;
  }
  console.log(`Chatbox: привязано ${linked} сотрудников по точному email`);
}

async function main() {
  await fixBitrix();
  await fixChatbox();
  console.log('Готово.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
