import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

function assertLocal(): void {
  const url = process.env['DATABASE_URL'] ?? '';
  if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
    throw new Error(`qa-grant-tenant-access: DATABASE_URL не локальный — отказ (${url.replace(/\/\/[^@]*@/, '//***@')})`);
  }
}

async function main(): Promise<void> {
  assertLocal();
  const orgId = process.env['STRELA_ORG'];
  if (!orgId) throw new Error('STRELA_ORG не задан');
  const emails = (process.env['QA_EMAILS'] ?? 'admin@crossmark.ru,test@kora.local')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const org = await prisma.org.findUniqueOrThrow({ where: { id: orgId }, select: { id: true, name: true } });
  // eslint-disable-next-line no-console
  console.log(`=== qa-grant-tenant-access: ${org.name} (${org.id}) ===`);

  await prisma.orgEntitlement.upsert({
    where: { tenantId: orgId },
    update: { tier: 'tier_enterprise' },
    create: { tenantId: orgId, tier: 'tier_enterprise' },
  });
  // eslint-disable-next-line no-console
  console.log('  entitlement tier_enterprise ✓');

  const now = new Date();
  const periodEnd = new Date(now.getTime() + 365 * 86_400_000);
  await prisma.subscription.upsert({
    where: { tenantId: orgId },
    update: { status: 'ACTIVE', startedAt: now, currentPeriodStart: now, currentPeriodEnd: periodEnd },
    create: { tenantId: orgId, status: 'ACTIVE', startedAt: now, currentPeriodStart: now, currentPeriodEnd: periodEnd },
  });
  // eslint-disable-next-line no-console
  console.log('  subscription ACTIVE ✓');

  for (const email of emails) {
    const user = await prisma.user.findFirst({ where: { email }, select: { id: true, email: true } });
    if (!user) {
      // eslint-disable-next-line no-console
      console.log(`  [skip] нет пользователя ${email}`);
      continue;
    }
    await prisma.membership.upsert({
      where: { orgId_userId: { orgId, userId: user.id } },
      update: { role: 'owner' },
      create: { orgId, userId: user.id, role: 'owner' },
    });
    await prisma.user.update({ where: { id: user.id }, data: { profileCompletedAt: new Date() } });
    // eslint-disable-next-line no-console
    console.log(`  membership owner + profileCompletedAt ✓ ${email} (${user.id})`);
  }
  // eslint-disable-next-line no-console
  console.log('=== qa-grant-tenant-access DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('qa-grant-tenant-access FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });
