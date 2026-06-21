import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';
import type { AiChatQuotaService } from '../../ai-chat-quota/ai-chat-quota.service';

import type { ConciergeContextBuilderService } from './concierge-context-builder.service';
import type { ConciergeQuotaService } from './concierge-quota.service';
import type { ConciergeUndoLogService } from './concierge-undo-log.service';
import { ConciergeService } from './concierge.service';
import type { ServiceMapGeneratorService } from './service-map-generator.service';
import type { ToolRouterService } from './tool-router.service';

type CompanyProfileRow = {
  displayName: string | null;
  stage: string | null;
  summaryJson: unknown;
  missionJson: unknown;
} | null;

function makeService(profileRow: CompanyProfileRow): ConciergeService {
  const prisma = {
    companyProfile: {
      findUnique: vi.fn(async () => profileRow),
    },
  } as unknown as PrismaService;
  const cfg = {} as unknown as TypedConfigService;
  const llm = { call: vi.fn() } as unknown as LlmRouterService;
  const contextBuilder = { build: vi.fn() } as unknown as ConciergeContextBuilderService;
  const serviceMap = {} as unknown as ServiceMapGeneratorService;
  const toolRouter = {} as unknown as ToolRouterService;
  const undoLog = {} as unknown as ConciergeUndoLogService;
  const quota = {} as unknown as ConciergeQuotaService;
  const aiChatQuota = {} as unknown as AiChatQuotaService;
  const metrics = {
    incCompanyCapsuleInjected: vi.fn(),
  } as unknown as BusinessMetricsService;

  return new ConciergeService(
    prisma,
    cfg,
    llm,
    contextBuilder,
    serviceMap,
    toolRouter,
    undoLog,
    quota,
    aiChatQuota,
    metrics,
  );
}

function buildCompanyAboutTail(svc: ConciergeService, tenantId: string): Promise<string> {
  const fn = (svc as unknown as { buildCompanyAboutTail(t: string): Promise<string> })
    .buildCompanyAboutTail;
  return fn.call(svc, tenantId);
}

describe('ConciergeService.buildCompanyAboutTail — хвост «О компании» (Слой 1 Ф3)', () => {
  it('строит хвост с «## О компании» и «Чем занимается:» из summaryJson', async () => {
    const svc = makeService({
      displayName: 'Кора',
      stage: 'рост',
      summaryJson: { contentMd: 'делаем X' },
      missionJson: null,
    });
    const out = await buildCompanyAboutTail(svc, 't-1');

    expect(out).toContain('## О компании');
    expect(out).toContain('Чем занимается: делаем X');
    expect(out).toContain('Название: Кора');
    expect(out).toContain('Стадия: рост');
  });

  it('возвращает пустую строку, если профиля нет', async () => {
    const svc = makeService(null);
    const out = await buildCompanyAboutTail(svc, 't-1');
    expect(out).toBe('');
  });
});
