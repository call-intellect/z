import { randomBytes } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';
import { nanoid } from 'nanoid';

const prisma = createPrismaClient();

async function main(): Promise<void> {
  const tag = `smoke-${randomBytes(3).toString('hex')}`;
  // eslint-disable-next-line no-console
  console.log(`=== smoke-orgs-fase0 START (tag=${tag}) ===`);

  const userA = await prisma.user.create({
    data: {
      email: `${tag}-a@smoke.test`,
      name: 'Smoke A',
      role: 'user',
      signupSource: 'standalone',
    },
  });
  const userB = await prisma.user.create({
    data: {
      email: `${tag}-b@smoke.test`,
      name: 'Smoke B',
      role: 'user',
      signupSource: 'standalone',
    },
  });

  const orgA = await prisma.org.create({
    data: {
      name: `Тест-Компания-${tag}`,
      slug: `${tag}-org-a`,
      ownerId: userA.id,
      visibilityMode: 'open',
      tier: 'basic',
    },
  });
  await prisma.membership.create({
    data: { orgId: orgA.id, userId: userA.id, role: 'owner' },
  });
  console.log(`✓ Org A создан: ${orgA.id}, owner=${userA.email}`);

  const orgB = await prisma.org.create({
    data: {
      name: `Компания Smoke B`,
      slug: `${tag}-org-b`,
      ownerId: userB.id,
      visibilityMode: 'open',
    },
  });
  await prisma.membership.create({
    data: { orgId: orgB.id, userId: userB.id, role: 'owner' },
  });
  console.log(`✓ Org B создан: ${orgB.id}, owner=${userB.email}`);

  const token = nanoid(40);
  const invite = await prisma.orgInvitation.create({
    data: {
      orgId: orgA.id,
      email: userB.email,
      role: 'manager',
      token,
      status: 'pending',
      invitedBy: userA.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
  console.log(`✓ Invitation создан: token=${token.slice(0, 10)}…`);

  await prisma.$transaction(async (tx) => {
    await tx.orgInvitation.update({
      where: { id: invite.id },
      data: {
        status: 'accepted',
        acceptedAt: new Date(),
        acceptedByUserId: userB.id,
      },
    });
    await tx.membership.create({
      data: {
        orgId: orgA.id,
        userId: userB.id,
        role: 'manager',
        invitedBy: userA.id,
      },
    });
  });
  console.log(`✓ B принял инвайт, membership(manager) создан`);

  const bMemberships = await prisma.membership.findMany({
    where: { userId: userB.id },
    include: { org: true },
  });
  console.log(`✓ B состоит в ${bMemberships.length} Org:`);
  for (const m of bMemberships) {
    console.log(`    - ${m.org.name} (${m.role})`);
  }

  await prisma.aiUsageLog.create({
    data: {
      tenantId: orgA.id,
      userId: userA.id,
      taskType: 'summary',
      agentType: 'summary',
      model: 'deepseek-v4-pro',
      provider: 'deepseek',
      inputTokens: 1000,
      outputTokens: 200,
      cachedTokens: 100,
      costUsd: '0.001740',
      durationMs: 1500,
      success: true,
      sourceRef: { type: 'meeting', id: 'mtg-fake' },
    },
  });
  const usageCount = await prisma.aiUsageLog.count({
    where: { tenantId: orgA.id },
  });
  console.log(`✓ AiUsageLog с tenantId записан: ${usageCount} записей в orgA`);

  await prisma.aiUsageLog.deleteMany({ where: { userId: { in: [userA.id, userB.id] } } });
  await prisma.membership.deleteMany({
    where: { userId: { in: [userA.id, userB.id] } },
  });
  await prisma.orgInvitation.deleteMany({
    where: { orgId: { in: [orgA.id, orgB.id] } },
  });
  await prisma.org.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
  console.log(`✓ Cleanup готов`);

  console.log('=== smoke-orgs-fase0 PASSED ===');
}

main()
  .catch((err) => {
    console.error('smoke-orgs-fase0 FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
