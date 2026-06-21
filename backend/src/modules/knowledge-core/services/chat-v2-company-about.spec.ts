import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';
import type { KnowledgeAccessResolver } from '../../rbac/knowledge-access-resolver.service';

import type { ChatV2RetrievalService } from './chat-v2-retrieval.service';
import { ChatV2Service } from './chat-v2.service';
import type { ProvenanceService } from './provenance.service';

type CompanyProfileRow = {
  displayName: string | null;
  stage: string | null;
  summaryJson: unknown;
  missionJson: unknown;
} | null;

function makeService(profileRow: CompanyProfileRow): ChatV2Service {
  const prisma = {
    companyProfile: {
      findUnique: vi.fn(async () => profileRow),
    },
  } as unknown as PrismaService;
  const cfg = {} as unknown as TypedConfigService;
  const metrics = {
    incCompanyCapsuleInjected: vi.fn(),
  } as unknown as BusinessMetricsService;
  const llm = { call: vi.fn() } as unknown as LlmRouterService;
  const retrieval = { fetchCandidates: vi.fn() } as unknown as ChatV2RetrievalService;
  const accessResolver = {
    partitionBlockIdsByAccess: vi.fn(),
  } as unknown as KnowledgeAccessResolver;
  const provenance = {
    resolveByRawEventIds: vi.fn(async () => new Map()),
  } as unknown as ProvenanceService;

  return new ChatV2Service(
    prisma,
    cfg,
    llm,
    retrieval,
    metrics,
    accessResolver,
    provenance,
    undefined,
    undefined,
  );
}

function buildCompanyAbout(svc: ChatV2Service, tenantId: string): Promise<string> {
  const fn = (svc as unknown as { buildCompanyAbout(t: string): Promise<string> }).buildCompanyAbout;
  return fn.call(svc, tenantId);
}

describe('ChatV2Service.buildCompanyAbout — capsule summary (Слой 1 Ф3)', () => {
  it('подставляет «Чем занимается:» из summaryJson.contentMd', async () => {
    const svc = makeService({
      displayName: 'Кора',
      stage: 'рост',
      summaryJson: { contentMd: 'делаем X' },
      missionJson: null,
    });
    const out = await buildCompanyAbout(svc, 't-1');

    expect(out).toContain('## О компании');
    expect(out).toContain('Чем занимается: делаем X');
    expect(out).toContain('Название: Кора');
    expect(out).toContain('Стадия: рост');
  });

  it('возвращает пустую строку, если профиля нет', async () => {
    const svc = makeService(null);
    const out = await buildCompanyAbout(svc, 't-1');
    expect(out).toBe('');
  });
});
