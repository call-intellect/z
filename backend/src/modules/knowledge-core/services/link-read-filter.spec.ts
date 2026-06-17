import { LinkStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { ACTIVE_LINK_FILTER } from './link-read-filter';

/**
 * Машинный гард для бага Б2 / класс K2: soft-delete рёбер графа.
 * Единый фильтр «живого» ребра обязан фильтровать И по status:'active',
 * И по deletedAt:null — иначе soft-deleted рёбра видны в графе/RAG/чате.
 */
describe('ACTIVE_LINK_FILTER', () => {
  it('фильтрует и по status:active, и по deletedAt:null', () => {
    expect(ACTIVE_LINK_FILTER).toEqual({
      status: LinkStatus.active,
      deletedAt: null,
    });
  });

  it('status равен active (строкой и через enum)', () => {
    expect(ACTIVE_LINK_FILTER.status).toBe('active');
    expect(ACTIVE_LINK_FILTER.status).toBe(LinkStatus.active);
  });

  it('deletedAt строго null (исключает soft-deleted рёбра)', () => {
    expect(ACTIVE_LINK_FILTER.deletedAt).toBeNull();
    expect('deletedAt' in ACTIVE_LINK_FILTER).toBe(true);
  });
});
