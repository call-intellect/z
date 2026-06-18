import { PrismaClient, type User } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

async function isColumnNullable(table: string, column: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ is_nullable: string }>>`
    SELECT is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
  `;
  return rows[0]?.is_nullable === 'YES';
}

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9а-яё]+/giu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'org'
  );
}

async function ensureOrgForUser(user: User): Promise<string> {
  const existing = await prisma.org.findFirst({
    where: { ownerId: user.id, deletedAt: null },
    orderBy: { createdAt: 'asc' },
  });
  if (existing) {
    await prisma.membership.upsert({
      where: { orgId_userId: { orgId: existing.id, userId: user.id } },
      create: {
        orgId: existing.id,
        userId: user.id,
        role: 'owner',
        invitedBy: null,
      },
      update: {},
    });
    return existing.id;
  }

  const baseSlug = `${slugify(user.name || 'user')}-${user.id.slice(-6)}`;
  const orgName = `${user.name || user.email} (личный)`;
  const created = await prisma.$transaction(async (tx) => {
    const org = await tx.org.create({
      data: {
        name: orgName,
        slug: baseSlug,
        ownerId: user.id,
        visibilityMode: 'open',
        tier: 'basic',
      },
    });
    await tx.membership.create({
      data: {
        orgId: org.id,
        userId: user.id,
        role: 'owner',
        invitedBy: null,
      },
    });
    return org;
  });
  return created.id;
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('=== backfill-orgs-fase0 START ===');

  if (!(await isColumnNullable('Meeting', 'tenantId'))) {
    // eslint-disable-next-line no-console
    console.log(
      'Meeting.tenantId уже NOT NULL — Фаза 0 backfill применена ранее, обновление не требуется. Пропускаем.',
    );
    // eslint-disable-next-line no-console
    console.log('=== backfill-orgs-fase0 DONE (skip) ===');
    return;
  }

  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' },
  });
  // eslint-disable-next-line no-console
  console.log(`Найдено активных юзеров: ${users.length}`);

  const userToOrg = new Map<string, string>();
  for (const u of users) {
    const orgId = await ensureOrgForUser(u);
    userToOrg.set(u.id, orgId);
  }
  // eslint-disable-next-line no-console
  console.log(`Готово Org для юзеров: ${userToOrg.size}`);

  let mtgUpdated = 0;
  for (const [userId, orgId] of userToOrg) {
    const res = await prisma.meeting.updateMany({
      where: { ownerId: userId, tenantId: null },
      data: { tenantId: orgId },
    });
    mtgUpdated += res.count;
  }
  // eslint-disable-next-line no-console
  console.log(`Meeting.tenantId backfilled: ${mtgUpdated}`);

  let cardUpdated = 0;
  for (const [userId, orgId] of userToOrg) {
    const res = await prisma.card.updateMany({
      where: { ownerId: userId, tenantId: null },
      data: { tenantId: orgId },
    });
    cardUpdated += res.count;
  }
  // eslint-disable-next-line no-console
  console.log(`Card.tenantId backfilled: ${cardUpdated}`);

  let taskUpdated = 0;
  for (const [userId, orgId] of userToOrg) {
    const res = await prisma.task.updateMany({
      where: { userId, tenantId: null },
      data: { tenantId: orgId },
    });
    taskUpdated += res.count;
  }
  // eslint-disable-next-line no-console
  console.log(`Task.tenantId backfilled: ${taskUpdated}`);

  const chapters = await prisma.meetingChapter.findMany({
    where: { tenantId: null },
    select: { id: true, meeting: { select: { tenantId: true } } },
  });
  let chUpdated = 0;
  for (const c of chapters) {
    if (!c.meeting?.tenantId) continue;
    await prisma.meetingChapter.update({
      where: { id: c.id },
      data: { tenantId: c.meeting.tenantId },
    });
    chUpdated++;
  }
  // eslint-disable-next-line no-console
  console.log(`MeetingChapter.tenantId backfilled: ${chUpdated}`);

  const highlights = await prisma.meetingHighlight.findMany({
    where: { tenantId: null },
    select: { id: true, meeting: { select: { tenantId: true } }, createdById: true },
  });
  let hlUpdated = 0;
  for (const h of highlights) {
    const tid = h.meeting?.tenantId ?? userToOrg.get(h.createdById) ?? null;
    if (!tid) continue;
    await prisma.meetingHighlight.update({
      where: { id: h.id },
      data: { tenantId: tid },
    });
    hlUpdated++;
  }
  // eslint-disable-next-line no-console
  console.log(`MeetingHighlight.tenantId backfilled: ${hlUpdated}`);

  const chatMsgs = await prisma.meetingChatMessage.findMany({
    where: { tenantId: null },
    select: {
      id: true,
      userId: true,
      meeting: { select: { tenantId: true } },
    },
  });
  let cmUpdated = 0;
  for (const m of chatMsgs) {
    const tid = m.meeting?.tenantId ?? userToOrg.get(m.userId) ?? null;
    if (!tid) continue;
    await prisma.meetingChatMessage.update({
      where: { id: m.id },
      data: { tenantId: tid },
    });
    cmUpdated++;
  }
  // eslint-disable-next-line no-console
  console.log(`MeetingChatMessage.tenantId backfilled: ${cmUpdated}`);

  let tagUpdated = 0;
  for (const [userId, orgId] of userToOrg) {
    const res = await prisma.tag.updateMany({
      where: { userId, tenantId: null },
      data: { tenantId: orgId },
    });
    tagUpdated += res.count;
  }
  // eslint-disable-next-line no-console
  console.log(`Tag.tenantId backfilled: ${tagUpdated}`);

  let apiKeyUpdated = 0;
  for (const [userId, orgId] of userToOrg) {
    const res = await prisma.apiKey.updateMany({
      where: { userId, tenantId: null },
      data: { tenantId: orgId },
    });
    apiKeyUpdated += res.count;
  }
  // eslint-disable-next-line no-console
  console.log(`ApiKey.tenantId backfilled: ${apiKeyUpdated}`);

  let whUpdated = 0;
  for (const [userId, orgId] of userToOrg) {
    const res = await prisma.webhookSubscription.updateMany({
      where: { userId, tenantId: null },
      data: { tenantId: orgId },
    });
    whUpdated += res.count;
  }
  // eslint-disable-next-line no-console
  console.log(`WebhookSubscription.tenantId backfilled: ${whUpdated}`);

  let dstUpdated = 0;
  for (const [userId, orgId] of userToOrg) {
    const res = await prisma.integrationDestination.updateMany({
      where: { userId, tenantId: null },
      data: { tenantId: orgId },
    });
    dstUpdated += res.count;
  }
  // eslint-disable-next-line no-console
  console.log(`IntegrationDestination.tenantId backfilled: ${dstUpdated}`);

  let expUpdated = 0;
  for (const [userId, orgId] of userToOrg) {
    const res = await prisma.export.updateMany({
      where: { userId, tenantId: null },
      data: { tenantId: orgId },
    });
    expUpdated += res.count;
  }
  // eslint-disable-next-line no-console
  console.log(`Export.tenantId backfilled: ${expUpdated}`);

  let alUpdated = 0;
  for (const [userId, orgId] of userToOrg) {
    const res = await prisma.auditLog.updateMany({
      where: { userId, tenantId: null },
      data: { tenantId: orgId },
    });
    alUpdated += res.count;
  }
  // eslint-disable-next-line no-console
  console.log(`AuditLog.tenantId backfilled: ${alUpdated}`);

  let aiUpdated = 0;
  for (const [userId, orgId] of userToOrg) {
    const res = await prisma.aiUsageLog.updateMany({
      where: { userId, tenantId: null },
      data: { tenantId: orgId },
    });
    aiUpdated += res.count;
  }
  const aiNoUser = await prisma.aiUsageLog.findMany({
    where: { tenantId: null, userId: null, meetingId: { not: null } },
    select: { id: true, meetingId: true },
  });
  for (const r of aiNoUser) {
    if (!r.meetingId) continue;
    const m = await prisma.meeting.findUnique({
      where: { id: r.meetingId },
      select: { tenantId: true },
    });
    if (!m?.tenantId) continue;
    await prisma.aiUsageLog.update({
      where: { id: r.id },
      data: { tenantId: m.tenantId },
    });
    aiUpdated++;
  }
  // eslint-disable-next-line no-console
  console.log(`AiUsageLog.tenantId backfilled: ${aiUpdated}`);

  // eslint-disable-next-line no-console
  console.log('=== backfill-orgs-fase0 DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('backfill-orgs-fase0 FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
