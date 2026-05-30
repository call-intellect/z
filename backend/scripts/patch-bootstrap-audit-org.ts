/**
 * patch-bootstrap-audit-org.ts — одноразовый dev-скрипт для аудита трекера.
 *
 * Идемпотентно подготавливает Org `cmpqs6t9h0001bouncils5az5` (созданную
 * `patch-create-dev-audit-user.ts`) для прохождения UI/API-аудита трекера:
 *
 *   1) UPSERT Subscription со status=ACTIVE (period 30 дней, monthly, manual_admin)
 *      — SubscriptionGuard будет пропускать POST'ы; UI снимет демо-баннер.
 *   2) Прогон системных TeamTemplate (10 шт., tenantId=null) через
 *      `seedSystemTeamTemplates` — чтобы /api/v1/team-templates выдал список.
 *   3) Создаёт ОДИН демо-проект `DEMO` («Демо проект») со всеми атрибутами:
 *        - Board(isDefault=true)
 *        - 4 IssueState: Бэклог / В работе / Готово / Отменено
 *        - 5 Issue (DEMO-1..DEMO-5): разные state/priority,
 *          одна подзадача, одна связь blocks, 3 ассайнмента на audit-dev,
 *          2 комментария к первой задаче (один с @-упоминанием).
 *
 * НЕ регистрируется в `apply-prod-deploy.ts` — в прод не идёт.
 *
 * Запуск (из `backend/`):
 *   WEBHOOK_SECRETS_ENCRYPTION_KEY="..." bun run scripts/patch-bootstrap-audit-org.ts
 */

import type { Prisma, PrismaClient } from '@prisma/client';

import { seedSystemTeamTemplates } from '../src/modules/tracker/seed/team-templates-seed';

import { createPrismaClient } from './_lib/prisma';

const ORG_ID = 'cmpqs6t9h0001bouncils5az5';
const USER_ID = 'cmpqs6t8i0000bounxb8xfkqf';

const PROJECT_SLUG = 'demo';
const PROJECT_IDENTIFIER = 'DEMO';
const PROJECT_NAME = 'Демо проект';

// ───────────── 1. Подписка ACTIVE ─────────────

async function upsertActiveSubscription(prisma: PrismaClient): Promise<void> {
  const now = new Date();
  const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const existing = await prisma.subscription.findUnique({
    where: { tenantId: ORG_ID },
  });

  const patch: Prisma.SubscriptionUncheckedUpdateInput = {
    status: 'ACTIVE',
    paymentMode: 'paid',
    billingPeriod: 'monthly',
    startedAt: existing?.startedAt ?? now,
    currentPeriodStart: now,
    currentPeriodEnd: periodEnd,
    pastDueUntil: null,
    autoRenew: false,
    renewalMethod: 'manual_admin',
  };

  const sub = existing
    ? await prisma.subscription.update({
        where: { id: existing.id },
        data: patch,
      })
    : await prisma.subscription.create({
        data: {
          tenantId: ORG_ID,
          ...(patch as Prisma.SubscriptionUncheckedCreateInput),
        },
      });

  await prisma.subscriptionEvent.create({
    data: {
      subscriptionId: sub.id,
      eventType: 'status_forced',
      payload: {
        fromStatus: existing?.status ?? null,
        toStatus: 'ACTIVE',
        source: 'patch-bootstrap-audit-org',
      },
      byUserId: USER_ID,
      reason: 'Dev-аудит трекера: активная подписка для прохождения SubscriptionGuard',
    },
  });

  console.log('[bootstrap] subscription ACTIVE', {
    id: sub.id,
    status: sub.status,
    currentPeriodEnd: sub.currentPeriodEnd,
  });
}

// ───────────── 2. Системные TeamTemplate ─────────────

async function seedTeamTemplates(prisma: PrismaClient): Promise<void> {
  const stats = await seedSystemTeamTemplates(prisma);
  console.log('[bootstrap] team-templates', stats);
}

// ───────────── 3. Демо-проект ─────────────

interface StateRow {
  id: string;
  category: string;
}

async function bootstrapDemoProject(prisma: PrismaClient): Promise<void> {
  // Project — upsert по @@unique([tenantId, slug])
  let project = await prisma.project.findUnique({
    where: { tenantId_slug: { tenantId: ORG_ID, slug: PROJECT_SLUG } },
  });

  if (!project) {
    project = await prisma.project.create({
      data: {
        tenantId: ORG_ID,
        slug: PROJECT_SLUG,
        identifier: PROJECT_IDENTIFIER,
        name: PROJECT_NAME,
        description: 'Демо-данные для аудита модуля трекера.',
        ownerId: USER_ID,
        externalSource: 'demo',
      },
    });
    console.log('[bootstrap] project created', { id: project.id });
  } else {
    console.log('[bootstrap] project reuse', { id: project.id });
  }

  // ProjectMember (owner — audit-dev)
  await prisma.projectMember.upsert({
    where: {
      projectId_userId: { projectId: project.id, userId: USER_ID },
    },
    create: {
      projectId: project.id,
      userId: USER_ID,
      role: 20, // Admin
    },
    update: { role: 20 },
  });

  // Default Board — @@unique([projectId, name])
  const board = await prisma.board.upsert({
    where: {
      projectId_name: { projectId: project.id, name: 'Доска' },
    },
    create: {
      tenantId: ORG_ID,
      projectId: project.id,
      name: 'Доска',
      color: '#5EEAD4',
      sequence: 0,
      isDefault: true,
    },
    update: {
      color: '#5EEAD4',
      sequence: 0,
      isDefault: true,
    },
  });
  console.log('[bootstrap] board ready', { id: board.id });

  // IssueState x4 — нет unique constraint, поэтому проверяем по name
  const stateDefs: Array<{
    name: string;
    category: string;
    color: string;
    sequence: number;
    isDefault: boolean;
  }> = [
    { name: 'Бэклог', category: 'backlog', color: '#94A3B8', sequence: 0, isDefault: true },
    { name: 'В работе', category: 'started', color: '#3B82F6', sequence: 1, isDefault: false },
    { name: 'Готово', category: 'completed', color: '#22C55E', sequence: 2, isDefault: false },
    { name: 'Отменено', category: 'cancelled', color: '#EF4444', sequence: 3, isDefault: false },
  ];

  const stateByName = new Map<string, StateRow>();
  for (const def of stateDefs) {
    const existing = await prisma.issueState.findFirst({
      where: { projectId: project.id, name: def.name },
    });
    const row = existing
      ? await prisma.issueState.update({
          where: { id: existing.id },
          data: {
            category: def.category,
            color: def.color,
            sequence: def.sequence,
            isDefault: def.isDefault,
          },
        })
      : await prisma.issueState.create({
          data: {
            tenantId: ORG_ID,
            projectId: project.id,
            externalSource: 'demo',
            name: def.name,
            category: def.category,
            color: def.color,
            sequence: def.sequence,
            isDefault: def.isDefault,
          },
        });
    stateByName.set(def.name, { id: row.id, category: row.category });
  }

  // Project.defaultStateId — Бэклог
  const backlogId = stateByName.get('Бэклог')!.id;
  if (project.defaultStateId !== backlogId) {
    await prisma.project.update({
      where: { id: project.id },
      data: { defaultStateId: backlogId },
    });
  }
  console.log('[bootstrap] issue-states ready', stateByName.size);

  // ── Issues: 5 шт, идемпотентность по identifier ──
  const issueDefs: Array<{
    identifier: string;
    sequenceId: number;
    title: string;
    description: string;
    priority: 'urgent' | 'high' | 'medium' | 'low' | 'none';
    stateName: string;
    assigned: boolean;
    isSubtask: boolean;
  }> = [
    {
      identifier: 'DEMO-1',
      sequenceId: 1,
      title: 'Собрать требования к демо-аудиту',
      description: 'Описание задачи №1: сбор контекста.',
      priority: 'high',
      stateName: 'В работе',
      assigned: true,
      isSubtask: false,
    },
    {
      identifier: 'DEMO-2',
      sequenceId: 2,
      title: 'Подзадача: проверить UI канбана',
      description: 'Подзадача DEMO-1: канбан-доска.',
      priority: 'medium',
      stateName: 'Бэклог',
      assigned: true,
      isSubtask: true, // parent = DEMO-1
    },
    {
      identifier: 'DEMO-3',
      sequenceId: 3,
      title: 'Заблокировано инфраструктурой',
      description: 'Этой задаче нужен релиз DEMO-1 — связь blocks.',
      priority: 'urgent',
      stateName: 'Бэклог',
      assigned: false,
      isSubtask: false,
    },
    {
      identifier: 'DEMO-4',
      sequenceId: 4,
      title: 'Готовая задача',
      description: 'Закрытая задача для демонстрации completed-state.',
      priority: 'low',
      stateName: 'Готово',
      assigned: true,
      isSubtask: false,
    },
    {
      identifier: 'DEMO-5',
      sequenceId: 5,
      title: 'Отменённая задача',
      description: 'Демонстрация cancelled-state.',
      priority: 'none',
      stateName: 'Отменено',
      assigned: false,
      isSubtask: false,
    },
  ];

  const issueByIdentifier = new Map<string, { id: string }>();
  for (const def of issueDefs) {
    const stateId = stateByName.get(def.stateName)!.id;

    const existing = await prisma.issue.findUnique({
      where: { tenantId_identifier: { tenantId: ORG_ID, identifier: def.identifier } },
    });

    const issue = existing
      ? await prisma.issue.update({
          where: { id: existing.id },
          data: {
            title: def.title,
            description: def.description,
            descriptionStripped: def.description,
            priority: def.priority,
            stateId,
            boardId: board.id,
          },
        })
      : await prisma.issue.create({
          data: {
            tenantId: ORG_ID,
            projectId: project.id,
            identifier: def.identifier,
            sequenceId: def.sequenceId,
            title: def.title,
            description: def.description,
            descriptionStripped: def.description,
            priority: def.priority,
            stateId,
            boardId: board.id,
            createdById: USER_ID,
            externalSource: 'demo',
            createdManually: true,
            completedAt: def.stateName === 'Готово' ? new Date() : null,
          },
        });
    issueByIdentifier.set(def.identifier, { id: issue.id });
  }

  // Parent (DEMO-2 → DEMO-1)
  const demo1 = issueByIdentifier.get('DEMO-1')!.id;
  const demo2 = issueByIdentifier.get('DEMO-2')!.id;
  const demo3 = issueByIdentifier.get('DEMO-3')!.id;
  const demo4 = issueByIdentifier.get('DEMO-4')!.id;

  await prisma.issue.update({
    where: { id: demo2 },
    data: { parentId: demo1 },
  });

  // Assignees: DEMO-1, DEMO-2, DEMO-4 — audit-dev
  for (const issueId of [demo1, demo2, demo4]) {
    await prisma.issueAssignee.upsert({
      where: { issueId_userId: { issueId, userId: USER_ID } },
      create: { issueId, userId: USER_ID, assignedById: USER_ID },
      update: {},
    });
  }

  // IssueRelation: DEMO-1 blocks DEMO-3
  await prisma.issueRelation.upsert({
    where: {
      sourceIssueId_targetIssueId_relationType: {
        sourceIssueId: demo1,
        targetIssueId: demo3,
        relationType: 'blocks',
      },
    },
    create: {
      sourceIssueId: demo1,
      targetIssueId: demo3,
      relationType: 'blocks',
      createdById: USER_ID,
    },
    update: {},
  });

  // Комментарии к DEMO-1 (идемпотентность через простой findFirst по контенту)
  const commentDefs: Array<{ content: string; mention: boolean }> = [
    {
      content: 'Первый комментарий — фиксирую старт работ.',
      mention: false,
    },
    {
      content: '@audit-dev посмотри пожалуйста сроки и подтверди.',
      mention: true,
    },
  ];

  for (const def of commentDefs) {
    const existing = await prisma.issueComment.findFirst({
      where: { issueId: demo1, contentStripped: def.content },
    });
    if (existing) continue;

    const comment = await prisma.issueComment.create({
      data: {
        issueId: demo1,
        authorId: USER_ID,
        content: JSON.stringify({
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: def.content }],
            },
          ],
        }),
        contentStripped: def.content,
        access: 'internal',
      },
    });

    if (def.mention) {
      await prisma.issueMention.create({
        data: {
          issueId: demo1,
          commentId: comment.id,
          mentionedUserId: USER_ID,
          mentionedByUserId: USER_ID,
        },
      });
    }
  }

  console.log('[bootstrap] issues ready', issueByIdentifier.size);
}

// ───────────── main ─────────────

async function main(): Promise<void> {
  const prisma = createPrismaClient();
  try {
    console.log('=== patch-bootstrap-audit-org START ===');

    // Sanity-check: Org и User существуют
    const org = await prisma.org.findUnique({ where: { id: ORG_ID } });
    if (!org) throw new Error(`Org ${ORG_ID} не найдена — запусти patch-create-dev-audit-user сначала`);
    const user = await prisma.user.findUnique({ where: { id: USER_ID } });
    if (!user) throw new Error(`User ${USER_ID} не найден — запусти patch-create-dev-audit-user сначала`);

    await upsertActiveSubscription(prisma);
    await seedTeamTemplates(prisma);
    await bootstrapDemoProject(prisma);

    console.log('=== patch-bootstrap-audit-org DONE ===');
    console.log(`READY: orgId=${ORG_ID} userId=${USER_ID} project=${PROJECT_IDENTIFIER}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[bootstrap] ERROR', err);
  process.exit(1);
});
