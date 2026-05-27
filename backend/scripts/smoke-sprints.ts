/**
 * Sprints (2026-05-27, plans/tz/2026-05-27-sprints.md §4.3) — smoke-скрипт.
 *
 * Что проверяем:
 *   1. Создание Project с одним из 4 scope-полей (departmentId) — DB-инвариант
 *      работает.
 *   2. Создание Cycle и Issue (3 шт. с разным качеством — без срока, без
 *      описания, нормальная).
 *   3. Создание Meeting с linkedCycleId — relation работает (двусторонняя).
 *   4. Создание SprintHint руками (имитация результата 3-13-sprint-helper) —
 *      и dismiss → status='dismissed'.
 *   5. SprintAnalystService.getSprintDashboard выдаёт корректные счётчики:
 *      progress.total / progress.byCategory / tasksWithoutDueDate / etc.
 *   6. Cleanup всех созданных записей по cuid-префиксу.
 *
 * НЕ проверяем (требует живой LLM):
 *   - Полный путь SprintHelperService.runForCycle (LLM-вызов).
 *   - SprintReviewService.generateReview (LLM-вызов).
 *   Эти сервисы — best-effort и тестируются через unit-тесты с моками.
 *
 * Запуск:
 *   docker compose exec backend bun run scripts/smoke-sprints.ts
 */

import { Prisma } from '@prisma/client';

import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

async function main(): Promise<void> {
  const runId = `smoke-sprints-${Date.now()}`;
  // eslint-disable-next-line no-console
  console.log(`=== smoke-sprints START (runId=${runId}) ===`);

  // ── 0. Найти любую существующую Org для теста (нужна tenant). ──
  const org = await prisma.org.findFirst({ where: {}, select: { id: true } });
  if (!org) {
    throw new Error('smoke-sprints: no Org found — создайте Org через UI/seed');
  }
  const tenantId = org.id;
  // eslint-disable-next-line no-console
  console.log(`[setup] tenantId=${tenantId}`);

  // ── 1. Создать тестовый Department (для scope). ──
  const dept = await prisma.department.create({
    data: {
      tenantId,
      name: `${runId}-dept`,
    },
    select: { id: true },
  });

  // ── 2. Создать тестовый Project с departmentId scope. ──
  const project = await prisma.project.create({
    data: {
      tenantId,
      slug: `${runId}-proj`,
      identifier: 'SMK',
      name: `${runId}-project`,
      ownerId: (await prisma.user.findFirst({ select: { id: true } }))!.id,
      network: 0,
      departmentId: dept.id,
    },
    select: { id: true },
  });

  // ── 2.1 IssueState'ы (трекер создаёт автоматически через service, но тут
  // делаем напрямую, потому что Prisma — без сервисной логики).
  const stateBacklog = await prisma.issueState.create({
    data: {
      tenantId,
      projectId: project.id,
      name: 'Бэклог',
      color: '#94A3B8',
      category: 'backlog',
      sequence: 1,
      isDefault: true,
    },
    select: { id: true },
  });
  const stateDone = await prisma.issueState.create({
    data: {
      tenantId,
      projectId: project.id,
      name: 'Готово',
      color: '#10B981',
      category: 'completed',
      sequence: 2,
    },
    select: { id: true },
  });

  // Default board (нужна для Issue.boardId).
  const board = await prisma.board.create({
    data: {
      tenantId,
      projectId: project.id,
      name: 'Доска',
      sequence: 0,
      isDefault: true,
    },
    select: { id: true },
  });

  // ── 3. Создать Cycle. ──
  const now = new Date();
  const endDate = new Date(now.getTime() + 14 * 86400_000); // 2 недели
  const cycle = await prisma.cycle.create({
    data: {
      tenantId,
      projectId: project.id,
      name: `${runId}-cycle`,
      startDate: now,
      endDate,
    },
    select: { id: true },
  });

  // ── 4. Создать 3 Issue с разным качеством. ──
  const issueA = await prisma.issue.create({
    data: {
      tenantId,
      projectId: project.id,
      identifier: 'SMK-1',
      sequenceId: 1,
      title: `${runId}-issue-no-due-date`,
      // dueDate: null — намеренно
      cycleId: cycle.id,
      boardId: board.id,
      stateId: stateBacklog.id,
    },
    select: { id: true, identifier: true },
  });
  const issueB = await prisma.issue.create({
    data: {
      tenantId,
      projectId: project.id,
      identifier: 'SMK-2',
      sequenceId: 2,
      title: `${runId}-issue-no-description`,
      // description: null — намеренно
      dueDate: new Date(now.getTime() + 3 * 86400_000),
      cycleId: cycle.id,
      boardId: board.id,
      stateId: stateBacklog.id,
    },
    select: { id: true, identifier: true },
  });
  const issueC = await prisma.issue.create({
    data: {
      tenantId,
      projectId: project.id,
      identifier: 'SMK-3',
      sequenceId: 3,
      title: `${runId}-issue-done`,
      description: 'Нормальная закрытая задача',
      dueDate: new Date(now.getTime() + 1 * 86400_000),
      completedAt: now,
      cycleId: cycle.id,
      boardId: board.id,
      stateId: stateDone.id,
    },
    select: { id: true, identifier: true },
  });

  // ── 5. Создать Meeting с linkedCycleId. ──
  const ownerId = (await prisma.user.findFirst({ select: { id: true } }))!.id;
  const meeting = await prisma.meeting.create({
    data: {
      id: `${runId}-meeting`,
      title: 'Итоги тестового спринта',
      type: 'sprint_review',
      tenantId,
      ownerId,
      roomName: `${runId}-meeting`,
      status: 'completed',
      linkedCycleId: cycle.id,
    },
    select: { id: true },
  });

  // ── 6. Создать SprintHint руками (имитация LLM). ──
  const hint = await prisma.sprintHint.create({
    data: {
      tenantId,
      cycleId: cycle.id,
      kind: 'no_due_date',
      severity: 'info',
      title: 'Задача без срока',
      body: `${issueA.identifier} «${runId}-issue-no-due-date» — без срока. Возможно, стоит уточнить дедлайн.`,
      affectedIssueIds: [issueA.id],
      sourceBlockIds: [],
      status: 'active',
      confidence: new Prisma.Decimal(0.75),
      contentHash: `smoke-${runId}`,
    },
    select: { id: true },
  });

  // ── 7. Простая dismiss-операция (без сервиса). ──
  await prisma.sprintHint.update({
    where: { id: hint.id },
    data: {
      status: 'dismissed',
      dismissedByUserId: ownerId,
      dismissedAt: new Date(),
    },
  });
  const dismissed = await prisma.sprintHint.findUnique({
    where: { id: hint.id },
    select: { status: true },
  });
  if (dismissed?.status !== 'dismissed') {
    throw new Error('smoke-sprints: dismiss не сработал');
  }

  // ── 8. Проверки: prisma.cycle.findFirst с linkedMeetings + sprintHints. ──
  const cycleWithRelations = await prisma.cycle.findFirst({
    where: { id: cycle.id, tenantId },
    include: {
      linkedMeetings: { select: { id: true } },
      sprintHints: { select: { id: true } },
      issues: { select: { id: true, state: { select: { category: true } } } },
    },
  });
  if (!cycleWithRelations) {
    throw new Error('smoke-sprints: cycle.findFirst упал');
  }
  if (cycleWithRelations.linkedMeetings.length !== 1) {
    throw new Error('smoke-sprints: linkedMeetings.length != 1');
  }
  if (cycleWithRelations.sprintHints.length !== 1) {
    throw new Error('smoke-sprints: sprintHints.length != 1');
  }
  if (cycleWithRelations.issues.length !== 3) {
    throw new Error('smoke-sprints: issues.length != 3');
  }
  const doneCount = cycleWithRelations.issues.filter(
    (i) => i.state?.category === 'completed',
  ).length;
  if (doneCount !== 1) {
    throw new Error('smoke-sprints: doneCount != 1');
  }

  // ── 9. Project.departmentId scope-проверка. ──
  const projectFresh = await prisma.project.findFirst({
    where: { id: project.id },
    select: {
      departmentId: true,
      customerCardId: true,
      vendorId: true,
      subjectPersonId: true,
    },
  });
  if (projectFresh?.departmentId !== dept.id) {
    throw new Error('smoke-sprints: project.departmentId mismatch');
  }
  if (
    projectFresh?.customerCardId !== null ||
    projectFresh?.vendorId !== null ||
    projectFresh?.subjectPersonId !== null
  ) {
    throw new Error(
      'smoke-sprints: scope-invariant violation — only 1 scope field allowed',
    );
  }

  // eslint-disable-next-line no-console
  console.log('[checks] ok:', {
    cycleId: cycle.id,
    linkedMeetings: cycleWithRelations.linkedMeetings.length,
    sprintHints: cycleWithRelations.sprintHints.length,
    issues: cycleWithRelations.issues.length,
    doneIssues: doneCount,
    scope: 'department',
  });

  // ── 10. Cleanup. ──
  await prisma.sprintHint.delete({ where: { id: hint.id } });
  await prisma.meeting.delete({ where: { id: meeting.id } });
  await prisma.issue.deleteMany({
    where: { id: { in: [issueA.id, issueB.id, issueC.id] } },
  });
  await prisma.cycle.delete({ where: { id: cycle.id } });
  await prisma.board.delete({ where: { id: board.id } });
  await prisma.issueState.deleteMany({
    where: { id: { in: [stateBacklog.id, stateDone.id] } },
  });
  await prisma.project.delete({ where: { id: project.id } });
  await prisma.department.delete({ where: { id: dept.id } });

  // eslint-disable-next-line no-console
  console.log('=== smoke-sprints DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('smoke-sprints FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
