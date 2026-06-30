import { PrismaClient, type Prisma } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';

type IssueStateCategory = 'backlog' | 'unstarted' | 'started' | 'completed' | 'cancelled';

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
  created: number;
  linkedToSpine: number;
  skippedAlreadyMigrated: number;
  taskSourceMoved: number;
  unmatchedAssignee: number;
}

interface LegacyTaskRow {
  id: string;
  tenantId: string;
  meetingId: string | null;
  sourceType: string;
  sourceChatSessionId: string | null;
  sourceChatId: string | null;
  userId: string;
  title: string;
  description: string | null;
  status: string;
  assigneeRaw: string | null;
  assigneeUserId: string | null;
  dueDate: Date | null;
  sourceQuote: string | null;
  confidence: number | null;
  createdManually: boolean;
  evidenceBlockIds: string[];
  previewSourceRef: Prisma.JsonValue | null;
  createdAt: Date;
}

interface LegacyTaskSourceRow {
  sourceType: string;
  sourceRefId: string;
  chatId: string | null;
  quote: string | null;
}

const VIRTUAL_PROJECT_SLUG = 'from-meetings';
const VIRTUAL_PROJECT_IDENTIFIER = 'MTG';
const VIRTUAL_PROJECT_NAME = 'Из встреч';

const CHATBOX_PROJECT_SLUG = 'inbox-chatbox';
const CHATBOX_PROJECT_IDENTIFIER = 'INBOX';
const CHATBOX_PROJECT_NAME = 'Входящие из переписки';

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

export const TASK_STATUS_TO_CATEGORY: Record<string, IssueStateCategory> = {
  open: 'backlog',
  in_progress: 'started',
  done: 'completed',
  cancelled: 'cancelled',
};

export function statusToCategory(status: string): IssueStateCategory {
  return TASK_STATUS_TO_CATEGORY[status] ?? 'backlog';
}

function normalizeTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/ё/gu, 'е');
}

export function isSpineTwin(
  task: { title: string; evidenceBlockIds: string[] },
  candidate: { title: string; sourceBlockIds: string[] },
): boolean {
  const taskBlocks = new Set(task.evidenceBlockIds ?? []);
  if (taskBlocks.size > 0) {
    for (const b of candidate.sourceBlockIds ?? []) {
      if (taskBlocks.has(b)) return true;
    }
  }
  const tt = normalizeTitle(task.title);
  const ct = normalizeTitle(candidate.title);
  return tt.length > 0 && tt === ct;
}

function parseFlags(argv: string[]): CliFlags {
  const apply = argv.includes('--apply');
  const orgIdx = argv.indexOf('--org-id');
  const orgId = orgIdx !== -1 && orgIdx + 1 < argv.length ? (argv[orgIdx + 1] ?? null) : null;
  return { apply, orgId };
}

async function legacyTaskTableExists(prisma: PrismaClient): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ reg: string | null }>>`
    SELECT to_regclass('public."Task"')::text AS reg
  `;
  return rows[0]?.reg != null;
}

async function countLegacyTasks(prisma: PrismaClient, tenantId: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count FROM "Task" WHERE "tenantId" = ${tenantId}
  `;
  return Number(rows[0]?.count ?? 0n);
}

async function fetchLegacyTaskBatch(
  prisma: PrismaClient,
  tenantId: string,
  cursorId: string | null,
  limit: number,
): Promise<LegacyTaskRow[]> {
  const sql = `
    SELECT
      "id","tenantId","meetingId","sourceType","sourceChatSessionId","sourceChatId",
      "userId","title","description","status","assigneeRaw","assigneeUserId","dueDate",
      "sourceQuote","confidence","createdManually","evidenceBlockIds","previewSourceRef","createdAt"
    FROM "Task"
    WHERE "tenantId" = $1
      ${cursorId ? 'AND "id" > $2' : ''}
    ORDER BY "id" ASC
    LIMIT ${limit}
  `;
  const params = cursorId ? [tenantId, cursorId] : [tenantId];
  return prisma.$queryRawUnsafe<LegacyTaskRow[]>(sql, ...params);
}

async function fetchLegacyTaskSources(
  prisma: PrismaClient,
  taskId: string,
): Promise<LegacyTaskSourceRow[]> {
  return prisma.$queryRaw<LegacyTaskSourceRow[]>`
    SELECT "sourceType","sourceRefId","chatId","quote"
    FROM "TaskSource"
    WHERE "taskId" = ${taskId}
  `;
}

async function resolveOwnerUserId(prisma: PrismaClient, orgId: string): Promise<string | null> {
  const ownerM = await prisma.membership.findFirst({
    where: { orgId, role: 'owner' },
    orderBy: { joinedAt: 'asc' },
    select: { userId: true },
  });
  if (ownerM) return ownerM.userId;

  const anyM = await prisma.membership.findFirst({
    where: { orgId },
    orderBy: { joinedAt: 'asc' },
    select: { userId: true },
  });
  if (anyM) return anyM.userId;

  const org = await prisma.org.findUnique({
    where: { id: orgId },
    select: { ownerId: true },
  });
  return org?.ownerId ?? null;
}

async function ensureProject(
  prisma: PrismaClient,
  orgId: string,
  ownerUserId: string,
  apply: boolean,
  cfg: { slug: string; identifier: string; name: string; description: string },
): Promise<{ project: { id: string; identifier: string } | null; created: boolean }> {
  const existing = await prisma.project.findUnique({
    where: { tenantId_slug: { tenantId: orgId, slug: cfg.slug } },
    select: { id: true, identifier: true },
  });
  if (existing) return { project: existing, created: false };

  if (!apply) {
    return { project: null, created: true };
  }

  const created = await prisma.project.create({
    data: {
      tenantId: orgId,
      slug: cfg.slug,
      identifier: cfg.identifier,
      name: cfg.name,
      description: cfg.description,
      ownerId: ownerUserId,
    },
    select: { id: true, identifier: true },
  });
  return { project: created, created: true };
}

async function ensureVirtualProject(
  prisma: PrismaClient,
  orgId: string,
  ownerUserId: string,
  apply: boolean,
): Promise<{ project: { id: string; identifier: string } | null; created: boolean }> {
  return ensureProject(prisma, orgId, ownerUserId, apply, {
    slug: VIRTUAL_PROJECT_SLUG,
    identifier: VIRTUAL_PROJECT_IDENTIFIER,
    name: VIRTUAL_PROJECT_NAME,
    description: 'Задачи, перенесённые из встреч.',
  });
}

async function ensureChatboxProject(
  prisma: PrismaClient,
  orgId: string,
  ownerUserId: string,
  apply: boolean,
): Promise<{ project: { id: string; identifier: string } | null; created: boolean }> {
  return ensureProject(prisma, orgId, ownerUserId, apply, {
    slug: CHATBOX_PROJECT_SLUG,
    identifier: CHATBOX_PROJECT_IDENTIFIER,
    name: CHATBOX_PROJECT_NAME,
    description: 'Задачи, перенесённые из переписки.',
  });
}

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
    byCategory.get('backlog')?.id ?? states.sort((a, b) => a.sequence - b.sequence)[0]?.id ?? null;

  return { byCategory, fallbackBacklogId: fallbackBacklog, createdCount };
}

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

  const candidates = await prisma.user.findMany({
    where: {
      deletedAt: null,
      memberships: { some: { orgId } },
    },
    select: { id: true, email: true, name: true },
  });

  const rawLower = raw.toLowerCase();
  const byEmail = candidates.find((c) => c.email.toLowerCase() === rawLower);
  if (byEmail) return byEmail.id;

  const containsEmail = candidates.find((c) => rawLower.includes(c.email.toLowerCase()));
  if (containsEmail) return containsEmail.id;

  const byName = candidates.find((c) => c.name.trim().toLowerCase() === rawLower);
  if (byName) return byName.id;

  if (raw.length >= 3) {
    const byNameContains = candidates.find(
      (c) => c.name.toLowerCase().includes(rawLower) || rawLower.includes(c.name.toLowerCase()),
    );
    if (byNameContains) return byNameContains.id;
  }

  return null;
}

function isMeetingTask(task: LegacyTaskRow): boolean {
  return task.sourceType === 'meeting' || (task.meetingId != null && task.meetingId.length > 0);
}

async function findSelfMigratedIssue(
  prisma: PrismaClient,
  tenantId: string,
  taskId: string,
): Promise<{ id: string } | null> {
  return prisma.issue.findFirst({
    where: {
      tenantId,
      externalId: taskId,
      externalSource: { in: ['meeting', 'meeting_legacy', 'chatbox'] },
    },
    select: { id: true },
  });
}

async function findSpineTwin(
  prisma: PrismaClient,
  task: LegacyTaskRow,
): Promise<{ id: string } | null> {
  if (isMeetingTask(task)) {
    if (!task.meetingId) return null;
    const candidates = await prisma.$queryRaw<
      Array<{ id: string; title: string; sourceBlockIds: string[]; externalId: string | null }>
    >`
      SELECT "id","title","sourceBlockIds","externalId"
      FROM "Issue"
      WHERE "tenantId" = ${task.tenantId}
        AND "deletedAt" IS NULL
        AND ("linkedMeetingIds" @> ARRAY[${task.meetingId}]::text[] OR "meetingId" = ${task.meetingId})
    `;
    for (const c of candidates) {
      if (c.externalId === task.id) continue;
      if (isSpineTwin(task, { title: c.title, sourceBlockIds: c.sourceBlockIds ?? [] })) {
        return { id: c.id };
      }
    }
    return null;
  }

  if (task.sourceType === 'chatbox') {
    const candidates = await prisma.issue.findMany({
      where: {
        tenantId: task.tenantId,
        externalSource: 'chatbox',
        deletedAt: null,
      },
      select: { id: true, title: true, sourceBlockIds: true, externalId: true },
    });
    for (const c of candidates) {
      if (c.externalId === task.id) continue;
      if (isSpineTwin(task, { title: c.title, sourceBlockIds: c.sourceBlockIds })) {
        return { id: c.id };
      }
    }
  }

  return null;
}

async function moveTaskSources(
  prisma: PrismaClient,
  tenantId: string,
  task: LegacyTaskRow,
  targetIssueId: string,
  apply: boolean,
): Promise<number> {
  const sources = await fetchLegacyTaskSources(prisma, task.id);

  const links: LegacyTaskSourceRow[] = sources.length > 0 ? sources : [];

  if (task.sourceType === 'chatbox') {
    const refId = task.sourceChatSessionId ?? task.id;
    if (!links.some((l) => l.sourceType === 'chatbox' && l.sourceRefId === refId)) {
      links.push({
        sourceType: 'chatbox',
        sourceRefId: refId,
        chatId: task.sourceChatId,
        quote: task.sourceQuote,
      });
    }
  } else if (isMeetingTask(task) && task.meetingId) {
    if (!links.some((l) => l.sourceType === 'meeting' && l.sourceRefId === task.meetingId)) {
      links.push({
        sourceType: 'meeting',
        sourceRefId: task.meetingId,
        chatId: null,
        quote: task.sourceQuote,
      });
    }
  }

  if (!apply) {
    return links.length;
  }

  let moved = 0;
  for (const s of links) {
    try {
      await prisma.taskSource.create({
        data: {
          tenantId,
          issueId: targetIssueId,
          sourceType: s.sourceType,
          sourceRefId: s.sourceRefId,
          chatId: s.chatId,
          quote: s.quote,
        },
      });
      moved += 1;
    } catch (e) {
      if ((e as { code?: string })?.code !== 'P2002') throw e;
    }
  }

  await prisma.$executeRaw`DELETE FROM "TaskSource" WHERE "taskId" = ${task.id}`;

  return moved;
}

async function createIssueFromTask(
  prisma: PrismaClient,
  task: LegacyTaskRow,
  project: { id: string; identifier: string },
  states: {
    byCategory: Map<IssueStateCategory, { id: string }>;
    fallbackBacklogId: string | null;
  },
): Promise<string> {
  const cat = statusToCategory(task.status);
  const stateId = states.byCategory.get(cat)?.id ?? states.fallbackBacklogId ?? null;

  const meeting = isMeetingTask(task);
  const externalSource = meeting ? 'meeting' : 'chatbox';
  const linkedMeetingIds = meeting && task.meetingId ? [task.meetingId] : [];

  const assigneeUserId = await resolveAssigneeUserId(prisma, task.tenantId, task);

  return prisma.$transaction(async (tx) => {
    const maxRow = await tx.issue.aggregate({
      where: { projectId: project.id },
      _max: { sequenceId: true },
    });
    const sequenceId = (maxRow._max.sequenceId ?? 0) + 1;
    const identifier = `${project.identifier}-${sequenceId}`;

    const issue = await tx.issue.create({
      data: {
        tenantId: task.tenantId,
        projectId: project.id,
        identifier,
        sequenceId,
        title: task.title,
        description: task.description,
        priority: 'none',
        stateId,
        dueDate: task.dueDate,
        linkedMeetingIds,
        sourceBlockIds: task.evidenceBlockIds,
        previewQuote: task.sourceQuote,
        previewSourceRef:
          task.previewSourceRef === null
            ? undefined
            : (task.previewSourceRef as Prisma.InputJsonValue),
        confidence: task.confidence,
        externalSource,
        externalId: task.id,
        createdById: task.userId,
        createdManually: task.createdManually,
        createdAt: task.createdAt,
      },
      select: { id: true },
    });

    if (assigneeUserId) {
      await tx.issueAssignee.create({
        data: {
          issueId: issue.id,
          userId: assigneeUserId,
          assignedById: task.userId,
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
        tenantId: task.tenantId,
        issueId: issue.id,
        actorUserId: null,
        actorType: 'system',
        verb: 'migrated_from_legacy_task',
        metadata: activityMetadata,
        epoch: BigInt(Date.now()) * 1000n,
      },
    });

    return issue.id;
  });
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
    created: 0,
    linkedToSpine: 0,
    skippedAlreadyMigrated: 0,
    taskSourceMoved: 0,
    unmatchedAssignee: 0,
  };

  const taskCount = await countLegacyTasks(prisma, org.id);
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

  const meetingProj = await ensureVirtualProject(prisma, org.id, ownerUserId, apply);
  stats.projectCreated = meetingProj.created;
  const meetingStates = await ensureProjectStates(
    prisma,
    org.id,
    meetingProj.project?.id ?? null,
    apply,
  );
  stats.statesCreated += meetingStates.createdCount;

  let chatboxProj: { project: { id: string; identifier: string } | null; created: boolean } | null =
    null;
  let chatboxStates: Awaited<ReturnType<typeof ensureProjectStates>> | null = null;

  const BATCH = 200;
  let cursorId: string | null = null;
  for (;;) {
    const tasks = await fetchLegacyTaskBatch(prisma, org.id, cursorId, BATCH);
    if (tasks.length === 0) break;

    for (const t of tasks) {
      try {
        const meeting = isMeetingTask(t);

        const selfMigrated = await findSelfMigratedIssue(prisma, org.id, t.id);
        if (selfMigrated) {
          stats.skippedAlreadyMigrated += 1;
          const moved = await moveTaskSources(prisma, org.id, t, selfMigrated.id, apply);
          stats.taskSourceMoved += moved;
          continue;
        }

        const twin = await findSpineTwin(prisma, t);
        if (twin) {
          stats.linkedToSpine += 1;
          const moved = await moveTaskSources(prisma, org.id, t, twin.id, apply);
          stats.taskSourceMoved += moved;
          console.log(
            `  [${org.id}] task=${t.id} → linked-to-spine issue=${twin.id}, skip create${apply ? '' : ' (dry-run)'}`,
          );
          continue;
        }

        let project: { id: string; identifier: string } | null;
        let states: typeof meetingStates;
        if (meeting) {
          project = meetingProj.project;
          states = meetingStates;
        } else {
          if (!chatboxProj) {
            chatboxProj = await ensureChatboxProject(prisma, org.id, ownerUserId, apply);
            if (chatboxProj.created && !meetingProj.created) stats.projectCreated = true;
            chatboxStates = await ensureProjectStates(
              prisma,
              org.id,
              chatboxProj.project?.id ?? null,
              apply,
            );
            stats.statesCreated += chatboxStates.createdCount;
          }
          project = chatboxProj.project;
          states = chatboxStates!;
        }

        if (!project) {
          stats.created += 1;
          const matched = await resolveAssigneeUserId(prisma, org.id, t);
          if (!matched) stats.unmatchedAssignee += 1;
          const moved = await moveTaskSources(prisma, org.id, t, 'dry-run-issue', false);
          stats.taskSourceMoved += moved;
          continue;
        }

        if (!apply) {
          stats.created += 1;
          const matched = await resolveAssigneeUserId(prisma, org.id, t);
          if (!matched) stats.unmatchedAssignee += 1;
          const moved = await moveTaskSources(prisma, org.id, t, project.id, false);
          stats.taskSourceMoved += moved;
          continue;
        }

        const issueId = await createIssueFromTask(prisma, t, project, states);
        stats.created += 1;
        const moved = await moveTaskSources(prisma, org.id, t, issueId, apply);
        stats.taskSourceMoved += moved;
        const matched = await resolveAssigneeUserId(prisma, org.id, t);
        if (!matched) stats.unmatchedAssignee += 1;
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
    if (!(await legacyTaskTableExists(prisma))) {
      console.log('[migrate] таблица Task отсутствует — перенос не нужен');
      return;
    }

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
        `  total=${stats.tasksTotal}  created=${stats.created}  linkedToSpine=${stats.linkedToSpine}` +
          `  alreadyMigrated=${stats.skippedAlreadyMigrated}  taskSourceMoved=${stats.taskSourceMoved}` +
          `  unmatched=${stats.unmatchedAssignee}  project=${stats.projectCreated ? 'CREATED' : 'reused'}` +
          `  states=${stats.statesCreated}`,
      );
    }

    const sum = allStats.reduce(
      (acc, s) => ({
        orgs: acc.orgs + 1,
        tasksTotal: acc.tasksTotal + s.tasksTotal,
        created: acc.created + s.created,
        linkedToSpine: acc.linkedToSpine + s.linkedToSpine,
        skippedAlreadyMigrated: acc.skippedAlreadyMigrated + s.skippedAlreadyMigrated,
        taskSourceMoved: acc.taskSourceMoved + s.taskSourceMoved,
        unmatched: acc.unmatched + s.unmatchedAssignee,
        projectsCreated: acc.projectsCreated + (s.projectCreated ? 1 : 0),
        statesCreated: acc.statesCreated + s.statesCreated,
      }),
      {
        orgs: 0,
        tasksTotal: 0,
        created: 0,
        linkedToSpine: 0,
        skippedAlreadyMigrated: 0,
        taskSourceMoved: 0,
        unmatched: 0,
        projectsCreated: 0,
        statesCreated: 0,
      },
    );
    console.log('\n=== SUMMARY ===');
    console.log(`Mode:               ${mode}`);
    console.log(`Orgs обработано:    ${sum.orgs}`);
    console.log(`Task всего:         ${sum.tasksTotal}`);
    console.log(`Issue создано:      ${sum.created}`);
    console.log(`Linked-to-spine:    ${sum.linkedToSpine}`);
    console.log(`Уже мигрировано:    ${sum.skippedAlreadyMigrated}`);
    console.log(`TaskSource moved:   ${sum.taskSourceMoved}`);
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

if (require.main === module) {
  main().catch((err) => {
    console.error('migrate-task-to-issue FAILED:', err);
    process.exit(1);
  });
}
