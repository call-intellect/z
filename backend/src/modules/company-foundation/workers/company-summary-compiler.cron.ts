import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { type IdeaBlockStatus, type SignalType } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { applyInputGuards } from '../../ai/services/prompts/common';
import {
  COMPANY_SUMMARY_COMPILE_JSON_SCHEMA,
  COMPANY_SUMMARY_COMPILE_SCHEMA_NAME,
  COMPANY_SUMMARY_COMPILE_SYSTEM_PROMPT,
  COMPANY_SUMMARY_COMPILE_USER_TEMPLATE,
} from '../prompts/company-summary-compile.prompt';
import { CompanyProfileService } from '../services/company-profile.service';

const LIVING_STATUSES: readonly IdeaBlockStatus[] = ['canonical'];
const TOP_BLOCKS_LIMIT = 40;
const FACT_MAX_LENGTH = 300;
const DURABLE_SIGNAL_TYPES: readonly SignalType[] = [
  'fact',
  'decision',
  'process_step',
  'regulation',
  'metric_change',
  'commitment',
  'lesson',
  'result',
];

@Injectable()
export class CompanySummaryCompilerCron {
  private readonly logger = new Logger(CompanySummaryCompilerCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CompanyProfileService)
    private readonly companyProfile: CompanyProfileService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  @Cron('45 * * * *')
  async run(): Promise<void> {
    if (!this.cfg.companyProfile.autoSummaryEnabled) {
      this.logger.debug(
        'company-summary-compiler.cron: выключен (companyProfile.autoSummaryEnabled=false)',
      );
      return;
    }
    try {
      const orgs = await this.prisma.org.findMany({
        where: { deletedAt: null },
        select: { id: true },
      });
      let compiled = 0;
      let skipped = 0;
      for (const org of orgs) {
        try {
          const result = await this.compileForOrg(org.id);
          if (result === 'compiled') compiled++;
          else skipped++;
        } catch (err) {
          this.metrics.incCompanySummaryCompile({ result: 'error' });
          this.logger.warn(
            {
              tenantId: org.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'company-summary-compiler.cron: org пропущен (fail-open)',
          );
        }
      }
      this.logger.debug(
        { orgsScanned: orgs.length, compiled, skipped },
        'company-summary-compiler.cron: проход завершён',
      );
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'company-summary-compiler.cron: непойманная ошибка',
      );
    }
  }

  private async compileForOrg(tenantId: string): Promise<string> {
    const profile = await this.companyProfile.getRaw(tenantId);
    if (profile?.summaryPinned) {
      this.metrics.incCompanySummaryCompile({ result: 'skipped_pinned' });
      return 'skipped_pinned';
    }

    const generatedAt = extractGeneratedAt(profile?.summaryJson);
    const currentSummary = extractSummaryContentMd(profile?.summaryJson);
    if (generatedAt != null) {
      const ageMs = Date.now() - Date.parse(generatedAt);
      const maxAgeMs =
        this.cfg.companyProfile.summaryRebuildHours * 3600000;
      if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < maxAgeMs) {
        this.metrics.incCompanySummaryCompile({ result: 'skipped_fresh' });
        return 'skipped_fresh';
      }
    }

    const blocks = await this.prisma.ideaBlock.findMany({
      where: {
        tenantId,
        status: { in: [...LIVING_STATUSES] },
        signalType: { in: [...DURABLE_SIGNAL_TYPES] },
      },
      orderBy: [{ createdAt: 'desc' }],
      take: TOP_BLOCKS_LIMIT,
      select: { id: true, name: true, trustedAnswer: true, confidence: true },
    });

    if (blocks.length < this.cfg.companyProfile.summaryMinSourceBlocks) {
      this.metrics.incCompanySummaryCompile({ result: 'skipped_cold_start' });
      return 'skipped_cold_start';
    }

    const facts = blocks.map((b) =>
      `${b.name}: ${b.trustedAnswer ?? ''}`.slice(0, FACT_MAX_LENGTH),
    );

    const guardOn = this.cfg.aiFeatures?.promptInjectionGuardEnabled !== false;
    const guarded = applyInputGuards(
      COMPANY_SUMMARY_COMPILE_SYSTEM_PROMPT,
      COMPANY_SUMMARY_COMPILE_USER_TEMPLATE({ currentSummary, facts }),
      { enabled: guardOn, injection: true },
    );

    const llmResult = await this.llm.call({
      taskType: 'company-summary-compile',
      systemPrompt: guarded.system,
      userMessage: guarded.user,
      tenantId,
      responseFormat: {
        type: 'json_schema',
        name: COMPANY_SUMMARY_COMPILE_SCHEMA_NAME,
        schema: COMPANY_SUMMARY_COMPILE_JSON_SCHEMA,
        strict: true,
      },
      sourceRef: { type: 'company-summary', id: tenantId },
      dataClass: 'internal',
    });

    const parsed = JSON.parse(llmResult.text) as {
      contentMd?: unknown;
      changed?: unknown;
    };
    const contentMd =
      typeof parsed.contentMd === 'string' ? parsed.contentMd.trim() : '';
    if (contentMd.length === 0) {
      this.metrics.incCompanySummaryCompile({ result: 'error' });
      return 'error';
    }

    const hasCurrent = (currentSummary ?? '').trim().length > 0;
    if (parsed.changed === false && hasCurrent) {
      await this.companyProfile.touchSummaryGeneratedAt(tenantId);
      this.metrics.incCompanySummaryCompile({ result: 'skipped_no_change' });
      return 'skipped_no_change';
    }

    const confidence = Math.min(
      1,
      blocks.length / (this.cfg.companyProfile.summaryMinSourceBlocks * 3),
    );

    const res = await this.companyProfile.applyAutoSummary({
      tenantId,
      contentMd,
      sourceBlockIds: blocks.map((b) => b.id),
      confidence,
    });
    const result = res.applied ? 'compiled' : res.reason;
    this.metrics.incCompanySummaryCompile({ result });
    return result;
  }
}

function extractGeneratedAt(json: unknown): string | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const v = (json as Record<string, unknown>).generatedAt;
  return typeof v === 'string' ? v : null;
}

function extractSummaryContentMd(json: unknown): string | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const v = (json as Record<string, unknown>).contentMd;
  return typeof v === 'string' ? v : null;
}
