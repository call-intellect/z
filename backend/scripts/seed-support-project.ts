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
  console.log('=== seed-support-project START ===');

  const vendorOrgId = await resolveVendorOrgId();
  if (!vendorOrgId) {
    console.log(
      `SUPPORT_VENDOR_ORG_ID не задан (AdminSetting ${SUPPORT_VENDOR_ORG_ID_KEY}) — пропускаю (owner-decision параметр)`,
    );
    console.log('=== seed-support-project DONE (no-op) ===');
    return;
  }

  const policy = await prisma.supportSlaPolicy.findUnique({
    where: { tenantId: vendorOrgId },
    select: { id: true },
  });
  if (!policy) {
    await prisma.supportSlaPolicy.create({
      data: { tenantId: vendorOrgId },
    });
    console.log('[created] SupportSlaPolicy (60/480, businessHoursOnly=false)');
  } else {
    console.log('[exists] SupportSlaPolicy');
  }

  console.log('=== seed-support-project DONE ===');
}

main()
  .catch((err) => {
    console.error('seed-support-project FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
