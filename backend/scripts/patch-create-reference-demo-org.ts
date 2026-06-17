import { runAllSeedSteps } from '../src/modules/onboarding/demo-data';
import { markAllDemoEntitiesForTenant } from '../src/modules/onboarding/demo-data/mark-demo';
import {
  createEmptyIdMap,
  type IdMap,
  type SeedContext,
} from '../src/modules/onboarding/demo-data/types';
import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

const DEMO_ORG_NAME = 'Демо: ТехноСтрим';
const SYSTEM_OWNER_EMAIL = 'demo-system@kora.local';
const SYSTEM_OWNER_NAME = 'Кора (системный)';

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('=== patch-create-reference-demo-org START ===');

  const existing = await prisma.org.findFirst({
    where: { isReferenceDemo: true, deletedAt: null },
    select: { id: true, name: true, demoWorkspaceSeededAt: true },
  });
  if (existing) {
    // eslint-disable-next-line no-console
    console.log(
      `[skip] Эталонная Org уже существует: id=${existing.id}, name="${existing.name}", seededAt=${existing.demoWorkspaceSeededAt?.toISOString() ?? 'NULL'}`,
    );
    // eslint-disable-next-line no-console
    console.log(`ZDEMO_ORG_ID=${existing.id}`);
    return;
  }

  let owner = await prisma.user.findFirst({
    where: { email: SYSTEM_OWNER_EMAIL },
    select: { id: true },
  });
  if (!owner) {
    owner = await prisma.user.create({
      data: {
        email: SYSTEM_OWNER_EMAIL,
        name: SYSTEM_OWNER_NAME,
        passwordHash: null,
        signupSource: 'standalone',
        mustChangePassword: false,
        consentDataProcessing: true,
      },
      select: { id: true },
    });
    // eslint-disable-next-line no-console
    console.log(`[create] System owner: id=${owner.id}, email=${SYSTEM_OWNER_EMAIL}`);
  } else {
    // eslint-disable-next-line no-console
    console.log(`[reuse] System owner: id=${owner.id}, email=${SYSTEM_OWNER_EMAIL}`);
  }

  const ownerId = owner.id;
  const orgId = await prisma.$transaction(async (tx) => {
    let slug = 'demo-technostream';
    for (let attempt = 0; attempt < 100; attempt++) {
      const exists = await tx.org.findUnique({ where: { slug }, select: { id: true } });
      if (!exists) break;
      slug = `demo-technostream-${attempt + 1}`;
    }
    const org = await tx.org.create({
      data: {
        name: DEMO_ORG_NAME,
        slug,
        ownerId,
        isReferenceDemo: true,
        visibilityMode: 'open',
        tier: 'basic',
      },
      select: { id: true },
    });
    await tx.membership.create({
      data: {
        userId: ownerId,
        orgId: org.id,
        role: 'owner',
        invitedBy: null,
        joinedAt: new Date(),
      },
    });
    const now = new Date();
    const farFuture = new Date(now.getFullYear() + 100, now.getMonth(), now.getDate());
    await tx.subscription.create({
      data: {
        tenantId: org.id,
        status: 'ACTIVE',
        paymentMode: 'reference',
        billingPeriod: 'monthly',
        startedAt: now,
        currentPeriodStart: now,
        currentPeriodEnd: farFuture,
        seatsBase: 100,
        seatsExtra: 0,
        monthlyPriceKopecks: 0,
        totalPaidKopecks: 0,
        autoRenew: false,
      },
    });
    return org.id;
  });

  // eslint-disable-next-line no-console
  console.log(`[create] Эталонная Org создана: id=${orgId}, name="${DEMO_ORG_NAME}"`);

  const ids: IdMap = createEmptyIdMap();
  const ctx: SeedContext = { prisma, tenantId: orgId, ownerUserId: ownerId };

  await runAllSeedSteps(ctx, ids, (step, i, total) => {
    // eslint-disable-next-line no-console
    console.log(`── [${i + 1}/${total}] ${step.label} (${step.key})`);
  });

  const marked = await markAllDemoEntitiesForTenant(prisma, orgId);
  // eslint-disable-next-line no-console
  console.log(`── externalSource='demo' проставлен: updated=${marked.updated}`);

  await prisma.org.update({
    where: { id: orgId },
    data: { demoWorkspaceSeededAt: new Date() },
  });

  // eslint-disable-next-line no-console
  console.log('=== patch-create-reference-demo-org DONE ===');
  // eslint-disable-next-line no-console
  console.log(`ZDEMO_ORG_ID=${orgId}`);
  // eslint-disable-next-line no-console
  console.log('→ Запиши эту строку в .env (рядом с прочими ENV) и перезапусти backend.');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('patch-create-reference-demo-org FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });
