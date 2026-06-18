import {
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { PromptCandidate, PromptRule, RuleStatus } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { OrgAdminGuard } from '../../auth/guards/org-admin.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import {
  ArchiveRuleBodySchema,
  type ArchiveRuleBody,
  type CandidateStatusDto,
  CopyToManualBodySchema,
  type CopyToManualBody,
  ListPromptCandidatesQuerySchema,
  type ListPromptCandidatesQuery,
  type ListPromptCandidatesResponse,
  ListPromptRulesQuerySchema,
  type ListPromptRulesQuery,
  type ListPromptRulesResponse,
  LockEvolutionBodySchema,
  type LockEvolutionBody,
  OverrideRuleBodySchema,
  type OverrideRuleBody,
  type PromptCandidateDto,
  type PromptRuleDto,
  RejectCandidateBodySchema,
  type RejectCandidateBody,
  RollbackPromptBodySchema,
  type RollbackPromptBody,
} from '../dto/prompt-evolution.dto';

@ApiTags('admin-prompt-evolution')
@Controller('api/v1/admin/prompt-evolution')
@UseGuards(CookieAuthGuard, TenantGuard, OrgAdminGuard)
export class AdminPromptEvolutionController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @Get('rules')
  @ApiOperation({ summary: 'Список AutoRule правил (admin)' })
  async listRules(
    @Query(new ZodValidationPipe(ListPromptRulesQuerySchema))
    q: ListPromptRulesQuery,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ListPromptRulesResponse> {
    const t = tenantId ?? null;
    const where: Record<string, unknown> = {};
    if (q.promptKey) where.promptKey = q.promptKey;
    if (q.status) where.status = q.status;
    if (q.source) where.source = q.source;

    if (q.tenantId === '__global' || q.tenantId === 'null') {
      where.tenantId = null;
    } else if (q.tenantId === '__mine') {
      where.tenantId = t;
    } else if (q.tenantId) {
      where.tenantId = q.tenantId;
    } else {
      where.OR = [{ tenantId: null }, ...(t ? [{ tenantId: t }] : [])];
    }

    const [items, total] = await Promise.all([
      this.prisma.promptRule.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        take: q.limit,
        skip: (q.page - 1) * q.limit,
      }),
      this.prisma.promptRule.count({ where }),
    ]);
    return {
      items: items.map((r) => toDto(r)),
      total,
      page: q.page,
      limit: q.limit,
    };
  }

  @Patch('rules/:id/archive')
  @ApiOperation({ summary: 'Архивировать правило' })
  async archive(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ArchiveRuleBodySchema)) body: ArchiveRuleBody,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<PromptRuleDto> {
    await this.requireOwnedRule(id, tenantId ?? null);
    const updated = await this.prisma.promptRule.update({
      where: { id },
      data: {
        status: 'archived' as RuleStatus,
        archivedAt: new Date(),
        archivedReason: body.archivedReason,
      },
    });
    return toDto(updated);
  }

  @Patch('rules/:id/override')
  @ApiOperation({ summary: 'Заблокировать правило (sticky — autorule больше не предложит)' })
  async override(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(OverrideRuleBodySchema)) _body: OverrideRuleBody,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<PromptRuleDto> {
    const rule = await this.requireOwnedRule(id, tenantId ?? null);
    const updated = await this.prisma.promptRule.update({
      where: { id },
      data: { status: 'overridden_by_admin' as RuleStatus },
    });
    this.metrics.incAutoruleOverridden({ promptKey: rule.promptKey });
    return toDto(updated);
  }

  @Post('rules/:id/copy-to-manual')
  @ApiOperation({ summary: 'Скопировать правило как manual_admin (shadow)' })
  async copyToManual(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CopyToManualBodySchema)) _body: CopyToManualBody,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<PromptRuleDto> {
    const rule = await this.requireOwnedRule(id, tenantId ?? null);
    const created = await this.prisma.promptRule.create({
      data: {
        tenantId: tenantId ?? null,
        promptKey: rule.promptKey,
        rule: rule.rule,
        ruleType: rule.ruleType,
        source: 'manual_admin',
        examples: rule.examples as unknown as object,
        confidence: rule.confidence,
        status: 'shadow' as RuleStatus,
      },
    });
    return toDto(created);
  }

  private async requireOwnedRule(id: string, currentTenantId: string | null): Promise<PromptRule> {
    const rule = await this.prisma.promptRule.findUnique({ where: { id } });
    if (!rule) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'rule_not_found', message: 'Правило не найдено' },
      });
    }
    if (rule.tenantId !== null && rule.tenantId !== currentTenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'rule_not_found', message: 'Правило не найдено' },
      });
    }
    return rule;
  }

  @Get('candidates')
  @ApiOperation({ summary: 'Список PromptCandidate (Pareto frontier + testing + промоутенных)' })
  async listCandidates(
    @Query(new ZodValidationPipe(ListPromptCandidatesQuerySchema))
    q: ListPromptCandidatesQuery,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ListPromptCandidatesResponse> {
    const t = tenantId ?? null;
    const where: Record<string, unknown> = {};
    if (q.promptKey) where.promptKey = q.promptKey;
    if (q.status) where.status = q.status;
    if (q.tenantId === '__global' || q.tenantId === 'null') {
      where.tenantId = null;
    } else if (q.tenantId === '__mine') {
      where.tenantId = t;
    } else if (q.tenantId) {
      where.tenantId = q.tenantId;
    } else {
      where.OR = [{ tenantId: null }, ...(t ? [{ tenantId: t }] : [])];
    }

    const [items, total] = await Promise.all([
      this.prisma.promptCandidate.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        take: q.limit,
        skip: (q.page - 1) * q.limit,
      }),
      this.prisma.promptCandidate.count({ where }),
    ]);
    return {
      items: items.map((c) => toCandidateDto(c)),
      total,
      page: q.page,
      limit: q.limit,
    };
  }

  @Patch('candidates/:id/reject')
  @ApiOperation({ summary: 'Вручную отклонить кандидата GEPA (status=rejected)' })
  async rejectCandidate(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RejectCandidateBodySchema)) body: RejectCandidateBody,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<PromptCandidateDto> {
    const t = tenantId ?? null;
    const candidate = await this.prisma.promptCandidate.findUnique({ where: { id } });
    if (!candidate) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'candidate_not_found', message: 'Кандидат не найден' },
      });
    }
    if (candidate.tenantId !== null && candidate.tenantId !== t) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'candidate_not_found', message: 'Кандидат не найден' },
      });
    }
    const updated = await this.prisma.promptCandidate.update({
      where: { id },
      data: {
        status: 'rejected',
        rejectedReason: body.reason,
        abEndedAt: new Date(),
      },
    });
    this.metrics.incGepaRejected({ reason: body.reason });
    return toCandidateDto(updated);
  }

  @Post('rollback/:promptKey')
  @ApiOperation({
    summary: 'Откат последнего auto-promote по promptKey (очистка LlmTaskRoute.promptOverride)',
  })
  async rollbackLastPromote(
    @Param('promptKey') promptKey: string,
    @Body(new ZodValidationPipe(RollbackPromptBodySchema)) body: RollbackPromptBody,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true; affected: number }> {
    const targetTenant = body.tenantId === undefined ? (tenantId ?? null) : body.tenantId;
    const routes = await this.prisma.llmTaskRoute.findMany({
      where: {
        taskType: promptKey,
        ...(targetTenant ? { tenantId: targetTenant } : { tenantId: null }),
        promptOverride: { not: null },
      },
    });
    let affected = 0;
    for (const r of routes) {
      await this.prisma.llmTaskRoute.update({
        where: { id: r.id },
        data: {
          promptOverride: null,
        },
      });
      affected += 1;
    }
    const lastPromoted = await this.prisma.promptCandidate.findFirst({
      where: {
        promptKey,
        status: 'promoted',
        ...(targetTenant ? { tenantId: targetTenant } : { tenantId: null }),
      },
      orderBy: { promotedAt: 'desc' },
    });
    if (lastPromoted) {
      await this.prisma.promptCandidate.update({
        where: { id: lastPromoted.id },
        data: {
          status: 'rejected',
          rejectedReason: 'manual_rollback',
          abEndedAt: new Date(),
        },
      });
      this.metrics.incGepaRollback({ reason: 'manual' });
    }
    return { ok: true, affected };
  }

  @Patch('lock/:promptKey')
  @ApiOperation({
    summary: 'Включить/выключить GEPA evolution для promptKey (LlmTaskRoute.evolutionEnabled)',
  })
  async lockEvolution(
    @Param('promptKey') promptKey: string,
    @Body(new ZodValidationPipe(LockEvolutionBodySchema)) body: LockEvolutionBody,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true; affected: number; enabled: boolean }> {
    const targetTenant = body.tenantId === undefined ? (tenantId ?? null) : body.tenantId;
    const routes = await this.prisma.llmTaskRoute.findMany({
      where: {
        taskType: promptKey,
        ...(targetTenant ? { tenantId: targetTenant } : { tenantId: null }),
      },
    });
    let affected = 0;
    for (const r of routes) {
      await this.prisma.llmTaskRoute.update({
        where: { id: r.id },
        data: { evolutionEnabled: body.enabled },
      });
      affected += 1;
    }
    return { ok: true, affected, enabled: body.enabled };
  }
}

function toDto(r: PromptRule): PromptRuleDto {
  return {
    id: r.id,
    tenantId: r.tenantId,
    promptKey: r.promptKey,
    rule: r.rule,
    ruleType: r.ruleType as PromptRuleDto['ruleType'],
    source: r.source as PromptRuleDto['source'],
    status: r.status as PromptRuleDto['status'],
    confidence: r.confidence,
    examples: Array.isArray(r.examples) ? (r.examples as unknown as PromptRuleDto['examples']) : [],
    shadowMetrics:
      r.shadowMetrics && typeof r.shadowMetrics === 'object'
        ? (r.shadowMetrics as PromptRuleDto['shadowMetrics'])
        : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    promotedAt: r.promotedAt?.toISOString() ?? null,
    archivedAt: r.archivedAt?.toISOString() ?? null,
    archivedReason: r.archivedReason ?? null,
  };
}

function toCandidateDto(c: PromptCandidate): PromptCandidateDto {
  const metric =
    c.paretoMetric && typeof c.paretoMetric === 'object'
      ? (c.paretoMetric as Record<string, number>)
      : {};
  return {
    id: c.id,
    tenantId: c.tenantId,
    promptKey: c.promptKey,
    parentVersion: c.parentVersion ?? null,
    promptText: c.promptText,
    paretoMetric: metric,
    status: c.status as CandidateStatusDto,
    evaluations: c.evaluations,
    compositeScore: c.compositeScore ?? null,
    abTrafficShare: c.abTrafficShare ?? null,
    abStartedAt: c.abStartedAt?.toISOString() ?? null,
    abEndedAt: c.abEndedAt?.toISOString() ?? null,
    promotedAt: c.promotedAt?.toISOString() ?? null,
    rejectedReason: c.rejectedReason ?? null,
    createdAt: c.createdAt.toISOString(),
  };
}
