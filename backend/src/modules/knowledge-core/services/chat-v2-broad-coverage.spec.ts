import { describe, expect, it, vi } from 'vitest';

import { ChatV2Service, type ChatV2Input } from './chat-v2.service';

function makeBare(): ChatV2Service {
  return Object.create(ChatV2Service.prototype) as ChatV2Service;
}

describe('ChatV2Service.buildUserMessage — broad-coverage инструкция (Ф5)', () => {
  it('extra.broadCoverage:true → инструкция «перечисли ВСЁ найденное»', () => {
    const svc = makeBare();
    const out = (svc as unknown as {
      buildUserMessage: (...a: unknown[]) => string;
    }).buildUserMessage('вопрос', [], [], [], { broadCoverage: true });

    expect(out).toContain('перечисли ВСЁ найденное');
  });

  it('без broadCoverage → инструкции нет', () => {
    const svc = makeBare();
    const out = (svc as unknown as {
      buildUserMessage: (...a: unknown[]) => string;
    }).buildUserMessage('вопрос', [], [], [], {});

    expect(out).not.toContain('перечисли ВСЁ найденное');
  });
});

function makeEpisodesSvc(over?: {
  listEpisodesByDateRange?: ReturnType<typeof vi.fn>;
  listEpisodesByActors?: ReturnType<typeof vi.fn>;
}): {
  svc: ChatV2Service;
  listEpisodesByDateRange: ReturnType<typeof vi.fn>;
  listEpisodesByActors: ReturnType<typeof vi.fn>;
} {
  const svc = makeBare();
  const listEpisodesByDateRange =
    over?.listEpisodesByDateRange ?? vi.fn().mockResolvedValue([{ id: 'e1' }]);
  const listEpisodesByActors =
    over?.listEpisodesByActors ?? vi.fn().mockResolvedValue([]);
  (svc as unknown as { cfg: unknown }).cfg = {
    getDynamic: vi.fn(async (key: string, _env: unknown, def: unknown) => {
      if (key === 'knowledge.list_episodes_limit') return 30;
      if (key === 'knowledge.chatV2AggregationMode') return true;
      return def;
    }),
  };
  (svc as unknown as { retrieval: unknown }).retrieval = {
    listEpisodesByDateRange,
    listEpisodesByActors,
  };
  (svc as unknown as { logger: unknown }).logger = { warn: vi.fn() };
  return { svc, listEpisodesByDateRange, listEpisodesByActors };
}

function callBranch(
  svc: ChatV2Service,
  input: ChatV2Input,
  tenantId: string,
): Promise<unknown[]> {
  return (svc as unknown as {
    runEpisodesBranch: (i: ChatV2Input, t: string) => Promise<unknown[]>;
  }).runEpisodesBranch(input, tenantId);
}

const baseFilters = {
  signalTypes: [] as string[],
  themeBranches: [] as string[],
  bitemporalActiveOnly: false,
};

describe('ChatV2Service.runEpisodesBranch — перечень за период без person/entity (Ф5)', () => {
  it('list + дата без person/entity → listEpisodesByDateRange', async () => {
    const { svc, listEpisodesByDateRange, listEpisodesByActors } =
      makeEpisodesSvc();
    const input = {
      queryClass: 'list',
      structuralFilters: {
        personIds: [],
        entityIds: [],
        dateFrom: new Date('2026-06-08'),
        dateTo: new Date('2026-06-14'),
        ...baseFilters,
      },
    } as unknown as ChatV2Input;

    await callBranch(svc, input, 't');

    expect(listEpisodesByDateRange).toHaveBeenCalled();
    expect(listEpisodesByActors).not.toHaveBeenCalled();
  });

  it('list + person → listEpisodesByActors', async () => {
    const { svc, listEpisodesByDateRange, listEpisodesByActors } =
      makeEpisodesSvc();
    const input = {
      queryClass: 'list',
      structuralFilters: {
        personIds: ['p1'],
        entityIds: [],
        dateFrom: null,
        dateTo: null,
        ...baseFilters,
      },
    } as unknown as ChatV2Input;

    await callBranch(svc, input, 't');

    expect(listEpisodesByActors).toHaveBeenCalled();
    expect(listEpisodesByDateRange).not.toHaveBeenCalled();
  });

  it('list без person/entity и без дат → []', async () => {
    const { svc, listEpisodesByDateRange, listEpisodesByActors } =
      makeEpisodesSvc();
    const input = {
      queryClass: 'list',
      structuralFilters: {
        personIds: [],
        entityIds: [],
        dateFrom: null,
        dateTo: null,
        ...baseFilters,
      },
    } as unknown as ChatV2Input;

    const out = await callBranch(svc, input, 't');

    expect(out).toEqual([]);
    expect(listEpisodesByActors).not.toHaveBeenCalled();
    expect(listEpisodesByDateRange).not.toHaveBeenCalled();
  });
});
