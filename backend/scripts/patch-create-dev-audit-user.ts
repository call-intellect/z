import { randomBytes } from 'node:crypto';

import argon2 from 'argon2';

import { createPrismaClient } from './_lib/prisma';

const EMAIL = 'audit-dev@kora.local';
const PASSWORD = 'AuditDev2026!';
const USER_NAME = 'Audit Dev';
const ORG_NAME = 'Audit Org';

const ARGON_OPTS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/giu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

async function generateUniqueSlug(
  prisma: ReturnType<typeof createPrismaClient>,
  name: string,
): Promise<string> {
  const base = slugify(name) || 'org';
  for (let attempt = 0; attempt < 8; attempt++) {
    const suffix = randomBytes(4).toString('hex').slice(0, 6);
    const slug = `${base}-${suffix}`;
    const exists = await prisma.org.findUnique({ where: { slug } });
    if (!exists) return slug;
  }
  throw new Error('slug_collision: не удалось сгенерировать уникальный slug');
}

async function main(): Promise<void> {
  const prisma = createPrismaClient();
  try {
    console.log('[audit-dev] start');

    const passwordHash = await argon2.hash(PASSWORD, ARGON_OPTS);
    const now = new Date();

    const user = await prisma.user.upsert({
      where: {
        email_signupSource: { email: EMAIL, signupSource: 'standalone' },
      },
      create: {
        email: EMAIL,
        name: USER_NAME,
        signupSource: 'standalone',
        passwordHash,
        role: 'user',
        isSuperAdmin: true,
        mustChangePassword: false,
        consentDataProcessing: true,
        consentMarketing: false,
        consentAcceptedAt: now,
      },
      update: {
        name: USER_NAME,
        passwordHash,
        isSuperAdmin: true,
        mustChangePassword: false,
        consentDataProcessing: true,
        consentAcceptedAt: now,
      },
    });
    console.log('[audit-dev] user upserted', { id: user.id, email: user.email });

    let orgId: string;
    const existingOrg = await prisma.org.findFirst({
      where: { ownerId: user.id, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });

    if (existingOrg) {
      orgId = existingOrg.id;
      console.log('[audit-dev] org exists, reuse', { id: orgId, slug: existingOrg.slug });
    } else {
      const slug = await generateUniqueSlug(prisma, ORG_NAME);
      const org = await prisma.$transaction(async (tx) => {
        const o = await tx.org.create({
          data: {
            name: ORG_NAME,
            slug,
            ownerId: user.id,
            visibilityMode: 'open',
            tier: 'basic',
          },
        });
        await tx.membership.create({
          data: {
            orgId: o.id,
            userId: user.id,
            role: 'owner',
            invitedBy: null,
          },
        });
        await tx.source.create({
          data: {
            tenantId: o.id,
            type: 'meeting',
            name: 'Встречи Z',
            dataClass: 'internal',
            isActive: true,
          },
        });
        const sub = await tx.subscription.create({
          data: { tenantId: o.id },
        });
        await tx.subscriptionEvent.create({
          data: {
            subscriptionId: sub.id,
            eventType: 'CREATED',
            payload: { initial: true, source: 'patch-create-dev-audit-user' },
          },
        });
        return o;
      });
      orgId = org.id;
      console.log('[audit-dev] org created', { id: orgId, slug });
    }

    const membership = await prisma.membership.findUnique({
      where: { orgId_userId: { orgId, userId: user.id } },
    });
    if (!membership) {
      await prisma.membership.create({
        data: { orgId, userId: user.id, role: 'owner', invitedBy: null },
      });
      console.log('[audit-dev] missing membership restored');
    } else if (membership.role !== 'owner') {
      await prisma.membership.update({
        where: { id: membership.id },
        data: { role: 'owner' },
      });
      console.log('[audit-dev] membership upgraded to owner');
    }

    console.log(`READY: email=${EMAIL} password=${PASSWORD} orgId=${orgId} userId=${user.id}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[audit-dev] ERROR', err);
  process.exitCode = 1;
});
