/**
 * Sprint 3 B1-3.3 — миграция legacy `Task` → новый трекерный `Issue`.
 *
 * Задача: каждая legacy-задача из встреч (action item) перенесена в новый
 * трекер как `Issue` внутри виртуального проекта «Из встреч» (per Org).
 *
 * Идемпотентно: повторный запуск пропускает уже мигрированные задачи
 * (`externalSource='meeting_legacy'` + `externalId=<legacy Task.id>`).
 *
 * Запуск:
 *   bun run scripts/migrate-task-to-issue.ts                   — dry-run (по умолчанию)
 *   bun run scripts/migrate-task-to-issue.ts --apply           — реальная запись
 *   bun run scripts/migrate-task-to-issue.ts --org-id <id>     — одна организация
 *   bun run scripts/migrate-task-to-issue.ts --apply --org-id <id>
 *
 * Legacy-данные:
 *   - Task НЕ удаляется (см. CLAUDE.md — модели Task не трогаем).
 *   - Legacy REST `/api/v1/tasks/*` остаётся работать, помечен `@deprecated`.
 *   - `Task.assigneeRaw`, который не удалось замапить на User, сохраняется в
 *     `IssueActivity{ verb:'migrated_from_legacy_task' }.metadata.legacyAssigneeRaw`.
 *     На `Issue` нет колонки `metadata`, поэтому используем IssueActivity (audit
 *     trail трекера) — это нативное место для такой технической метаинформации.
 *
 * Маппинг статусов:
 *   TaskStatus.open         → IssueState{ category:'backlog'   } (или fallback)
 *   TaskStatus.in_progress  → IssueState{ category:'started'   }
 *   TaskStatus.done         → IssueState{ category:'completed' }
 *   TaskStatus.cancelled    → IssueState{ category:'cancelled' }
 *
 * Если нужной категории в проекте нет — fallback на первый backlog (или null).
 *
 * Owner виртуального проекта: первый Membership(role='owner'); fallback на
 * первого member любого role; финальный fallback на `Org.ownerId`.
 */

import { PrismaClient, type Prisma } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';

type IssueStateCategory =
  | 'backlog'
  | 'unstarted'
  | 'started'
  | 'completed'
  | 'cancelled';

interface CliFlags {
  apply: boolean;
  orgId: string | null;
}

interface OrgStats {
  orgId: string;
  orgName: string;
  projectCreated: boolean;
  statesCreated: number;
  tasksTotal: number;
  migrated: number;
  skipped: number;
  unmatchedAssignee: number;
}

const VIRTUAL_PROJECT_SLUG = 'from-meetings';
const VIRTUAL_PROJECT_IDENTIFIER = 'MTG';
const VIRTUAL_PROJECT_NAME = 'Из встреч';

const DEFAULT_STATES: ReadonlyArray<{
  name: string;
  category: IssueStateCategory;
  color: string;
  sequence: number;
  isDefault: boolean;
}> = [
  { name: 'Бэклог', category: 'backlog', color: '#94A3B8', sequence: 1, isDefault: true },
  { name: 'В работе', category: 'started', color: '#3B82F6', sequence: 2, isDefault: false },
  { name: 'Готово', category: 'completed', color: '#10B981', sequence: 3, isDefault: false },
  { name: 'Отменено', category: 'cancelled', color: '#EF4444', sequence: 4, isDefault: false },
];

const TASK_STATUS_TO_CATEGORY: Record<string, IssueStateCategory> = {
  open: 'backlog',
  in_progress: 'started',
  done: 'completed',
  cancelled: 'cancelled',
};

function parseFlags(argv: string[]): CliFlags {
  const apply = argv.includes('--apply');
  const orgIdx = argv.indexOf('--org-id');
  const orgId =
    orgIdx !== -1 && orgIdx + 1 < argv.length ? (argv[orgIdx + 1] ?? null) : null;
  return { apply, orgId };
}

async function resolveOwnerUserId(
  prisma: PrismaClient,
  orgId: string,
): Promise<string | null> {
  // 1) первый owner membership
  const ownerM = await prisma.membership.findFirst({
    where: { orgId, role: 'owner' },
    orderBy: { joinedAt: 'asc' },
    select: { userId: true },
  });
  if (ownerM) return ownerM.userId;

  // 2) любой первый member (по joinedAt asc)
  const anyM = await prisma.membership.findFirst({
    where: { orgId },
    orderBy: { joinedAt: 'asc' },
    select: { userId: true },
  });
  if (anyM) return anyM.userId;

  // 3) финальный fallback — поле Org.ownerId
  const org = await prisma.org.findUnique({
    where: { id: orgId },
    select: { ownerId: true },
  });
  return org?.ownerId ?? null;
}

/**
 * Возвращает виртуальный Project «Из встреч» для Org. Создаёт его, если нет.
 * В dry-run возвращает «фейковый» объект-описание (без записи).
 */
async function ensureVirtualProject(
  prisma: PrismaClient,
  orgId: string,
  ownerUserId: string,
  apply: boolean,
): Promise<{
  project: { id: string; identifier: string } | null;
  created: boolean;
}> {
  const existing = await prisma.project.findUnique({
    where: { tenantId_slug: { tenantId: orgId, slug: VIRTUAL_PROJECT_SLUG } },
    select: { id: true, identifier: true },
  });
  if (existing) return { project: existing, created: false };

  if (!apply) {
    return { project: null, created: true };
  }

  const created = await prisma.project.create({
    data: {
      tenantId: orgId,
      slug: VIRTUAL_PROJECT_SLUG,
      identifier: VIRTUAL_PROJECT_IDENTIFIER,
      name: VIRTUAL_PROJECT_NAME,
      description: 'Виртуальный проект для legacy задач из встреч (action items).',
      ownerId: ownerUserId,
    },
    select: { id: true, identifier: true },
  });
  return { project: created, created: true };
}

/**
 * Возвращает текущие IssueState проекта; создаёт DEFAULT_STATES, если их нет.
 * Возвращает map { category → IssueState }.
 */
async function ensureProjectStates(
  prisma: PrismaClient,
  tenantId: string,
  projectId: string | null,
  apply: boolean,
): Promise<{
  byCategory: Map<IssueStateCategory, { id: string }>;
  fallbackBacklogId: string | null;
  createdCount: number;
}> {
  // dry-run без созданного проекта — нечего читать
  if (!projectId) {
    return { byCategory: new Map(), fallbackBacklogId: null, createdCount: DEFAULT_STATES.length };
  }

  const existing = await prisma.issueState.findMany({
    where: { projectId },
    select: { id: true, category: true, sequence: true },
  });

  let states = existing;
  let createdCount = 0;

  if (existing.length === 0) {
    if (apply) {
      const created = await prisma.issueState.createManyAndReturn({
        data: DEFAULT_STATES.map((s) => ({
          tenantId,
          projectId,
          name: s.name,
          color: s.color,
          category: s.category,
          sequence: s.sequence,
          isDefault: s.isDefault,
        })),
        select: { id: true, category: true, sequence: true },
      });
      states = created;
      createdCount = created.length;

      // Зафиксируем defaultStateId на проекте (как делает ProjectsService).
      const defaultBacklog = created.find((s) => s.category === 'backlog');
      if (defaultBacklog) {
        await prisma.project.update({
          where: { id: projectId },
          data: { defaultStateId: defaultBacklog.id },
        });
      }
    } else {
      createdCount = DEFAULT_STATES.length;
    }
  }

  const byCategory = new Map<IssueStateCategory, { id: string }>();
  for (const s of states) {
    const cat = s.category as IssueStateCategory;
    if (!byCategory.has(cat)) byCategory.set(cat, { id: s.id });
  }
  const fallbackBacklog =
    byCategory.get('backlog')?.id ??
    states.sort((a, b) => a.sequence - b.sequence)[0]?.id ??
    null;

  return { byCategory, fallbackBacklogId: fallbackBacklog, createdCount };
}

/**
 * Возвращает userId, если получилось замапить legacy assignee.
 * Сначала используем прямую FK `Task.assigneeUserId` (если есть и не удалён).
 * Затем пытаемся найти User в той же Org по email / по name (ILIKE).
 */
async function resolveAssigneeUserId(
  prisma: PrismaClient,
  orgId: string,
  task: { assigneeUserId: string | null; assigneeRaw: string | null },
): Promise<string | null> {
  if (task.assigneeUserId) {
    const u = await prisma.user.findFirst({
      where: { id: task.assigneeUserId, deletedAt: null },
      select: { id: true },
    });
    if (u) return u.id;
  }

  const raw = task.assigneeRaw?.trim();
  if (!raw) return null;

  // Кандидаты — только пользователи этой Org (через Membership).
  const candidates = await prisma.user.findMany({
    where: {
      deletedAt: null,
      memberships: { some: { orgId } },
    },
    select: { id: true, email: true, name: true },
  });

  // 1) точное совпадение по email (case-insensitive)
  const rawLower = raw.toLowerCase();
  const byEmail = candidates.find((c) => c.email.toLowerCase() === rawLower);
  if (byEmail) return byEmail.id;

  // 2) email встречается в строке
  const containsEmail = candidates.find((c) =>
    rawLower.includes(c.email.toLowerCase()),
  );
  if (containsEmail) return containsEmail.id;

  // 3) точное имя
  const byName = candidates.find(
    (c) => c.name.trim().toLowerCase() === rawLower,
  );
  if (byName) return byName.id;

  // 4) подстрочное совпадение в name (минимум 3 символа, чтобы исключить шум)
  if (raw.length >= 3) {
    const byNameContains = candidates.find(
      (c) =>
        c.name.toLowerCase().includes(rawLower) ||
        rawLower.includes(c.name.toLowerCase()),
    );
    if (byNameContains) return byNameContains.id;
  }

  return null;
}

async function migrateTaskToIssue(
  prisma: PrismaClient,
  tenantId: string,
  projectId: string,
  projectIdentifier: string,
  task: {
    id: string;
    meetingId: string;
    title: string;
    description: string | null;
    status: string;
    assigneeUserId: string | null;
    assigneeRaw: string | null;
    dueDate: Date | null;
    createdAt: Date;
    evidenceBlockIds: string[];
  },
  ownerUserId: string,
  states: {
    byCategory: Map<IssueStateCategory, { id: string }>;
    fallbackBacklogId: string | null;
  },
  apply: boolean,
): Promise<{ migrated: boolean; assigneeMatched: boolean }> {
  // 1) Идемпотентность: уже мигрирована?
  const existingIssue = await prisma.issue.findFirst({
    where: {
      tenantId,
      externalSource: 'meeting_legacy',
      externalId: task.id,
    },
    select: { id: true },
  });
  if (existingIssue) {
    return { migrated: false, assigneeMatched: false };
  }

  // 2) Маппинг статуса.
  const cat = TASK_STATUS_TO_CATEGORY[task.status];
  const stateId =
    (cat ? states.byCategory.get(cat)?.id : null) ??
    states.fallbackBacklogId ??
    null;

  // 3) Assignee.
  const assigneeUserId = await resolveAssigneeUserId(prisma, tenantId, task);
  const assigneeMatched = assigneeUserId !== null;

  if (!apply) {
    return { migrated: true, assigneeMatched };
  }

  // 4) Создание Issue + IssueAssignee + IssueActivity в транзакции.
  await prisma.$transaction(async (tx) => {
    const maxRow = await tx.issue.aggregate({
      where: { projectId },
      _max: { sequenceId: true },
    });
    const sequenceId = (maxRow._max.sequenceId ?? 0) + 1;
    const identifier = `${projectIdentifier}-${sequenceId}`;

    const issue = await tx.issue.create({
      data: {
        tenantId,
        projectId,
        identifier,
        sequenceId,
        title: task.title,
        description: task.description,
        priority: 'none',
        stateId,
        dueDate: task.dueDate,
        meetingId: task.meetingId,
        linkedMeetingIds: [task.meetingId],
        sourceBlockIds: task.evidenceBlockIds,
        externalSource: 'meeting_legacy',
        externalId: task.id,
        createdById: ownerUserId,
        createdManually: false,
        createdAt: task.createdAt,
      },
      select: { id: true },
    });

    if (assigneeUserId) {
      await tx.issueAssignee.create({
        data: {
          issueId: issue.id,
          userId: assigneeUserId,
          assignedById: ownerUserId,
        },
      });
    }

    const activityMetadata: Prisma.InputJsonValue = {
      legacyTaskId: task.id,
      legacyStatus: task.status,
      ...(task.assigneeRaw ? { legacyAssigneeRaw: task.assigneeRaw } : {}),
      ...(assigneeUserId ? {} : { assigneeUnmatched: true }),
    };

    await tx.issueActivity.create({
      data: {
        tenantId,
        issueId: issue.id,
        actorUserId: null,
        actorType: 'system',
        verb: 'migrated_from_legacy_task',
        metadata: activityMetadata,
        epoch: BigInt(Date.now()) * 1000n,
      },
    });
  });

  return { migrated: true, assigneeMatched };
}

async function processOrg(
  prisma: PrismaClient,
  org: { id: string; name: string },
  apply: boolean,
): Promise<OrgStats> {
  const stats: OrgStats = {
    orgId: org.id,
    orgName: org.name,
    projectCreated: false,
    statesCreated: 0,
    tasksTotal: 0,
    migrated: 0,
    skipped: 0,
    unmatchedAssignee: 0,
  };

  // Узнаем сколько Task всего в Org (даже если их нет — пропускаем).
  const taskCount = await prisma.task.count({ where: { tenantId: org.id } });
  if (taskCount === 0) {
    console.log(`  [${org.id}] ${org.name}: задач нет — пропуск.`);
    return stats;
  }
  stats.tasksTotal = taskCount;

  const ownerUserId = await resolveOwnerUserId(prisma, org.id);
  if (!ownerUserId) {
    console.warn(
      `  [${org.id}] ${org.name}: не нашёл ownerUserId (нет owner, нет members, нет Org.ownerId) — пропуск.`,
    );
    return stats;
  }

  const { project, created: projectCreated } = await ensureVirtualProject(
    prisma,
    org.id,
    ownerUserId,
    apply,
  );
  stats.projectCreated = projectCreated;

  const states = await ensureProjectStates(
    prisma,
    org.id,
    project?.id ?? null,
    apply,
  );
  stats.statesCreated = states.createdCount;

  if (!project) {
    // dry-run без виртуального проекта: просто посчитаем сколько мигрируется.
    const tasks = await prisma.task.findMany({
      where: { tenantId: org.id },
      select: {
        id: true,
        meetingId: true,
        title: true,
        description: true,
        status: true,
        assigneeUserId: true,
        assigneeRaw: true,
        dueDate: true,
        createdAt: true,
        evidenceBlockIds: true,
      },
    });
    for (const t of tasks) {
      const existing = await prisma.issue.findFirst({
        where: {
          tenantId: org.id,
          externalSource: 'meeting_legacy',
          externalId: t.id,
        },
        select: { id: true },
      });
      if (existing) {
        stats.skipped += 1;
        continue;
      }
      stats.migrated += 1;
      const matched = await resolveAssigneeUserId(prisma, org.id, t);
      if (!matched) stats.unmatchedAssignee += 1;
    }
    return stats;
  }

  // Реальная миграция: батчем читаем Task'и и обрабатываем по одной.
  const BATCH = 200;
  let cursorId: string | null = null;
  for (;;) {
    const tasks = await prisma.task.findMany({
      where: { tenantId: org.id },
      orderBy: { id: 'asc' },
      take: BATCH,
      ...(cursorId ? { skip: 1, cursor: { id: cursorId } } : {}),
      select: {
        id: true,
        meetingId: true,
        title: true,
        description: true,
        status: true,
        assigneeUserId: true,
        assigneeRaw: true,
        dueDate: true,
        createdAt: true,
        evidenceBlockIds: true,
      },
    });
    if (tasks.length === 0) break;

    for (const t of tasks) {
      try {
        const { migrated, assigneeMatched } = await migrateTaskToIssue(
          prisma,
          org.id,
          project.id,
          project.identifier,
          t,
          ownerUserId,
          states,
          apply,
        );
        if (migrated) {
          stats.migrated += 1;
          if (!assigneeMatched) stats.unmatchedAssignee += 1;
        } else {
          stats.skipped += 1;
        }
      } catch (err) {
        console.error(
          `  [${org.id}] task=${t.id} migration FAILED:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    cursorId = tasks[tasks.length - 1]?.id ?? null;
    if (tasks.length < BATCH) break;
  }

  return stats;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const mode = flags.apply ? 'APPLY' : 'DRY-RUN';
  console.log(`=== migrate-task-to-issue START (${mode}) ===`);
  if (flags.orgId) console.log(`Scope: org=${flags.orgId}`);
  else console.log('Scope: ВСЕ организации');

  const prisma = createPrismaClient();
  const allStats: OrgStats[] = [];

  try {
    const orgs = await prisma.org.findMany({
      where: {
        deletedAt: null,
        ...(flags.orgId ? { id: flags.orgId } : {}),
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true },
    });

    if (orgs.length === 0) {
      console.warn('Не найдено организаций (с учётом фильтров).');
      return;
    }

    console.log(`Найдено организаций: ${orgs.length}`);

    for (const org of orgs) {
      console.log(`\n→ Org "${org.name}" (${org.id})`);
      const stats = await processOrg(prisma, org, flags.apply);
      allStats.push(stats);
      console.log(
        `  total=${stats.tasksTotal}  migrated=${stats.migrated}  skipped=${stats.skipped}  unmatched=${stats.unmatchedAssignee}` +
          `  project=${stats.projectCreated ? 'CREATED' : 'reused'}  states=${stats.statesCreated}`,
      );
    }

    // Сводка.
    const sum = allStats.reduce(
      (acc, s) => ({
        orgs: acc.orgs + 1,
        tasksTotal: acc.tasksTotal + s.tasksTotal,
        migrated: acc.migrated + s.migrated,
        skipped: acc.skipped + s.skipped,
        unmatched: acc.unmatched + s.unmatchedAssignee,
        projectsCreated: acc.projectsCreated + (s.projectCreated ? 1 : 0),
        statesCreated: acc.statesCreated + s.statesCreated,
      }),
      {
        orgs: 0,
        tasksTotal: 0,
        migrated: 0,
        skipped: 0,
        unmatched: 0,
        projectsCreated: 0,
        statesCreated: 0,
      },
    );
    console.log('\n=== SUMMARY ===');
    console.log(`Mode:               ${mode}`);
    console.log(`Orgs обработано:    ${sum.orgs}`);
    console.log(`Task всего:         ${sum.tasksTotal}`);
    console.log(`Issue мигрировано:  ${sum.migrated}`);
    console.log(`Skipped (повтор):   ${sum.skipped}`);
    console.log(`Assignee unmatched: ${sum.unmatched}`);
    console.log(`Виртуальных проектов создано: ${sum.projectsCreated}`);
    console.log(`Дефолтных IssueState создано: ${sum.statesCreated}`);
    if (!flags.apply) {
      console.log('\nDRY-RUN: в БД ничего не записано. Запусти с --apply, чтобы применить.');
    }
    console.log('=== migrate-task-to-issue DONE ===');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('migrate-task-to-issue FAILED:', err);
  process.exit(1);
});
