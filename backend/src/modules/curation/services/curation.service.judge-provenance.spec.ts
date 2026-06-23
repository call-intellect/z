import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type {
  DebateVerdict,
  MultiAgentDebateService,
} from '../../ai/services/multi-agent-debate.service';
import type { ConversationalService } from '../../conversational/conversational.service';
import type { ProvenanceService } from '../../knowledge-core/services/provenance.service';

import { CurationService, type TriageInput } from './curation.service';
import type { CuratorRoutingService } from './curator-routing.service';

function acceptVerdict(): DebateVerdict {
  return {
    decision: 'accept',
    votes: [],
    consensusType: 'unanimous',
    rounds: 1,
    totalCostUsd: 0.001,
    fallbackUsed: null,
  };
}

function buildService(opts: {
  judge: ReturnType<typeof vi.fn>;
  resolveQuotes?: ReturnType<typeof vi.fn>;
}): CurationService {
  const prisma = {} as unknown as PrismaService;
  const cfg = {} as unknown as TypedConfigService;
  const metrics = {} as unknown as BusinessMetricsService;
  const conversational = {} as unknown as ConversationalService;
  const routing = {} as unknown as CuratorRoutingService;
  const debate = { judge: opts.judge } as unknown as MultiAgentDebateService;
  const provenance = opts.resolveQuotes
    ? ({ resolveQuotesForJudge: opts.resolveQuotes } as unknown as ProvenanceService)
    : null;
  return new CurationService(
    prisma,
    cfg,
    metrics,
    conversational,
    routing,
    null,
    null,
    debate,
    provenance,
  );
}

const input: TriageInput = {
  tenantId: 'tenant-A',
  resourceType: 'decision',
  resourceId: 'res-1',
  confidence: 0.95,
  proposedPayload: { statement: 'Переходим на недельные спринты' },
  conflictSignal: 'none',
};

describe('CurationService.runAiVerifier — первоисточник для ИИ-судьи', () => {
  it('резолвит цитаты и передаёт их judge как contextBlocks=[{quote}]', async () => {
    const judge = vi.fn(async () => acceptVerdict());
    const resolveQuotes = vi.fn(async () => ['цитата1']);
    const service = buildService({ judge, resolveQuotes });

    await (service as unknown as { runAiVerifier(i: TriageInput): Promise<unknown> }).runAiVerifier(
      input,
    );

    expect(resolveQuotes).toHaveBeenCalledWith('tenant-A', 'decision', 'res-1', 5);
    expect(judge).toHaveBeenCalledWith(
      expect.objectContaining({ contextBlocks: [{ quote: 'цитата1' }] }),
    );
  });

  it('provenance бросает → fail-soft: judge всё равно вызван с contextBlocks=[]', async () => {
    const judge = vi.fn(async () => acceptVerdict());
    const resolveQuotes = vi.fn(async () => {
      throw new Error('provenance down');
    });
    const service = buildService({ judge, resolveQuotes });

    await (service as unknown as { runAiVerifier(i: TriageInput): Promise<unknown> }).runAiVerifier(
      input,
    );

    expect(judge).toHaveBeenCalledWith(expect.objectContaining({ contextBlocks: [] }));
  });

  it('первоисточник пуст → judge вызван с contextBlocks=[] (поведение прежнее)', async () => {
    const judge = vi.fn(async () => acceptVerdict());
    const resolveQuotes = vi.fn(async () => []);
    const service = buildService({ judge, resolveQuotes });

    await (service as unknown as { runAiVerifier(i: TriageInput): Promise<unknown> }).runAiVerifier(
      input,
    );

    expect(judge).toHaveBeenCalledWith(expect.objectContaining({ contextBlocks: [] }));
  });

  it('provenance не подключён (null) → judge вызван с contextBlocks=[]', async () => {
    const judge = vi.fn(async () => acceptVerdict());
    const service = buildService({ judge });

    await (service as unknown as { runAiVerifier(i: TriageInput): Promise<unknown> }).runAiVerifier(
      input,
    );

    expect(judge).toHaveBeenCalledWith(expect.objectContaining({ contextBlocks: [] }));
  });
});
