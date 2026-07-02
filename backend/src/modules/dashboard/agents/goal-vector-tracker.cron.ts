import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import {
  GOAL_VECTOR_TRACKER_JSON_SCHEMA,
  GOAL_VECTOR_TRACKER_SYSTEM_PROMPT,
  buildGoalVectorTrackerUserMessage,
  parseGoalVectorTrackerResponse,
  type GoalVectorArtefact,
} from '../prompts/goal-vector-tracker.prompt';

@Injectable()
export class GoalVectorTrackerCron {
  private readonly logger = new Logger(GoalVectorTrackerCron.name);
  private static readonly WEEK_MS = 7 * 24 * 3600 * 1000;
  private static readonly MAX_ORGS_PER_RUN = 5_000;
  private static readonly MAX_ARTEFACTS_PER_GOAL = 100;
  private static readonly TEXT_TRUNCATE = 280;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  @Cron('0 5 * * 1', { timeZone: 'Europe/Moscow' })
  async run(): Promise<void> {
    try {
      const stats = await this.runOnce();
      this.logger.debug(stats, 'goal-vector-tracker.cron: проход завершён');
    } catch (err) {
      this.logger.error(
        `goal-vector-tracker.cron fail: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async runOnce(): Promise<{
    orgsProcessed: number;
    goalsProcessed: number;
    contributionsUpserted: number;
    parseErrors: number;
    errors: number;
  }> {
    const now = new Date();
    const weekStart = computeWeekStart(now);
    const weekEnd = new Date(weekStart.getTime() + GoalVectorTrackerCron.WEEK_MS);

    const maxOrgs = await this.cfg.getDynamic<number>(
      'goals.vectorMaxOrgsPerRun',
      undefined,
      GoalVectorTrackerCron.MAX_ORGS_PER_RUN,
    );
    const maxArtefacts = await this.cfg.getDynamic<number>(
      'goals.vectorMaxArtefactsPerGoal',
      undefined,
      GoalVectorTrackerCron.MAX_ARTEFACTS_PER_GOAL,
    );

    const orgs = await this.prisma.org.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      take: maxOrgs,
    });

    let orgsProcessed = 0;
    let goalsProcessed = 0;
    let contributionsUpserted = 0;
    let parseErrors = 0;
    let errors = 0;

    for (const org of orgs) {
      orgsProcessed++;
      try {
        const goals = await this.prisma.goal.findMany({
          where: {
            tenantId: org.id,
            status: 'active',
            archivedAt: null,
          },
          select: { id: true, name: true, description: true },
        });
        for (const goal of goals) {
          goalsProcessed++;
          try {
            const stats = await this.processGoal({
              tenantId: org.id,
              tenantName: org.name,
              goalId: goal.id,
              goalTitle: goal.name,
              goalDescription: goal.description,
              weekStart,
              weekEnd,
              maxArtefacts,
            });
            contributionsUpserted += stats.contributionsUpserted;
            parseErrors += stats.parseErrors;
          } catch (err) {
            errors++;
            this.logger.warn(
              `goal-vector-tracker org=${org.id} goal=${goal.id}: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        }
      } catch (err) {
        errors++;
        this.logger.warn(
          `goal-vector-tracker org ${org.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return {
      orgsProcessed,
      goalsProcessed,
      contributionsUpserted,
      parseErrors,
      errors,
    };
  }

  private async processGoal(args: {
    tenantId: string;
    tenantName: string;
    goalId: string;
    goalTitle: string;
    goalDescription: string;
    weekStart: Date;
    weekEnd: Date;
    maxArtefacts: number;
  }): Promise<{ contributionsUpserted: number; parseErrors: number }> {
    const artefacts = await this.collectArtefacts(args);
    if (artefacts.length === 0) {
      return { contributionsUpserted: 0, parseErrors: 0 };
    }

    const llmResult = await this.llm.call({
      taskType: 'goal-vector-tracker',
      tenantId: args.tenantId,
      systemPrompt: GOAL_VECTOR_TRACKER_SYSTEM_PROMPT,
      userMessage: buildGoalVectorTrackerUserMessage({
        goalTitle: args.goalTitle,
        goalDescription: args.goalDescription,
        weekStart: isoDate(args.weekStart),
        artefacts,
      }),
      maxTokens: 1_800,
      responseFormat: {
        type: 'json_schema',
        name: 'GoalVectorTracker',
        schema: GOAL_VECTOR_TRACKER_JSON_SCHEMA,
        strict: true,
      },
      sourceRef: { type: 'goal-vector-tracker', id: args.goalId },
    });

    const parsed = parseGoalVectorTrackerResponse(llmResult.text);
    if (!parsed) {
      this.logger.warn(
        `goal-vector-tracker goal=${args.goalId}: парсер не разобрал ответ модели (${llmResult.modelUsed})`,
      );
      return { contributionsUpserted: 0, parseErrors: 1 };
    }

    let upserted = 0;
    for (const p of parsed.persons) {
      await this.prisma.personGoalContribution.upsert({
        where: {
          tenantId_personId_goalId_weekStart: {
            tenantId: args.tenantId,
            personId: p.personId,
            goalId: args.goalId,
            weekStart: args.weekStart,
          },
        },
        create: {
          tenantId: args.tenantId,
          personId: p.personId,
          goalId: args.goalId,
          weekStart: args.weekStart,
          proScore: new Prisma.Decimal(round3(p.proScore)),
          contraScore: new Prisma.Decimal(round3(p.contraScore)),
          netScore: new Prisma.Decimal(round3(p.netScore)),
          signalsJson: {
            signals: p.signals,
            modelName: llmResult.modelUsed,
          } as unknown as Prisma.InputJsonValue,
        },
        update: {
          proScore: new Prisma.Decimal(round3(p.proScore)),
          contraScore: new Prisma.Decimal(round3(p.contraScore)),
          netScore: new Prisma.Decimal(round3(p.netScore)),
          signalsJson: {
            signals: p.signals,
            modelName: llmResult.modelUsed,
          } as unknown as Prisma.InputJsonValue,
          snapshotAt: new Date(),
        },
      });
      upserted++;
    }
    return { contributionsUpserted: upserted, parseErrors: 0 };
  }

  private async collectArtefacts(args: {
    tenantId: string;
    weekStart: Date;
    weekEnd: Date;
    maxArtefacts: number;
  }): Promise<GoalVectorArtefact[]> {
    const out: GoalVectorArtefact[] = [];

    const ideas = await this.prisma.ideaBlock.findMany({
      where: {
        tenantId: args.tenantId,
        signalType: 'idea',
        createdAt: { gte: args.weekStart, lt: args.weekEnd },
      },
      select: {
        id: true,
        name: true,
        entities: {
          where: { entity: { type: 'person' } },
          select: {
            role: true,
            entity: {
              select: {
                persons: {
                  where: { deletedAt: null },
                  select: { id: true, name: true },
                  take: 1,
                },
              },
            },
          },
        },
      },
      take: args.maxArtefacts,
      orderBy: { createdAt: 'desc' },
    });
    for (const b of ideas) {
      const author = pickAuthor(b.entities);
      if (!author) continue;
      out.push({
        personId: author.personId,
        personName: author.name,
        kind: 'idea',
        refId: b.id,
        text: truncate(b.name, GoalVectorTrackerCron.TEXT_TRUNCATE),
      });
    }

    const issues = await this.prisma.issue.findMany({
      where: {
        tenantId: args.tenantId,
        completedAt: { gte: args.weekStart, lt: args.weekEnd },
        deletedAt: null,
      },
      select: {
        id: true,
        title: true,
        assignees: {
          select: { userId: true },
        },
      },
      take: args.maxArtefacts,
      orderBy: { completedAt: 'desc' },
    });
    if (issues.length > 0) {
      const userIds = new Set<string>();
      for (const i of issues) {
        for (const a of i.assignees) userIds.add(a.userId);
      }
      const persons = await this.prisma.person.findMany({
        where: {
          tenantId: args.tenantId,
          userId: { in: [...userIds] },
          deletedAt: null,
        },
        select: { id: true, name: true, userId: true },
      });
      const personByUser = new Map<string, { id: string; name: string }>();
      for (const p of persons) {
        if (p.userId) personByUser.set(p.userId, { id: p.id, name: p.name });
      }
      for (const i of issues) {
        for (const a of i.assignees) {
          const person = personByUser.get(a.userId);
          if (!person) continue;
          out.push({
            personId: person.id,
            personName: person.name,
            kind: 'issue_closed',
            refId: i.id,
            text: truncate(i.title, GoalVectorTrackerCron.TEXT_TRUNCATE),
          });
        }
      }
    }

    if (out.length > args.maxArtefacts) {
      return out.slice(0, args.maxArtefacts);
    }
    return out;
  }
}

export function computeWeekStart(now: Date): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayOfWeek = d.getUTCDay();
  const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  d.setUTCDate(d.getUTCDate() - diff);
  return d;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1)}…`;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function pickAuthor(
  entities: Array<{
    role: string | null;
    entity: { persons: Array<{ id: string; name: string }> } | null;
  }>,
): { personId: string; name: string } | null {
  if (!entities || entities.length === 0) return null;
  const subjects = entities.filter((e) => e.role === 'subject');
  const pool = subjects.length > 0 ? subjects : entities;
  for (const e of pool) {
    const p = e.entity?.persons?.[0];
    if (p) return { personId: p.id, name: p.name };
  }
  return null;
}
