import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';

export type TasksDigestPriority = 'urgent' | 'high' | 'medium' | 'low' | 'none';
export type TasksDigestGroupKey = 'overdue' | 'due_today' | 'in_progress' | 'backlog';

export interface OpenIssueRow {
  issueId: string;
  identifier: string;
  title: string;
  dueDate: Date | null;
  priority: TasksDigestPriority;
  stateCategory: string | null;
}

export interface TasksDailyOpenItem {
  issueId: string;
  identifier: string;
  title: string;
  dueDate: string | null;
  priority: TasksDigestPriority;
  actionUrl: string;
}

export interface TasksDailyOpenGroup {
  key: TasksDigestGroupKey;
  label: string;
  items: TasksDailyOpenItem[];
}

export interface TasksDailyOpenPayload {
  dateMsk: string;
  isEmpty: boolean;
  total: number;
  shownCount: number;
  overflowCount: number;
  title: string;
  actionUrl: string;
  groups: TasksDailyOpenGroup[];
}

const PRIORITY_RANK: Record<TasksDigestPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};

const GROUP_LABELS: Record<TasksDigestGroupKey, string> = {
  overdue: 'Просрочено',
  due_today: 'Срок сегодня',
  in_progress: 'В работе',
  backlog: 'Запланировано',
};

const GROUP_ORDER: TasksDigestGroupKey[] = ['overdue', 'due_today', 'in_progress', 'backlog'];

const DIGEST_TITLE = 'Ваши задачи на сегодня';
const DIGEST_ACTION_URL = '/tasks';

function resolveMskBounds(now: Date): { dateMsk: string; startOfTodayMskUtc: Date; startOfTomorrowMskUtc: Date } {
  const dateMsk = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(now);
  const parts = dateMsk.split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  const startOfTodayMskUtc = new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - 3 * 3600_000);
  const startOfTomorrowMskUtc = new Date(startOfTodayMskUtc.getTime() + 24 * 3600_000);
  return { dateMsk, startOfTodayMskUtc, startOfTomorrowMskUtc };
}

function classifyGroup(row: OpenIssueRow, startOfTodayMskUtc: Date, startOfTomorrowMskUtc: Date): TasksDigestGroupKey {
  if (row.dueDate !== null && row.dueDate < startOfTodayMskUtc) {
    return 'overdue';
  }
  if (row.dueDate !== null && row.dueDate >= startOfTodayMskUtc && row.dueDate < startOfTomorrowMskUtc) {
    return 'due_today';
  }
  if (row.stateCategory === 'started') {
    return 'in_progress';
  }
  return 'backlog';
}

function compareRows(a: OpenIssueRow, b: OpenIssueRow): number {
  const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (byPriority !== 0) {
    return byPriority;
  }
  const aDue = a.dueDate === null ? Number.POSITIVE_INFINITY : a.dueDate.getTime();
  const bDue = b.dueDate === null ? Number.POSITIVE_INFINITY : b.dueDate.getTime();
  if (aDue !== bDue) {
    return aDue - bDue;
  }
  if (a.identifier < b.identifier) {
    return -1;
  }
  if (a.identifier > b.identifier) {
    return 1;
  }
  return 0;
}

function toItem(row: OpenIssueRow): TasksDailyOpenItem {
  return {
    issueId: row.issueId,
    identifier: row.identifier,
    title: row.title,
    dueDate: row.dueDate ? row.dueDate.toISOString() : null,
    priority: row.priority,
    actionUrl: `/issues/${row.issueId}`,
  };
}

export function buildTasksDailyOpenPayload(args: {
  openIssues: OpenIssueRow[];
  now: Date;
  maxItemsTotal: number;
}): TasksDailyOpenPayload {
  const { openIssues, now, maxItemsTotal } = args;
  const { dateMsk, startOfTodayMskUtc, startOfTomorrowMskUtc } = resolveMskBounds(now);
  const total = openIssues.length;

  if (total === 0) {
    return {
      dateMsk,
      isEmpty: true,
      total: 0,
      shownCount: 0,
      overflowCount: 0,
      title: DIGEST_TITLE,
      actionUrl: DIGEST_ACTION_URL,
      groups: [],
    };
  }

  const buckets: Record<TasksDigestGroupKey, OpenIssueRow[]> = {
    overdue: [],
    due_today: [],
    in_progress: [],
    backlog: [],
  };

  for (const row of openIssues) {
    buckets[classifyGroup(row, startOfTodayMskUtc, startOfTomorrowMskUtc)].push(row);
  }

  for (const key of GROUP_ORDER) {
    buckets[key].sort(compareRows);
  }

  const ordered: Array<{ key: TasksDigestGroupKey; row: OpenIssueRow }> = [];
  for (const key of GROUP_ORDER) {
    for (const row of buckets[key]) {
      ordered.push({ key, row });
    }
  }

  const shownCount = Math.min(total, maxItemsTotal);
  const overflowCount = total - shownCount;
  const shown = ordered.slice(0, shownCount);

  const groups: TasksDailyOpenGroup[] = [];
  for (const key of GROUP_ORDER) {
    const items = shown.filter((entry) => entry.key === key).map((entry) => toItem(entry.row));
    if (items.length > 0) {
      groups.push({ key, label: GROUP_LABELS[key], items });
    }
  }

  return {
    dateMsk,
    isEmpty: false,
    total,
    shownCount,
    overflowCount,
    title: DIGEST_TITLE,
    actionUrl: DIGEST_ACTION_URL,
    groups,
  };
}

export function groupOpenIssuesByUser(rows: Array<{ userId: string } & OpenIssueRow>): Map<string, OpenIssueRow[]> {
  const byUser = new Map<string, OpenIssueRow[]>();
  for (const row of rows) {
    const { userId, ...rest } = row;
    const list = byUser.get(userId);
    if (list) {
      list.push(rest);
    } else {
      byUser.set(userId, [rest]);
    }
  }
  return byUser;
}

@Injectable()
export class MorningTasksDigestService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listActiveMemberUserIds(tenantId: string): Promise<string[]> {
    const rows = await this.prisma.membership.findMany({
      where: { orgId: tenantId, user: { deletedAt: null } },
      select: { userId: true },
    });
    return [...new Set(rows.map((row) => row.userId))];
  }

  async listOpenAssignedIssues(tenantId: string): Promise<Array<{ userId: string } & OpenIssueRow>> {
    const rows = await this.prisma.issueAssignee.findMany({
      where: {
        issue: {
          tenantId,
          deletedAt: null,
          OR: [{ stateId: null }, { state: { category: { notIn: ['completed', 'cancelled'] } } }],
        },
      },
      select: {
        userId: true,
        issue: {
          select: {
            id: true,
            identifier: true,
            title: true,
            dueDate: true,
            priority: true,
            state: { select: { category: true } },
          },
        },
      },
    });

    return rows.map((row) => ({
      userId: row.userId,
      issueId: row.issue.id,
      identifier: row.issue.identifier,
      title: row.issue.title,
      dueDate: row.issue.dueDate,
      priority: row.issue.priority as TasksDigestPriority,
      stateCategory: row.issue.state?.category ?? null,
    }));
  }
}
