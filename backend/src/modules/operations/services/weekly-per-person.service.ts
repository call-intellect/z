import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import type {
  WeeklyPerPersonDto,
  WeeklyPersonItemDto,
  WeeklyPersonItemFactStatus,
  WeeklyPersonItemsDto,
  WeeklyPersonRowDto,
} from '../dto/weekly-per-person.dto';

const CACHE_TTL_SECONDS = 5 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const TOP_N = 5;

interface CommitmentRow {
  id: string;
  commitmentAuthorPersonId: string | null;
}

interface PersonAcc {
  personId: string;
  personName: string;
  departmentId: string | null;
  userId: string | null;
  tasksDone: number;
  tasksPlanned: number;
  tasksPlannedDone: number;
  countedDoneIssueIds: Set<string>;
  countedCycleIssueIds: Set<string>;
  checkInsCompleted: number;
  countedCommitmentBlockIds: Set<string>;
}

export interface WeeklyPerPersonArgs {
  tenantId: string;
  weekStart: string;
  weekEnd?: string;
  limit: number;
  offset: number;
  sort: 'risk';
}

export interface WeeklyPersonWeekItemsArgs {
  tenantId: string;
  personId: string;
  weekStart: string;
  weekEnd?: string;
}

interface CheckInRow {
  plansJson: unknown;
  donesJson: unknown;
  blockersJson: unknown;
}

interface CheckInTextItem {
  text?: unknown;
}

@Injectable()
export class WeeklyPerPersonService {
  private readonly logger = new Logger(WeeklyPerPersonService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  async compute(args: WeeklyPerPersonArgs, now: Date): Promise<WeeklyPerPersonDto> {
    const { tenantId, weekStart, limit, offset, sort } = args;

    const weekStartDate = new Date(`${weekStart}T00:00:00.000Z`);
    let weekEndDate: Date;
    let weekEndStr: string;
    if (args.weekEnd) {
      weekEndDate = new Date(`${args.weekEnd}T00:00:00.000Z`);
      weekEndDate.setUTCHours(23, 59, 59, 999);
      weekEndStr = args.weekEnd;
    } else {
      weekEndDate = new Date(weekStartDate.getTime() + 6 * DAY_MS);
      weekEndDate.setUTCHours(23, 59, 59, 999);
      weekEndStr = this.formatDate(weekEndDate);
    }

    const cacheKey = `weekly_per_person:${tenantId}:${weekStart}:${weekEndStr}:${sort}:${limit}:${offset}`;
    const cached = await this.tryReadCache(cacheKey);
    if (cached) {
      return cached;
    }

    const dto = await this.computeFromDb(
      tenantId,
      weekStart,
      weekStartDate,
      weekEndDate,
      weekEndStr,
      limit,
      offset,
      now,
    );

    await this.tryWriteCache(cacheKey, dto);
    return dto;
  }

  async getPersonWeekItems(
    args: WeeklyPersonWeekItemsArgs,
    now: Date,
  ): Promise<WeeklyPersonItemsDto> {
    const { tenantId, personId, weekStart } = args;

    const weekStartDate = new Date(`${weekStart}T00:00:00.000Z`);
    let weekEndDate: Date;
    let weekEndStr: string;
    if (args.weekEnd) {
      weekEndDate = new Date(`${args.weekEnd}T00:00:00.000Z`);
      weekEndDate.setUTCHours(23, 59, 59, 999);
      weekEndStr = args.weekEnd;
    } else {
      weekEndDate = new Date(weekStartDate.getTime() + 6 * DAY_MS);
      weekEndDate.setUTCHours(23, 59, 59, 999);
      weekEndStr = this.formatDate(weekEndDate);
    }
    const nowMs = now.getTime();

    const person = await this.prisma.person.findFirst({
      where: { tenantId, id: personId },
      select: { userId: true },
    });

    const [taskRows, checkInRows] = await Promise.all([
      person?.userId
        ? this.prisma.issue.findMany({
            where: {
              tenantId,
              assignees: { some: { userId: person.userId } },
              dueDate: { gte: weekStartDate, lte: weekEndDate },
              deletedAt: null,
              archivedAt: null,
            },
            select: { title: true, completedAt: true, dueDate: true },
          })
        : Promise.resolve(
            [] as Array<{
              title: string;
              completedAt: Date | null;
              dueDate: Date | null;
            }>,
          ),
      this.prisma.dailyCheckIn.findMany({
        where: {
          tenantId,
          personId,
          completedAt: { not: null, gte: weekStartDate, lte: weekEndDate },
        },
        select: { plansJson: true, donesJson: true, blockersJson: true },
      }) as Promise<CheckInRow[]>,
    ]);

    const weekBlockers = this.collectBlockerTexts(checkInRows);
    const nearestBlocker = weekBlockers.length > 0 ? weekBlockers[0]! : null;

    const items: WeeklyPersonItemDto[] = [];

    for (const t of taskRows) {
      const dueMs = t.dueDate?.getTime();
      const factStatus = this.taskFactStatus(t.completedAt !== null, dueMs, nowMs);
      items.push({
        kind: 'task',
        title: t.title,
        plannedDue: t.dueDate ? t.dueDate.toISOString() : null,
        factStatus,
        blockedBy: factStatus === 'overdue' ? nearestBlocker : null,
      });
    }

    const doneTexts = new Set<string>();
    for (const row of checkInRows) {
      for (const text of this.extractTexts(row.donesJson)) {
        doneTexts.add(this.normalizeText(text));
      }
    }
    for (const row of checkInRows) {
      for (const text of this.extractTexts(row.plansJson)) {
        const done = doneTexts.has(this.normalizeText(text));
        items.push({
          kind: 'checkin',
          title: text,
          plannedDue: null,
          factStatus: done ? 'done' : 'planned',
          blockedBy: done ? null : nearestBlocker,
        });
      }
    }

    return { personId, weekStart, weekEnd: weekEndStr, items };
  }

  private taskFactStatus(
    done: boolean,
    dueMs: number | undefined,
    nowMs: number,
  ): WeeklyPersonItemFactStatus {
    if (done) return 'done';
    if (dueMs !== undefined && dueMs < nowMs) return 'overdue';
    return 'open';
  }

  private extractTexts(json: unknown): string[] {
    if (!Array.isArray(json)) return [];
    const out: string[] = [];
    for (const item of json as CheckInTextItem[]) {
      const text = item?.text;
      if (typeof text === 'string' && text.trim().length > 0) {
        out.push(text.trim());
      }
    }
    return out;
  }

  private collectBlockerTexts(rows: CheckInRow[]): string[] {
    const out: string[] = [];
    for (const row of rows) {
      out.push(...this.extractTexts(row.blockersJson));
    }
    return out;
  }

  private normalizeText(s: string): string {
    return s.trim().toLowerCase();
  }

  private async computeFromDb(
    tenantId: string,
    weekStart: string,
    weekStartDate: Date,
    weekEndDate: Date,
    weekEndStr: string,
    limit: number,
    offset: number,
    now: Date,
  ): Promise<WeeklyPerPersonDto> {
    const commitmentRows = (await this.prisma.ideaBlock.findMany({
      where: {
        tenantId,
        signalType: 'commitment',
        commitmentDueDate: { gte: weekStartDate, lte: weekEndDate },
      },
      select: {
        id: true,
        commitmentAuthorPersonId: true,
      },
    })) as CommitmentRow[];

    const accByPerson = new Map<string, PersonAcc>();

    for (const row of commitmentRows) {
      const personId = row.commitmentAuthorPersonId;
      if (!personId) continue;
      const acc = this.ensureAcc(accByPerson, personId);
      acc.countedCommitmentBlockIds.add(row.id);
    }

    const authorPersonIds = [...accByPerson.keys()];

    if (authorPersonIds.length > 0) {
      const persons = await this.prisma.person.findMany({
        where: { tenantId, id: { in: authorPersonIds } },
        select: { id: true, name: true, userId: true, primaryDepartmentId: true },
      });
      for (const p of persons) {
        const acc = accByPerson.get(p.id);
        if (!acc) continue;
        acc.personName = p.name;
        acc.userId = p.userId ?? null;
        acc.departmentId = p.primaryDepartmentId ?? null;
      }
    }

    const userIdToPersonId = new Map<string, string>();
    for (const acc of accByPerson.values()) {
      if (acc.userId) userIdToPersonId.set(acc.userId, acc.personId);
    }
    const authorUserIds = [...userIdToPersonId.keys()];
    if (authorUserIds.length > 0) {
      const authorUserIdSet = new Set(authorUserIds);

      const doneIssues = await this.prisma.issue.findMany({
        where: {
          tenantId,
          completedAt: { not: null, gte: weekStartDate, lte: weekEndDate },
          assignees: { some: { userId: { in: authorUserIds } } },
          deletedAt: null,
          archivedAt: null,
        },
        select: {
          id: true,
          sourceBlockIds: true,
          assignees: { select: { userId: true } },
        },
      });
      for (const issue of doneIssues) {
        for (const a of issue.assignees) {
          if (!authorUserIdSet.has(a.userId)) continue;
          const personId = userIdToPersonId.get(a.userId);
          if (!personId) continue;
          const acc = accByPerson.get(personId);
          if (!acc) continue;
          if (acc.countedDoneIssueIds.has(issue.id)) continue;
          acc.countedDoneIssueIds.add(issue.id);
          if (this.taskFromCountedCommitment(issue.sourceBlockIds, acc)) continue;
          acc.tasksDone += 1;
        }
      }

      const plannedIssues = await this.prisma.issue.findMany({
        where: {
          tenantId,
          assignees: { some: { userId: { in: authorUserIds } } },
          dueDate: { gte: weekStartDate, lte: weekEndDate },
          deletedAt: null,
          archivedAt: null,
        },
        select: {
          id: true,
          completedAt: true,
          assignees: { select: { userId: true } },
        },
      });
      for (const issue of plannedIssues) {
        const isDone = issue.completedAt !== null;
        for (const a of issue.assignees) {
          if (!authorUserIdSet.has(a.userId)) continue;
          const personId = userIdToPersonId.get(a.userId);
          if (!personId) continue;
          const acc = accByPerson.get(personId);
          if (!acc) continue;
          if (acc.countedCycleIssueIds.has(issue.id)) continue;
          acc.countedCycleIssueIds.add(issue.id);
          acc.tasksPlanned += 1;
          if (isDone) acc.tasksPlannedDone += 1;
        }
      }

      await this.addCycleIssuesToPlan(
        tenantId,
        weekStartDate,
        weekEndDate,
        authorUserIds,
        userIdToPersonId,
        accByPerson,
      );
    }

    if (authorPersonIds.length > 0) {
      const checkIns = await this.prisma.dailyCheckIn.findMany({
        where: {
          tenantId,
          personId: { in: authorPersonIds },
          completedAt: { not: null, gte: weekStartDate, lte: weekEndDate },
        },
        select: { personId: true },
      });
      for (const c of checkIns) {
        const acc = accByPerson.get(c.personId);
        if (acc) acc.checkInsCompleted += 1;
      }
    }

    const deptNameById = new Map<string, string>();
    const departmentIds = [
      ...new Set(
        [...accByPerson.values()].map((a) => a.departmentId).filter((d): d is string => d !== null),
      ),
    ];
    if (departmentIds.length > 0) {
      const departments = await this.prisma.department.findMany({
        where: { tenantId, id: { in: departmentIds } },
        select: { id: true, name: true },
      });
      for (const d of departments) deptNameById.set(d.id, d.name);
    }

    const goalNetByPersonId = new Map<string, number>();
    if (authorPersonIds.length > 0) {
      try {
        const primaryGoal =
          (await this.prisma.goal.findFirst({
            where: { tenantId, isPrimary: true },
            select: { id: true },
          })) ??
          (await this.prisma.goal.findFirst({
            where: { tenantId, status: 'active' },
            orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
            select: { id: true },
          }));
        const goalId = primaryGoal?.id;
        if (goalId) {
          const contributions = await this.prisma.personGoalContribution.findMany({
            where: {
              tenantId,
              goalId,
              weekStart: {
                gte: new Date(`${weekStart}T00:00:00.000Z`),
                lte: new Date(`${weekEndStr}T00:00:00.000Z`),
              },
              personId: { in: authorPersonIds },
            },
            select: { personId: true, netScore: true },
          });
          for (const c of contributions) {
            goalNetByPersonId.set(
              c.personId,
              (goalNetByPersonId.get(c.personId) ?? 0) + Number(c.netScore),
            );
          }
        }
      } catch (err) {
        this.logger.warn(
          `goalContributionNet lookup failed for ${tenantId}/${weekStart}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const allRows: WeeklyPersonRowDto[] = [...accByPerson.values()].map((acc) =>
      this.buildRow(acc, deptNameById, goalNetByPersonId),
    );
    const total = allRows.length;

    const topRisk = this.sortByRisk([...allRows]).slice(0, TOP_N);

    const sorted = this.sortByRisk([...allRows]);
    const rows = sorted.slice(offset, offset + limit);

    return {
      weekStart,
      weekEnd: weekEndStr,
      generatedAt: now.toISOString(),
      total,
      topRisk,
      rows,
    };
  }

  private ensureAcc(map: Map<string, PersonAcc>, personId: string): PersonAcc {
    let acc = map.get(personId);
    if (!acc) {
      acc = {
        personId,
        personName: '',
        departmentId: null,
        userId: null,
        tasksDone: 0,
        tasksPlanned: 0,
        tasksPlannedDone: 0,
        countedDoneIssueIds: new Set<string>(),
        countedCycleIssueIds: new Set<string>(),
        checkInsCompleted: 0,
        countedCommitmentBlockIds: new Set<string>(),
      };
      map.set(personId, acc);
    }
    return acc;
  }

  private taskFromCountedCommitment(
    sourceBlockIds: string[] | null | undefined,
    acc: PersonAcc,
  ): boolean {
    if (!Array.isArray(sourceBlockIds) || sourceBlockIds.length === 0) {
      return false;
    }
    for (const blockId of sourceBlockIds) {
      if (acc.countedCommitmentBlockIds.has(blockId)) return true;
    }
    return false;
  }

  private async addCycleIssuesToPlan(
    tenantId: string,
    weekStartDate: Date,
    weekEndDate: Date,
    authorUserIds: string[],
    userIdToPersonId: Map<string, string>,
    accByPerson: Map<string, PersonAcc>,
  ): Promise<void> {
    if (authorUserIds.length === 0) return;

    const activeCycles = await this.prisma.cycle.findMany({
      where: {
        tenantId,
        completedAt: null,
        startDate: { lte: weekEndDate },
        endDate: { gte: weekStartDate },
      },
      select: { id: true },
    });
    if (activeCycles.length === 0) return;
    const cycleIds = activeCycles.map((c) => c.id);

    const issues = await this.prisma.issue.findMany({
      where: {
        tenantId,
        cycleId: { in: cycleIds },
        deletedAt: null,
        archivedAt: null,
        assignees: { some: { userId: { in: authorUserIds } } },
      },
      select: {
        id: true,
        completedAt: true,
        assignees: { select: { userId: true } },
      },
    });

    const authorUserIdSet = new Set(authorUserIds);
    for (const issue of issues) {
      const isDone = issue.completedAt !== null;
      for (const a of issue.assignees) {
        if (!authorUserIdSet.has(a.userId)) continue;
        const personId = userIdToPersonId.get(a.userId);
        if (!personId) continue;
        const acc = accByPerson.get(personId);
        if (!acc) continue;
        if (acc.countedCycleIssueIds.has(issue.id)) continue;
        acc.countedCycleIssueIds.add(issue.id);
        acc.tasksPlanned += 1;
        if (isDone) acc.tasksPlannedDone += 1;
      }
    }
  }

  private buildRow(
    acc: PersonAcc,
    deptNameById: Map<string, string>,
    goalNetByPersonId: Map<string, number>,
  ): WeeklyPersonRowDto {
    return {
      personId: acc.personId,
      personName: acc.personName,
      departmentName:
        acc.departmentId !== null ? (deptNameById.get(acc.departmentId) ?? null) : null,
      tasksDone: acc.tasksDone,
      tasksPlanned: acc.tasksPlanned,
      tasksNotDone: Math.max(0, acc.tasksPlanned - acc.tasksPlannedDone),
      checkInsCompleted: acc.checkInsCompleted,
      goalContributionNet: goalNetByPersonId.get(acc.personId) ?? null,
    };
  }

  private sortByRisk(rows: WeeklyPersonRowDto[]): WeeklyPersonRowDto[] {
    return rows.sort((a, b) => {
      const riskA = a.tasksNotDone;
      const riskB = b.tasksNotDone;
      if (riskA !== riskB) return riskB - riskA;
      return b.tasksPlanned - a.tasksPlanned;
    });
  }

  private formatDate(d: Date): string {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  private async tryReadCache(key: string): Promise<WeeklyPerPersonDto | null> {
    try {
      const raw = await this.redis.client.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as WeeklyPerPersonDto;
    } catch (err) {
      this.logger.warn(
        `Redis get failed for ${key}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  private async tryWriteCache(key: string, dto: WeeklyPerPersonDto): Promise<void> {
    try {
      await this.redis.client.set(key, JSON.stringify(dto), 'EX', CACHE_TTL_SECONDS);
    } catch (err) {
      this.logger.warn(
        `Redis set failed for ${key}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
