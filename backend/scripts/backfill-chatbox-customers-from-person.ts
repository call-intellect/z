import { Prisma, type PrismaClient } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';

const DRY_RUN = process.argv.includes('--dry-run');

interface Counters {
  customersCreated: number;
  customersReused: number;
  channelContacts: number;
  personsDeactivated: number;
  personsKept: number;
}

function normalizeName(raw: string | null | undefined): string {
  return (raw ?? '').trim();
}

function pickEmail(...candidates: Array<string | null | undefined>): string | null {
  for (const c of candidates) {
    const v = c?.trim();
    if (v) return v.toLowerCase();
  }
  return null;
}

function pickPhone(...candidates: Array<string | null | undefined>): string | null {
  for (const c of candidates) {
    const v = c?.trim();
    if (v) return v;
  }
  return null;
}

async function resolveCustomerEntityId(
  prisma: PrismaClient,
  tenantId: string,
  name: string,
  email: string | null,
  phone: string | null,
): Promise<string> {
  let entity: { id: string } | null = null;
  if (email) {
    entity = await prisma.entity.findFirst({
      where: { tenantId, type: 'customer', email },
      select: { id: true },
    });
  }
  if (!entity) {
    entity = await prisma.entity.findFirst({
      where: { tenantId, type: 'customer', canonicalName: name },
      select: { id: true },
    });
  }
  if (entity) return entity.id;
  const created = await prisma.entity.create({
    data: {
      tenantId,
      type: 'customer',
      canonicalName: name,
      aliases: [],
      email,
      phone,
      mentionsCount: 1,
    },
    select: { id: true },
  });
  return created.id;
}

async function resolvePersonEntityId(
  prisma: PrismaClient,
  tenantId: string,
  name: string,
  email: string | null,
  phone: string | null,
): Promise<string> {
  let entity: { id: string } | null = null;
  if (email) {
    entity = await prisma.entity.findFirst({
      where: { tenantId, type: 'person', email },
      select: { id: true },
    });
  }
  if (!entity) {
    entity = await prisma.entity.findFirst({
      where: { tenantId, type: 'person', canonicalName: name },
      select: { id: true },
    });
  }
  if (entity) return entity.id;
  const created = await prisma.entity.create({
    data: {
      tenantId,
      type: 'person',
      canonicalName: name,
      aliases: [],
      email,
      phone,
      mentionsCount: 1,
    },
    select: { id: true },
  });
  return created.id;
}

async function runStageA(
  prisma: PrismaClient,
  counters: Counters,
  orphanCandidates: Set<string>,
  log: (m: string) => void,
): Promise<void> {
  const rows = await prisma.chatboxCustomer.findMany({
    where: { linkedPersonId: { not: null }, linkedCustomerId: null },
    select: {
      id: true,
      tenantId: true,
      linkedPersonId: true,
      name: true,
      email: true,
      phone: true,
      externalCrmId: true,
    },
  });
  log(`ЭТАП A (account): кандидатов ChatboxCustomer = ${rows.length}`);

  for (const row of rows) {
    const personId = row.linkedPersonId!;
    const person = await prisma.person.findUnique({
      where: { id: personId },
      select: { name: true, email: true },
    });
    if (!person) {
      log(`  пропуск ChatboxCustomer ${row.id}: Person ${personId} не найден`);
      continue;
    }

    const email = pickEmail(person.email, row.email);
    const phone = pickPhone(row.phone);
    const name = normalizeName(person.name) || normalizeName(row.name);
    if (!name) {
      log(`  пропуск ChatboxCustomer ${row.id}: пустое имя`);
      continue;
    }

    if (DRY_RUN) {
      counters.customersCreated++;
      log(
        `  DRY-RUN: ChatboxCustomer ${row.id} → resolve Customer (name="${name}", email=${email ?? '∅'}) + linkMode=manual`,
      );
      orphanCandidates.add(personId);
      continue;
    }

    const entityId = await resolveCustomerEntityId(prisma, row.tenantId, name, email, phone);
    let customer = await prisma.customer.findUnique({
      where: { entityId },
      select: { id: true },
    });
    if (customer) {
      counters.customersReused++;
    } else {
      customer = await prisma.customer.create({
        data: {
          tenantId: row.tenantId,
          entityId,
          name: name.slice(0, 300),
          email,
          phone,
          externalCrmId: row.externalCrmId ?? null,
          source: 'chatbox',
          status: 'active',
        },
        select: { id: true },
      });
      counters.customersCreated++;
    }

    await prisma.chatboxCustomer.update({
      where: { id: row.id },
      data: { linkedCustomerId: customer.id, linkMode: 'manual' },
    });
    orphanCandidates.add(personId);
  }
}

async function linkContactToAccount(
  prisma: PrismaClient,
  tenantId: string,
  contactEntityId: string,
  accountEntityId: string,
): Promise<void> {
  const existing = await prisma.entityLink.findFirst({
    where: {
      fromEntityId: contactEntityId,
      fromType: 'entity',
      toEntityId: accountEntityId,
      toType: 'entity',
      relationType: 'works_at',
    },
    select: { id: true },
  });
  if (existing) return;
  await prisma.entityLink.create({
    data: {
      tenantId,
      fromEntityId: contactEntityId,
      toEntityId: accountEntityId,
      fromType: 'entity',
      toType: 'entity',
      relationType: 'works_at',
      confidence: new Prisma.Decimal('1.000'),
      explanation: 'Контакт ChatBox привязан к клиенту',
      createdBy: 'manual',
      status: 'active',
      properties: {},
    },
  });
}

async function resolveAccountEntityId(
  prisma: PrismaClient,
  customerRefId: string | null,
): Promise<string | null> {
  if (!customerRefId) return null;
  const chatboxCustomer = await prisma.chatboxCustomer.findUnique({
    where: { id: customerRefId },
    select: { linkedCustomerId: true },
  });
  if (!chatboxCustomer?.linkedCustomerId) return null;
  const customer = await prisma.customer.findUnique({
    where: { id: chatboxCustomer.linkedCustomerId },
    select: { entityId: true },
  });
  return customer?.entityId ?? null;
}

async function runStageB(
  prisma: PrismaClient,
  counters: Counters,
  orphanCandidates: Set<string>,
  log: (m: string) => void,
): Promise<void> {
  const rows = await prisma.chatboxChannelClient.findMany({
    where: { linkedPersonId: { not: null }, linkedContactEntityId: null },
    select: {
      id: true,
      tenantId: true,
      customerId: true,
      linkedPersonId: true,
      name: true,
      email: true,
      phone: true,
    },
  });
  log(`ЭТАП B (контакты): кандидатов ChatboxChannelClient = ${rows.length}`);

  for (const row of rows) {
    const personId = row.linkedPersonId!;
    const person = await prisma.person.findUnique({
      where: { id: personId },
      select: { name: true, email: true },
    });
    if (!person) {
      log(`  пропуск ChatboxChannelClient ${row.id}: Person ${personId} не найден`);
      continue;
    }

    const email = pickEmail(person.email, row.email);
    const phone = pickPhone(row.phone);
    const name = normalizeName(person.name) || normalizeName(row.name);
    if (!name) {
      log(`  пропуск ChatboxChannelClient ${row.id}: пустое имя`);
      continue;
    }

    if (DRY_RUN) {
      counters.channelContacts++;
      log(
        `  DRY-RUN: ChatboxChannelClient ${row.id} → resolve Entity{person} (name="${name}", email=${email ?? '∅'})`,
      );
      orphanCandidates.add(personId);
      continue;
    }

    const entityId = await resolvePersonEntityId(prisma, row.tenantId, name, email, phone);
    await prisma.chatboxChannelClient.update({
      where: { id: row.id },
      data: { linkedContactEntityId: entityId },
    });
    const accountEntityId = await resolveAccountEntityId(prisma, row.customerId);
    if (accountEntityId) {
      await linkContactToAccount(prisma, row.tenantId, entityId, accountEntityId);
    }
    counters.channelContacts++;
    orphanCandidates.add(personId);
  }
}

async function runStageC(
  prisma: PrismaClient,
  counters: Counters,
  orphanCandidates: Set<string>,
  log: (m: string) => void,
): Promise<void> {
  log(`ЭТАП C (осиротевшие Person): кандидатов = ${orphanCandidates.size}`);

  for (const personId of orphanCandidates) {
    const person = await prisma.person.findUnique({
      where: { id: personId },
      select: { id: true, relationship: true, userId: true, deletedAt: true },
    });
    if (!person) {
      log(`  оставлен: Person ${personId} не найден`);
      continue;
    }
    if (person.relationship !== 'external') {
      counters.personsKept++;
      log(`  оставлен: Person ${personId} relationship=${person.relationship}`);
      continue;
    }
    if (person.userId !== null) {
      counters.personsKept++;
      log(`  оставлен: Person ${personId} привязан к User`);
      continue;
    }
    if (person.deletedAt !== null) {
      counters.personsKept++;
      log(`  оставлен: Person ${personId} уже soft-deleted`);
      continue;
    }

    const membershipCount = await prisma.membership.count({ where: { personId } });
    if (membershipCount > 0) {
      counters.personsKept++;
      log(`  оставлен: Person ${personId} имеет Membership (${membershipCount})`);
      continue;
    }
    const responsibleCount = await prisma.customer.count({
      where: { responsiblePersonId: personId },
    });
    if (responsibleCount > 0) {
      counters.personsKept++;
      log(`  оставлен: Person ${personId} — ответственный по Customer (${responsibleCount})`);
      continue;
    }
    const riskCount = await prisma.customerRiskSnapshot.count({
      where: { responsiblePersonId: personId },
    });
    if (riskCount > 0) {
      counters.personsKept++;
      log(`  оставлен: Person ${personId} — ответственный в CustomerRiskSnapshot (${riskCount})`);
      continue;
    }

    if (DRY_RUN) {
      counters.personsDeactivated++;
      log(`  DRY-RUN: Person ${personId} → soft-delete (deletedAt)`);
      continue;
    }

    await prisma.person.update({
      where: { id: personId },
      data: { deletedAt: new Date() },
    });
    counters.personsDeactivated++;
  }
}

async function main(): Promise<void> {
  const prisma = createPrismaClient();
  /* eslint-disable no-console */
  const log = (m: string): void => console.log(m);
  const counters: Counters = {
    customersCreated: 0,
    customersReused: 0,
    channelContacts: 0,
    personsDeactivated: 0,
    personsKept: 0,
  };
  const orphanCandidates = new Set<string>();
  try {
    log(`=== backfill-chatbox-customers-from-person START (${DRY_RUN ? 'DRY-RUN' : 'REAL'}) ===`);

    await runStageA(prisma, counters, orphanCandidates, log);
    await runStageB(prisma, counters, orphanCandidates, log);
    await runStageC(prisma, counters, orphanCandidates, log);

    if (
      counters.customersCreated === 0 &&
      counters.customersReused === 0 &&
      counters.channelContacts === 0 &&
      counters.personsDeactivated === 0 &&
      orphanCandidates.size === 0
    ) {
      log('Нечего переносить — пропуск (idempotent no-op).');
    }

    log('=== SUMMARY ===');
    log(
      `Customers создано: ${counters.customersCreated}, переиспользовано: ${counters.customersReused}, ` +
        `channel-контактов: ${counters.channelContacts}, Person деактивировано: ${counters.personsDeactivated}, ` +
        `Person оставлено: ${counters.personsKept}` +
        (DRY_RUN ? ' (DRY-RUN — ничего не записано)' : ''),
    );
    log('=== backfill-chatbox-customers-from-person DONE ===');
    /* eslint-enable no-console */
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('backfill-chatbox-customers-from-person FAILED:', err);
  process.exit(1);
});
