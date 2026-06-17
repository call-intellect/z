import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';

import { CommitmentReliabilityService } from './commitment-reliability.service';

export interface TeamDetailMemberDto {
  personId: string;
  personName: string;
  email: string;
  isHead: boolean;
  sentiment: 'green' | 'yellow' | 'red' | null;
  sentimentCheckInsCount: number;
}

export interface TeamDetailGoalDto {
  goalId: string;
  name: string;
  status: string;
  ownerPersonId: string | null;
  ownerPersonName: string | null;
}

export interface TeamDetailThemeDto {
  themeId: string;
  themeName: string;
  blocksCount: number;
}

export interface TeamDetailDto {
  departmentId: string;
  departmentName: string;
  missionStatement: string | null;
  headPersonId: string | null;
  headPersonName: string | null;
  totalMembers: number;
  members: TeamDetailMemberDto[];

  sentimentIndex: number;
  sentimentTrend: 'up' | 'flat' | 'down';
  commitmentReliabilityPercent: number;
  commitmentDelta14d: number | null;

  goals: TeamDetailGoalDto[];
  topThemes: TeamDetailThemeDto[];
}

@Injectable()
export class TeamDetailService {
  private readonly logger = new Logger(TeamDetailService.name);
  private static readonly CACHE_TTL_SEC = 300;
  private static readonly TREND_THRESHOLD = 5;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(CommitmentReliabilityService)
    private readonly commits: CommitmentReliabilityService,
  ) {}

  async getDetail(args: { tenantId: string; departmentId: string }): Promise<TeamDetailDto> {
    const cacheKey = `team_detail:${args.tenantId}:${args.departmentId}`;
    try {
      const cached = await this.redis.client.get(cacheKey);
      if (cached) return JSON.parse(cached) as TeamDetailDto;
    } catch (err) {
      this.logger.warn(
        `Redis get failed for ${cacheKey}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const dept = await this.prisma.department.findFirst({
      where: {
        id: args.departmentId,
        tenantId: args.tenantId,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        missionStatement: true,
        headPersonId: true,
        persons: {
          where: { deletedAt: null },
          select: {
            id: true,
            name: true,
            email: true,
            entityId: true,
          },
        },
      },
    });
    if (!dept) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'department_not_found', message: 'Отдел не найден' },
      });
    }

    const personIds = dept.persons.map((p) => p.id);
    const entityIds = dept.persons.map((p) => p.entityId).filter((id): id is string => !!id);
    const headPerson = dept.persons.find((p) => p.id === dept.headPersonId);

    const now = new Date();
    const since30d = new Date(now);
    since30d.setUTCDate(since30d.getUTCDate() - 30);
    const since14d = new Date(now);
    since14d.setUTCDate(since14d.getUTCDate() - 14);
    const since7d = new Date(now);
    since7d.setUTCDate(since7d.getUTCDate() - 7);

    const checkIns =
      personIds.length === 0
        ? []
        : await this.prisma.dailyCheckIn.findMany({
            where: {
              tenantId: args.tenantId,
              personId: { in: personIds },
              sentiment: { in: ['green', 'yellow', 'red'] },
              createdAt: { gte: since30d },
            },
            select: {
              personId: true,
              sentiment: true,
              createdAt: true,
            },
          });

    const sortedCheckIns = [...checkIns].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );

    const personSentiment = new Map<string, { last: string | null; count: number }>();
    for (const p of dept.persons) {
      personSentiment.set(p.id, { last: null, count: 0 });
    }
    for (const c of sortedCheckIns) {
      const ps = personSentiment.get(c.personId);
      if (!ps) continue;
      if (ps.last === null && c.sentiment) ps.last = c.sentiment;
      ps.count += 1;
    }

    const members: TeamDetailMemberDto[] = dept.persons.map((p) => {
      const ps = personSentiment.get(p.id);
      const last = ps?.last ?? null;
      const sentiment: TeamDetailMemberDto['sentiment'] =
        last === 'green' || last === 'yellow' || last === 'red' ? last : null;
      return {
        personId: p.id,
        personName: p.name,
        email: p.email,
        isHead: p.id === dept.headPersonId,
        sentiment,
        sentimentCheckInsCount: ps?.count ?? 0,
      };
    });

    const recent = checkIns.filter((c) => c.createdAt >= since7d);
    const greens7 = recent.filter((c) => c.sentiment === 'green').length;
    const reds7 = recent.filter((c) => c.sentiment === 'red').length;
    const total7 = recent.length;
    const sentimentIndex = total7 > 0 ? Math.round(((greens7 - reds7) / total7) * 100) : 0;

    const prev = checkIns.filter((c) => c.createdAt >= since14d && c.createdAt < since7d);
    const prevGreens = prev.filter((c) => c.sentiment === 'green').length;
    const prevReds = prev.filter((c) => c.sentiment === 'red').length;
    const prevTotal = prev.length;
    let sentimentTrend: 'up' | 'flat' | 'down' = 'flat';
    if (prevTotal > 0) {
      const prevIdx = Math.round(((prevGreens - prevReds) / prevTotal) * 100);
      const delta = sentimentIndex - prevIdx;
      if (delta > TeamDetailService.TREND_THRESHOLD) sentimentTrend = 'up';
      else if (delta < -TeamDetailService.TREND_THRESHOLD) sentimentTrend = 'down';
    }

    const commitRes = await this.commits.getReliability({
      tenantId: args.tenantId,
      scope: 'team',
      scopeId: args.departmentId,
    });

    const goalRows =
      personIds.length === 0
        ? []
        : await this.prisma.goal.findMany({
            where: {
              tenantId: args.tenantId,
              ownerPersonId: { in: personIds },
              promotionState: 'active',
              archivedAt: null,
            },
            select: {
              id: true,
              name: true,
              status: true,
              ownerPersonId: true,
              ownerPerson: { select: { name: true } },
            },
          });
    const goalsDto: TeamDetailGoalDto[] = goalRows.map((g) => ({
      goalId: g.id,
      name: g.name,
      status: g.status,
      ownerPersonId: g.ownerPersonId,
      ownerPersonName: g.ownerPerson?.name ?? null,
    }));

    const topThemes: TeamDetailThemeDto[] = [];
    if (entityIds.length > 0) {
      const blocks = await this.prisma.ideaBlock.findMany({
        where: {
          tenantId: args.tenantId,
          createdAt: { gte: since30d },
          entities: {
            some: {
              entityId: { in: entityIds },
              entity: { type: 'person' },
            },
          },
        },
        select: {
          themes: {
            select: {
              theme: { select: { id: true, name: true } },
            },
          },
        },
        take: 500,
      });
      const themeCounts = new Map<string, { name: string; count: number }>();
      for (const b of blocks) {
        for (const tb of b.themes) {
          const t = tb.theme;
          const ex = themeCounts.get(t.id);
          if (ex) ex.count += 1;
          else themeCounts.set(t.id, { name: t.name, count: 1 });
        }
      }
      for (const [id, v] of themeCounts.entries()) {
        topThemes.push({
          themeId: id,
          themeName: v.name,
          blocksCount: v.count,
        });
      }
      topThemes.sort((a, b) => b.blocksCount - a.blocksCount);
      topThemes.splice(5);
    }

    const result: TeamDetailDto = {
      departmentId: dept.id,
      departmentName: dept.name,
      missionStatement: dept.missionStatement,
      headPersonId: dept.headPersonId,
      headPersonName: headPerson?.name ?? null,
      totalMembers: dept.persons.length,
      members,
      sentimentIndex,
      sentimentTrend,
      commitmentReliabilityPercent: commitRes.reliabilityPercent,
      commitmentDelta14d: commitRes.delta14d,
      goals: goalsDto,
      topThemes,
    };

    try {
      await this.redis.client.set(
        cacheKey,
        JSON.stringify(result),
        'EX',
        TeamDetailService.CACHE_TTL_SEC,
      );
    } catch (err) {
      this.logger.warn(
        `Redis set failed for ${cacheKey}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return result;
  }
}
