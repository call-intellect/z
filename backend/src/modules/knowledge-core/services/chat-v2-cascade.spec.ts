import { describe, it, expect, vi } from 'vitest';

import { ChatV2Service } from './chat-v2.service';

function makeSvc(overrides: Record<string, unknown> = {}): any {
  const svc: any = Object.create(ChatV2Service.prototype);
  svc.cfg = { getDynamic: vi.fn() };
  svc.logger = { log: vi.fn(), warn: vi.fn(), debug: vi.fn() };
  svc.runSemanticRoute = vi.fn();
  Object.assign(svc, overrides);
  return svc;
}

function cfgMock(enabled: boolean) {
  return (key: string) =>
    Promise.resolve(
      key.includes('CascadeEnabled')
        ? enabled
        : key.includes('CascadeMinPool')
          ? 5
          : undefined,
    );
}

const ctx = {
  tenantId: 't',
  scope: 'org' as const,
  scopeId: null,
  query: 'q',
  kRetrieve: 20,
  kContext: 12,
  graphHops: 1,
  graphAlwaysExpand: true,
  filterMode: 'boost' as const,
  filterBoostWeight: 0.3,
  entityLinkHops: 1,
  accessWhere: undefined,
};

describe('ChatV2Service.applyCascade', () => {
  it('пул ≥ minPool → каскад НЕ запускается, approximate=false', async () => {
    const svc = makeSvc();
    svc.cfg.getDynamic.mockImplementation(cfgMock(true));

    const result = await svc.applyCascade(
      { structuralFilters: null },
      ctx,
      ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'],
      60,
    );

    expect(result).toEqual({
      blockIds: ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'],
      approximate: false,
    });
    expect(svc.runSemanticRoute).not.toHaveBeenCalled();
  });

  it('пул < minPool + были фильтры → widening, approximate=true, пул вырос', async () => {
    const svc = makeSvc();
    svc.cfg.getDynamic.mockImplementation(cfgMock(true));
    svc.runSemanticRoute.mockResolvedValue(['b1', 'wX', 'wY', 'wZ', 'wQ', 'wW']);

    const result = await svc.applyCascade(
      {
        structuralFilters: {
          entityIds: ['e1'],
          personIds: [],
          signalTypes: [],
          themeBranches: [],
          dateFrom: null,
          dateTo: null,
          bitemporalActiveOnly: false,
        },
      },
      ctx,
      ['b1'],
      60,
    );

    expect(svc.runSemanticRoute).toHaveBeenCalled();
    expect(result.approximate).toBe(true);
    expect(result.blockIds.length).toBeGreaterThan(1);
    expect(result.blockIds).toContain('wX');
  });

  it('cascadeEnabled=false → возвращает как есть, approximate=false, runSemanticRoute не зван', async () => {
    const svc = makeSvc();
    svc.cfg.getDynamic.mockImplementation(cfgMock(false));

    const result = await svc.applyCascade(
      { structuralFilters: null },
      ctx,
      ['b1'],
      60,
    );

    expect(result).toEqual({ blockIds: ['b1'], approximate: false });
    expect(svc.runSemanticRoute).not.toHaveBeenCalled();
  });

  it('пул < minPool, фильтров НЕ было, graphHops<2 → step2 глубже граф', async () => {
    const svc = makeSvc();
    svc.cfg.getDynamic.mockImplementation(cfgMock(true));
    svc.runSemanticRoute.mockResolvedValue(['b1', 'd1', 'd2', 'd3', 'd4', 'd5']);

    const result = await svc.applyCascade(
      { structuralFilters: null },
      ctx,
      ['b1'],
      60,
    );

    expect(svc.runSemanticRoute).toHaveBeenCalled();
    expect(result.approximate).toBe(true);
    expect(result.blockIds.length).toBeGreaterThan(1);
  });
});
