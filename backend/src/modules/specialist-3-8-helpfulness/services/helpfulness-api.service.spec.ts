import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RecognitionService } from '../../recognition/services/recognition.service';

import { HelpfulnessApiService } from './helpfulness-api.service';

interface TraitRecord {
  id: string;
  tenantId: string;
  helperUserId: string;
  traitType: string;
  status: string;
}

interface SpotlightRecord {
  id: string;
  tenantId: string;
  helperUserId: string;
  topicHint: string | null;
  message: string;
  periodFrom: Date;
  periodTo: Date;
  helpCount: number;
  status: string;
  approvedByUserId: string | null;
  publishedAt: Date | null;
  feedItemId: string | null;
  createdAt: Date;
  updatedAt?: Date;
  traitIds?: string[];
}

function buildMockPrisma(initial: { traits?: TraitRecord[]; spotlights?: SpotlightRecord[] }): any {
  const traits = new Map<string, TraitRecord>((initial.traits ?? []).map((t) => [t.id, { ...t }]));
  const spotlights = new Map<string, SpotlightRecord>(
    (initial.spotlights ?? []).map((s) => [s.id, { ...s }]),
  );

  return {
    helpfulnessTrait: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; tenantId: string } }) => {
        const t = traits.get(where.id);
        if (!t) return null;
        if (t.tenantId !== where.tenantId) return null;
        return t;
      }),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Partial<TraitRecord> }) => {
          const t = traits.get(where.id);
          if (!t) throw new Error('not found');
          Object.assign(t, data);
          return t;
        },
      ),
    },
    helpfulnessSpotlight: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; tenantId: string } }) => {
        const s = spotlights.get(where.id);
        if (!s) return null;
        if (s.tenantId !== where.tenantId) return null;
        return s;
      }),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Partial<SpotlightRecord> }) => {
          const s = spotlights.get(where.id);
          if (!s) throw new Error('not found');
          Object.assign(s, data);
          return s;
        },
      ),
    },
    activityFeedItem: {
      create: vi.fn(async ({ data }: { data: { tenantId: string } }) => ({
        id: `feed_${Math.random().toString(36).slice(2, 8)}`,
        ...data,
      })),
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(mockPrisma)),
  };
}

const mockMetrics = {
  incCoreSpecialistCards: vi.fn(),
} as unknown as ConstructorParameters<typeof HelpfulnessApiService>[1];

function buildMockRecognition(): {
  enqueueFormulate: ReturnType<typeof vi.fn>;
} {
  return {
    enqueueFormulate: vi.fn().mockResolvedValue({ jobId: 'job-mock' }),
  };
}

let mockPrisma: ReturnType<typeof buildMockPrisma>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('HelpfulnessApiService — mark-as-misleading', () => {
  it('помечает trait как mark_as_misleading, если user — owner', async () => {
    mockPrisma = buildMockPrisma({
      traits: [
        {
          id: 't1',
          tenantId: 'org1',
          helperUserId: 'u1',
          traitType: 'help_provided',
          status: 'active',
        },
      ],
    });
    const svc = new HelpfulnessApiService(mockPrisma as any, mockMetrics as any);
    const res = await svc.markTraitAsMisleading({
      tenantId: 'org1',
      traitId: 't1',
      userId: 'u1',
    });
    expect(res.ok).toBe(true);
    expect(mockPrisma.helpfulnessTrait.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { status: 'mark_as_misleading' },
    });
  });

  it('бросает ForbiddenException, если user — не owner', async () => {
    mockPrisma = buildMockPrisma({
      traits: [
        {
          id: 't1',
          tenantId: 'org1',
          helperUserId: 'u1',
          traitType: 'help_provided',
          status: 'active',
        },
      ],
    });
    const svc = new HelpfulnessApiService(mockPrisma as any, mockMetrics as any);
    await expect(
      svc.markTraitAsMisleading({
        tenantId: 'org1',
        traitId: 't1',
        userId: 'u2_other',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('бросает NotFoundException, если trait не найден', async () => {
    mockPrisma = buildMockPrisma({});
    const svc = new HelpfulnessApiService(mockPrisma as any, mockMetrics as any);
    await expect(
      svc.markTraitAsMisleading({
        tenantId: 'org1',
        traitId: 'missing',
        userId: 'u1',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('бросает NotFoundException на cross-tenant trait', async () => {
    mockPrisma = buildMockPrisma({
      traits: [
        {
          id: 't1',
          tenantId: 'org_other',
          helperUserId: 'u1',
          traitType: 'help_provided',
          status: 'active',
        },
      ],
    });
    const svc = new HelpfulnessApiService(mockPrisma as any, mockMetrics as any);
    await expect(
      svc.markTraitAsMisleading({
        tenantId: 'org1',
        traitId: 't1',
        userId: 'u1',
      }),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('HelpfulnessApiService — hide / republish / approve invariants', () => {
  it('hideSpotlight: бросает NotFoundException, если не найден', async () => {
    mockPrisma = buildMockPrisma({});
    const svc = new HelpfulnessApiService(mockPrisma as any, mockMetrics as any);
    await expect(svc.hideSpotlight({ tenantId: 'org1', spotlightId: 'missing' })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('republishSpotlight: бросает ForbiddenException если status ≠ hidden', async () => {
    mockPrisma = buildMockPrisma({
      spotlights: [
        {
          id: 's1',
          tenantId: 'org1',
          helperUserId: 'u1',
          topicHint: null,
          message: 'test',
          periodFrom: new Date(),
          periodTo: new Date(),
          helpCount: 3,
          status: 'published',
          approvedByUserId: 'admin',
          publishedAt: new Date(),
          feedItemId: null,
          createdAt: new Date(),
        },
      ],
    });
    const svc = new HelpfulnessApiService(mockPrisma as any, mockMetrics as any);
    await expect(
      svc.republishSpotlight({
        tenantId: 'org1',
        spotlightId: 's1',
        approvedByUserId: 'admin2',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('approveSpotlight: бросает ForbiddenException если status ≠ pending', async () => {
    mockPrisma = buildMockPrisma({
      spotlights: [
        {
          id: 's1',
          tenantId: 'org1',
          helperUserId: 'u1',
          topicHint: null,
          message: 'test',
          periodFrom: new Date(),
          periodTo: new Date(),
          helpCount: 3,
          status: 'published',
          approvedByUserId: 'admin',
          publishedAt: new Date(),
          feedItemId: null,
          createdAt: new Date(),
        },
      ],
    });
    const svc = new HelpfulnessApiService(mockPrisma as any, mockMetrics as any);
    await expect(
      svc.approveSpotlight({
        tenantId: 'org1',
        spotlightId: 's1',
        approvedByUserId: 'admin2',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('approveSpotlight: на pending переходит в published + создаёт ActivityFeedItem', async () => {
    mockPrisma = buildMockPrisma({
      spotlights: [
        {
          id: 's1',
          tenantId: 'org1',
          helperUserId: 'u1',
          topicHint: 'безопасность',
          message: 'Иван 5 раз помог по безопасности',
          periodFrom: new Date('2026-05-17'),
          periodTo: new Date('2026-05-24'),
          helpCount: 5,
          status: 'pending',
          approvedByUserId: null,
          publishedAt: null,
          feedItemId: null,
          createdAt: new Date(),
        },
      ],
    });
    const svc = new HelpfulnessApiService(mockPrisma as any, mockMetrics as any);
    const res = await svc.approveSpotlight({
      tenantId: 'org1',
      spotlightId: 's1',
      approvedByUserId: 'admin1',
    });
    expect(res.ok).toBe(true);
    expect(res.spotlight.status).toBe('published');
    expect(mockPrisma.activityFeedItem.create).toHaveBeenCalled();
    const feedCall = mockPrisma.activityFeedItem.create.mock.calls[0]?.[0];
    expect(feedCall?.data.feedType).toBe('spotlight');
    expect(feedCall?.data.sourceAgentName).toBe('helpfulness_agent');
    expect(feedCall?.data.visibility).toBe('public_org');
  });
});

describe('HelpfulnessApiService — approveSpotlight → Recognition bridge', () => {
  function pendingSpotlight(): SpotlightRecord {
    return {
      id: 's1',
      tenantId: 'org1',
      helperUserId: 'u1',
      topicHint: 'безопасность',
      message: 'Иван 5 раз помог по безопасности',
      periodFrom: new Date('2026-05-17'),
      periodTo: new Date('2026-05-24'),
      helpCount: 5,
      status: 'pending',
      approvedByUserId: null,
      publishedAt: null,
      feedItemId: null,
      createdAt: new Date(),
    };
  }

  it('после publish вызывает recognitionService.enqueueFormulate с правильными аргументами', async () => {
    mockPrisma = buildMockPrisma({ spotlights: [pendingSpotlight()] });
    const recognition = buildMockRecognition();
    const svc = new HelpfulnessApiService(
      mockPrisma as any,
      mockMetrics as any,
      recognition as unknown as RecognitionService,
    );
    const res = await svc.approveSpotlight({
      tenantId: 'org1',
      spotlightId: 's1',
      approvedByUserId: 'admin1',
    });
    expect(res.ok).toBe(true);
    expect(res.spotlight.status).toBe('published');
    expect(recognition.enqueueFormulate).toHaveBeenCalledTimes(1);
    const args = recognition.enqueueFormulate.mock.calls[0]?.[0] as {
      tenantId: string;
      type: string;
      toUserId: string;
      contextEntityType: string;
      contextEntityId: string;
      visibility: string;
      contextPayload: { topicHint: string | null; helpCount: number; message: string };
    };
    expect(args.tenantId).toBe('org1');
    expect(args.type).toBe('thanks_helpfulness');
    expect(args.toUserId).toBe('u1');
    expect(args.contextEntityType).toBe('helpfulness_spotlight');
    expect(args.contextEntityId).toBe('s1');
    expect(args.visibility).toBe('team');
    expect(args.contextPayload).toEqual({
      topicHint: 'безопасность',
      helpCount: 5,
      message: 'Иван 5 раз помог по безопасности',
    });
  });

  it('идемпотентно: повторный approve уже опубликованного spotlight отбрасывается до bridge (no second enqueue)', async () => {
    mockPrisma = buildMockPrisma({ spotlights: [pendingSpotlight()] });
    const recognition = buildMockRecognition();
    const svc = new HelpfulnessApiService(
      mockPrisma as any,
      mockMetrics as any,
      recognition as unknown as RecognitionService,
    );
    await svc.approveSpotlight({
      tenantId: 'org1',
      spotlightId: 's1',
      approvedByUserId: 'admin1',
    });
    expect(recognition.enqueueFormulate).toHaveBeenCalledTimes(1);
    await expect(
      svc.approveSpotlight({
        tenantId: 'org1',
        spotlightId: 's1',
        approvedByUserId: 'admin2',
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(recognition.enqueueFormulate).toHaveBeenCalledTimes(1);
  });

  it('graceful: если RecognitionService недоступен (null) — publish успешен без падений', async () => {
    mockPrisma = buildMockPrisma({ spotlights: [pendingSpotlight()] });
    const svc = new HelpfulnessApiService(mockPrisma as any, mockMetrics as any);
    const res = await svc.approveSpotlight({
      tenantId: 'org1',
      spotlightId: 's1',
      approvedByUserId: 'admin1',
    });
    expect(res.ok).toBe(true);
    expect(res.spotlight.status).toBe('published');
    expect(mockPrisma.activityFeedItem.create).toHaveBeenCalled();
  });

  it('graceful: enqueueFormulate бросает — approve всё равно возвращает ok (publish уже сделан)', async () => {
    mockPrisma = buildMockPrisma({ spotlights: [pendingSpotlight()] });
    const recognition = {
      enqueueFormulate: vi.fn().mockRejectedValue(new Error('queue down')),
    };
    const svc = new HelpfulnessApiService(
      mockPrisma as any,
      mockMetrics as any,
      recognition as unknown as RecognitionService,
    );
    const res = await svc.approveSpotlight({
      tenantId: 'org1',
      spotlightId: 's1',
      approvedByUserId: 'admin1',
    });
    expect(res.ok).toBe(true);
    expect(res.spotlight.status).toBe('published');
    expect(recognition.enqueueFormulate).toHaveBeenCalledTimes(1);
  });
});
