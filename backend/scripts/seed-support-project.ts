/**
 * seed-support-project.ts — идемпотентный сид Support-проекта вендор-Org.
 *
 * ТЗ 2026-06-09 support-desk-clone, Ф1. Создаёт:
 *   - Project(systemGenerated=true, identifier='SUP', slug='support',
 *     name='Поддержка', ownerId=<owner вендор-Org>) — скрыт из обычного
 *     списка проектов фильтром systemGenerated.
 *   - 6 IssueState: Новое/В работе/Ждёт клиента/Решено/Закрыто/Спам
 *     (categories: unstarted/started/started/completed/cancelled/cancelled,
 *     sequence 1..6, isDefault на 'Новое').
 *   - project.defaultStateId = id 'Новое'.
 *   - SupportSlaPolicy(tenantId=вендор-Org) с дефолтами 60/480.
 *
 * Вендор-Org читается из AdminSetting `support.vendor_org_id` (JSON-значение).
 * Не задано/пусто → no-op (выход 0): «параметр владельца» (решение владельца).
 *
 * Идемпотентность: findFirst перед create; повторный прогон = без дублей.
 *
 * Запуск:
 *   bun run scripts/seed-support-project.ts
 */

import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

const SUPPORT_VENDOR_ORG_ID_KEY = 'support.vendor_org_id';
const PROJECT_IDENTIFIER = 'SUP';

interface StateSeed {
  name: string;
  category: string;
  sequence: number;
  isDefault: boolean;
  color: string;
}

const STATES: StateSeed[] = [
  { name: 'Новое', category: 'unstarted', sequence: 1, isDefault: true, color: '#3B82F6' },
  { name: 'В работе', category: 'started', sequence: 2, isDefault: false, color: '#F59E0B' },
  { name: 'Ждёт клиента', category: 'started', sequence: 3, isDefault: false, color: '#8B5CF6' },
  { name: 'Решено', category: 'completed', sequence: 4, isDefault: false, color: '#10B981' },
  { name: 'Закрыто', category: 'cancelled', sequence: 5, isDefault: false, color: '#6B7280' },
  { name: 'Спам', category: 'cancelled', sequence: 6, isDefault: false, color: '#EF4444' },
];

/** Прочитать вендор-Org из AdminSetting (JSON-значение). null если нет/пусто. */
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

  // Владелец вендор-Org (для Project.ownerId).
  const ownerMembership = await prisma.membership.findFirst({
    where: { orgId: vendorOrgId, role: 'owner' },
    select: { userId: true },
  });
  if (!ownerMembership) {
    console.error(
      `У вендор-Org ${vendorOrgId} нет membership role=owner — не могу задать Project.ownerId. Прерываю.`,
    );
    process.exit(1);
  }
  const ownerId = ownerMembership.userId;

  // 1. Project (идемпотентно по identifier+systemGenerated в вендор-Org).
  let project = await prisma.project.findFirst({
    where: {
      tenantId: vendorOrgId,
      systemGenerated: true,
      identifier: PROJECT_IDENTIFIER,
    },
    select: { id: true, defaultStateId: true },
  });
  if (!project) {
    const created = await prisma.project.create({
      data: {
        tenantId: vendorOrgId,
        slug: 'support',
        identifier: PROJECT_IDENTIFIER,
        name: 'Поддержка',
        ownerId,
        systemGenerated: true,
      },
      select: { id: true, defaultStateId: true },
    });
    project = created;
    console.log(`[created] Project SUP (id=${project.id})`);
  } else {
    console.log(`[exists] Project SUP (id=${project.id})`);
  }

  // 2. IssueStates (идемпотентно по projectId+name).
  let defaultStateId: string | null = null;
  for (const s of STATES) {
    let state = await prisma.issueState.findFirst({
      where: { projectId: project.id, name: s.name },
      select: { id: true },
    });
    if (!state) {
      state = await prisma.issueState.create({
        data: {
          tenantId: vendorOrgId,
          projectId: project.id,
          name: s.name,
          category: s.category,
          sequence: s.sequence,
          isDefault: s.isDefault,
          color: s.color,
        },
        select: { id: true },
      });
      console.log(`[created] IssueState '${s.name}' (${s.category})`);
    } else {
      console.log(`[exists] IssueState '${s.name}'`);
    }
    if (s.isDefault) defaultStateId = state.id;
  }

  // 3. project.defaultStateId = 'Новое' (если ещё не выставлен).
  if (defaultStateId && project.defaultStateId !== defaultStateId) {
    await prisma.project.update({
      where: { id: project.id },
      data: { defaultStateId },
    });
    console.log(`[updated] Project.defaultStateId → '${defaultStateId}' (Новое)`);
  }

  // 4. SupportSlaPolicy (синглтон per вендор-Org, дефолты 60/480).
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
