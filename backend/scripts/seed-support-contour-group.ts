import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

const SUPPORT_VENDOR_ORG_ID_KEY = 'support.vendor_org_id';

async function resolveVendorOrgId(): Promise<string | null> {
  const row = await prisma.adminSetting.findUnique({
    where: { key: SUPPORT_VENDOR_ORG_ID_KEY },
    select: { value: true },
  });
  if (!row) return null;
  const v = row.value as unknown;
  const id = typeof v === 'string' ? v.trim() : '';
  return id.length > 0 ? id : null;
}

async function main(): Promise<void> {
  console.log('=== seed-support-contour-group START ===');

  const vendorOrgId = await resolveVendorOrgId();
  if (!vendorOrgId) {
    console.log(
      `SUPPORT_VENDOR_ORG_ID не задан (AdminSetting ${SUPPORT_VENDOR_ORG_ID_KEY}) — пропускаю (owner-decision параметр)`,
    );
    console.log('=== seed-support-contour-group DONE (no-op) ===');
    return;
  }

  const existing = await prisma.knowledgeGroup.findFirst({
    where: { tenantId: vendorOrgId, kind: 'support', refId: null },
    select: { id: true },
  });
  if (existing) {
    console.log(`[exists] KnowledgeGroup support (id=${existing.id})`);
  } else {
    const created = await prisma.knowledgeGroup.create({
      data: {
        tenantId: vendorOrgId,
        kind: 'support',
        refId: null,
        name: 'Контур поддержки',
        isClosed: true,
      },
      select: { id: true },
    });
    console.log(`[created] KnowledgeGroup support (id=${created.id})`);
  }

  console.log('=== seed-support-contour-group DONE ===');
}

main()
  .catch((err) => {
    console.error('seed-support-contour-group FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
