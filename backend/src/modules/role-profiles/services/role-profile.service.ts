import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, type RoleProfileStatus } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import {
  buildRoleProfilePrompt,
  ROLE_PROFILE_JSON_SCHEMA,
  RoleProfileSchema,
  type RoleProfileSummary,
} from '../../knowledge-core/prompts/role-profile-build.prompt';

import { RoleProfileContextBuilder } from './context-builder.service';

@Injectable()
export class RoleProfileService {
  private readonly logger = new Logger(RoleProfileService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(RoleProfileContextBuilder)
    private readonly ctx: RoleProfileContextBuilder,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  get minBlocks(): number {
    const raw = this.cfg.resolveSync<number>('roleProfiles.minBlocks', 'ROLE_PROFILE_MIN_BLOCKS', 5);
    return Number.isFinite(raw) && raw > 0 ? raw : 5;
  }

  async build(params: {
    tenantId: string;
    roleId: string;
    triggerReason: 'cron' | 'on-demand' | 'stale-detected';
  }): Promise<{
    status: 'built' | 'skipped' | 'failed';
    skipReason?: 'below_threshold' | 'role_not_found' | 'no_profile';
    blocksCount?: number;
    durationMs?: number;
  }> {
    const start = Date.now();
    const { tenantId, roleId } = params;

    const profile = await this.prisma.roleProfile.findUnique({
      where: { roleId },
    });
    if (!profile || profile.tenantId !== tenantId) {
      this.logger.warn({ tenantId, roleId }, 'role-profile.build: RoleProfile not found — skip');
      return { status: 'skipped', skipReason: 'no_profile' };
    }

    const blocksCount = await this.prisma.ideaBlock.count({
      where: {
        tenantId,
        roleId,
        roleRelevant: true,
        status: { in: ['canonical', 'draft'] },
      },
    });
    if (blocksCount < this.minBlocks) {
      await this.prisma.roleProfile.update({
        where: { id: profile.id },
        data: { status: 'forming' },
      });
      this.logger.log(
        { tenantId, roleId, blocksCount, minBlocks: this.minBlocks },
        'role-profile.build: below threshold — оставляем forming',
      );
      return {
        status: 'skipped',
        skipReason: 'below_threshold',
        blocksCount,
      };
    }

    const context = await this.ctx.buildContext({ tenantId, roleId });

    const prompt = buildRoleProfilePrompt(context);
    let parsed: RoleProfileSummary;
    try {
      const result = await this.llm.call({
        tenantId,
        taskType: 'role-profile-build',
        systemPrompt: prompt.system,
        userMessage: prompt.user,
        responseFormat: {
          type: 'json_schema',
          name: 'role_profile_v1',
          schema: ROLE_PROFILE_JSON_SCHEMA,
          strict: true,
        },
        dataClass: 'sensitive',
        sourceRef: { type: 'role-profile', id: roleId },
        maxTokens: 16_000,
      });
      const raw = JSON.parse(result.text) as unknown;
      parsed = RoleProfileSchema.parse(raw);
    } catch (err) {
      this.logger.error(
        {
          tenantId,
          roleId,
          err: err instanceof Error ? err.message : String(err),
        },
        'role-profile.build: LLM/parse error',
      );
      await this.prisma.roleProfile.update({
        where: { id: profile.id },
        data: { status: 'error' as RoleProfileStatus },
      });
      return { status: 'failed' };
    }

    await this.prisma.roleProfile.update({
      where: { id: profile.id },
      data: {
        summaryCache: parsed as unknown as Prisma.InputJsonValue,
        status: 'ready',
        lastBuildAt: new Date(),
        buildVersion: { increment: 1 },
      },
    });

    return {
      status: 'built',
      blocksCount,
      durationMs: Date.now() - start,
    };
  }

  async markStaleProfiles(): Promise<{ marked: number }> {
    const profiles = await this.prisma.roleProfile.findMany({
      where: { status: 'ready' },
      select: { id: true, tenantId: true, roleId: true, lastBuildAt: true },
    });

    let marked = 0;
    for (const p of profiles) {
      if (!p.lastBuildAt) continue;
      const newCount = await this.prisma.ideaBlock.count({
        where: {
          tenantId: p.tenantId,
          roleId: p.roleId,
          roleRelevant: true,
          createdAt: { gt: p.lastBuildAt },
        },
      });
      if (newCount > 0) {
        await this.prisma.roleProfile.update({
          where: { id: p.id },
          data: { status: 'stale' },
        });
        marked += 1;
      }
    }
    return { marked };
  }
}
