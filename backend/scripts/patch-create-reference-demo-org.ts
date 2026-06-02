/**
 * patch-create-reference-demo-org.ts
 *
 * Создаёт **одну** эталонную демо-Org «Демо: ТехноСтрим» (isReferenceDemo=true)
 * + системного владельца + Subscription{status=ACTIVE, paymentMode='reference'}.
 * Заливает её через демо-сидеры (23 модуля демо-данных) — те же, что вызывает
 * `seed-demo-workspace.ts` под капотом.
 *
 * После запуска печатает в stdout:
 *   ZDEMO_ORG_ID=<cuid>
 * Эту строку нужно положить в .env (или ENV docker-compose), затем
 * перезапустить backend, чтобы AccountsService.register начал создавать
 * Membership(demo_observer) для новых пользователей.
 *
 * Идемпотентность: повторный запуск находит существующую Org с
 * isReferenceDemo=true и просто печатает её id (не создаёт дубль).
 *
 * Запуск:
 *   docker compose exec backend bun run scripts/patch-create-reference-demo-org.ts
 *
 * Источник: ТЗ plans/tz/2026-06-01-demo-shared-org-model.md §6.1.
 */

import { createPrismaClient } from './_lib/prisma';
import { createEmptyIdMap, type IdMap, type SeedContext } from '../src/modules/onboarding/demo-data/types';
import { seedOrgStructure } from '../src/modules/onboarding/demo-data/org-structure';
import { seedTracker } from '../src/modules/onboarding/demo-data/tracker';
import { seedMeetings } from '../src/modules/onboarding/demo-data/meetings';
import { seedKnowledgeGraph } from '../src/modules/onboarding/demo-data/knowledge-graph';
import { seedGoalsClones } from '../src/modules/onboarding/demo-data/goals-clones';
import { seedOperations } from '../src/modules/onboarding/demo-data/operations';
import { seedChatNotifications } from '../src/modules/onboarding/demo-data/chat-notifications';
import { seedPolish } from '../src/modules/onboarding/demo-data/polish';

const prisma = createPrismaClient();

const DEMO_ORG_NAME = 'Демо: ТехноСтрим';
const SYSTEM_OWNER_EMAIL = 'demo-system@kora.local';
const SYSTEM_OWNER_NAME = 'Кора (системный)';

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('=== patch-create-reference-demo-org START ===');

  // 1. Идемпотентность — есть ли уже эталон?
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

  // 2. Создаём системного владельца (или находим — идемпотентно по email).
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

  // 3. Создаём Org + Membership(owner) + Subscription{ACTIVE, reference}.
  const ownerId = owner.id;
  const orgId = await prisma.$transaction(async (tx) => {
    // Уникальный slug — генерируем простой "demo-technostream-<n>" пока не свободен.
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

  // 4. Заливаем демо-данные (23 модуля; см. seed-demo-workspace.ts).
  const ids: IdMap = createEmptyIdMap();
  const ctx: SeedContext = { prisma, tenantId: orgId, ownerUserId: ownerId };

  // eslint-disable-next-line no-console
  console.log('── Заливка демо-данных: org-structure → tracker → meetings → knowledge-graph → goals/clones → operations → chat → polish');

  await seedOrgStructure(ctx, ids);
  await seedTracker(ctx, ids);
  await seedMeetings(ctx, ids);
  await seedKnowledgeGraph(ctx, ids);
  await seedGoalsClones(ctx, ids);
  await seedOperations(ctx, ids);
  await seedChatNotifications(ctx, ids);
  await seedPolish(ctx, ids);

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
