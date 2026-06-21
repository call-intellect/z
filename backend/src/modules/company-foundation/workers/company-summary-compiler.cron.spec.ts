import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';
import type { CompanyProfileService } from '../services/company-profile.service';

import { CompanySummaryCompilerCron } from './company-summary-compiler.cron';

function makeBlocks(n: number): Array<{
  id: string;
  name: string;
  trustedAnswer: string;
  confidence: number;
}> {
  return Array.from({ length: n }, (_, i) => ({
    id: `block-${i}`,
    name: `Факт ${i}`,
    trustedAnswer: `Содержание ${i}`,
    confidence: 0.8,
  }));
}

function makeCron(args: {
  autoSummaryEnabled?: boolean;
  summaryRebuildHours?: number;
  summaryMinSourceBlocks?: number;
  orgs?: Array<{ id: string }>;
  getRaw?: unknown;
  blocks?: Array<{
    id: string;
    name: string;
    trustedAnswer: string;
    confidence: number;
  }>;
  llmResponse?: unknown;
  applyResult?: { applied: boolean; reason: string };
}): {
  cron: CompanySummaryCompilerCron;
  orgFindMany: ReturnType<typeof vi.fn>;
  ideaBlockFindMany: ReturnType<typeof vi.fn>;
  getRaw: ReturnType<typeof vi.fn>;
  applyAutoSummary: ReturnType<typeof vi.fn>;
  llmCall: ReturnType<typeof vi.fn>;
  incCompanySummaryCompile: ReturnType<typeof vi.fn>;
} {
  const orgFindMany = vi
    .fn()
    .mockResolvedValue(args.orgs ?? [{ id: 'org-1' }]);
  const ideaBlockFindMany = vi.fn().mockResolvedValue(args.blocks ?? []);
  const prisma = {
    org: { findMany: orgFindMany },
    ideaBlock: { findMany: ideaBlockFindMany },
  } as unknown as PrismaService;

  const getRaw = vi
    .fn()
    .mockResolvedValue(
      args.getRaw === undefined
        ? { summaryPinned: false, summaryJson: null }
        : args.getRaw,
    );
  const applyAutoSummary = vi
    .fn()
    .mockResolvedValue(args.applyResult ?? { applied: true, reason: 'updated' });
  const companyProfile = {
    getRaw,
    applyAutoSummary,
  } as unknown as CompanyProfileService;

  const llmCall = vi.fn().mockResolvedValue({
    text: JSON.stringify(args.llmResponse ?? { contentMd: 'Описание компании.' }),
  });
  const llm = { call: llmCall } as unknown as LlmRouterService;

  const incCompanySummaryCompile = vi.fn();
  const metrics = {
    incCompanySummaryCompile,
  } as unknown as BusinessMetricsService;

  const cfg = {
    companyProfile: {
      autoSummaryEnabled: args.autoSummaryEnabled ?? true,
      summaryRebuildHours: args.summaryRebuildHours ?? 24,
      summaryMinSourceBlocks: args.summaryMinSourceBlocks ?? 8,
    },
    aiFeatures: { promptInjectionGuardEnabled: false },
  } as unknown as TypedConfigService;

  const cron = new CompanySummaryCompilerCron(
    prisma,
    companyProfile,
    llm,
    metrics,
    cfg,
  );
  return {
    cron,
    orgFindMany,
    ideaBlockFindMany,
    getRaw,
    applyAutoSummary,
    llmCall,
    incCompanySummaryCompile,
  };
}

describe('CompanySummaryCompilerCron', () => {
  it('happy path: компилирует summary и зовёт applyAutoSummary с непустыми sourceBlockIds', async () => {
    const h = makeCron({
      blocks: makeBlocks(10),
      llmResponse: { contentMd: 'Чем занимается компания.' },
      applyResult: { applied: true, reason: 'updated' },
    });

    await h.cron.run();

    expect(h.applyAutoSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'org-1',
        contentMd: 'Чем занимается компания.',
        sourceBlockIds: expect.arrayContaining(['block-0']),
      }),
    );
    const blockIds = h.applyAutoSummary.mock.calls[0]?.[0]?.sourceBlockIds;
    expect(Array.isArray(blockIds) && blockIds.length).toBeGreaterThan(0);
    expect(h.incCompanySummaryCompile).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'compiled' }),
    );
  });

  it('cold-start: блоков меньше порога → applyAutoSummary не зовётся, метрика skipped_cold_start', async () => {
    const h = makeCron({ summaryMinSourceBlocks: 8, blocks: makeBlocks(3) });

    await h.cron.run();

    expect(h.applyAutoSummary).not.toHaveBeenCalled();
    expect(h.incCompanySummaryCompile).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'skipped_cold_start' }),
    );
  });

  it('pinned: профиль закреплён → applyAutoSummary не зовётся, метрика skipped_pinned', async () => {
    const h = makeCron({ getRaw: { summaryPinned: true, summaryJson: null } });

    await h.cron.run();

    expect(h.applyAutoSummary).not.toHaveBeenCalled();
    expect(h.incCompanySummaryCompile).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'skipped_pinned' }),
    );
  });

  it('fresh skip: свежий generatedAt → applyAutoSummary не зовётся, метрика skipped_fresh', async () => {
    const h = makeCron({
      summaryRebuildHours: 24,
      getRaw: {
        summaryPinned: false,
        summaryJson: {
          contentMd: 'Старое',
          generatedAt: new Date(Date.now() - 3600000).toISOString(),
        },
      },
    });

    await h.cron.run();

    expect(h.applyAutoSummary).not.toHaveBeenCalled();
    expect(h.incCompanySummaryCompile).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'skipped_fresh' }),
    );
  });

  it('kill-switch: autoSummaryEnabled=false → org.findMany не зовётся', async () => {
    const h = makeCron({ autoSummaryEnabled: false });

    await h.cron.run();

    expect(h.orgFindMany).not.toHaveBeenCalled();
  });
});
