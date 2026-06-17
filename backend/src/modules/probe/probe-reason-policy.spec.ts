/**
 * Probe-система Фаза 2 (2026-06-11) — окно по типу пробела + recheck.
 * Детерминизм: probeWindow — чистая функция; recheck — с мок-Prisma.
 */
import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../common/prisma/prisma.service';

import {
  isEntityUnattributed,
  PROBE_REASON_RECHECK,
  probeWindow,
} from './probe-reason-policy';

describe('probeWindow', () => {
  it('immediate для критичных reason', () => {
    expect(probeWindow('decision.overdue')).toBe('immediate');
    expect(probeWindow('decision.missing_decider')).toBe('immediate');
    expect(probeWindow('regulation.missing_owner')).toBe('immediate');
    expect(probeWindow('consistency_violation.R3')).toBe('immediate');
    expect(probeWindow('kr_checkpoint_suggested')).toBe('immediate');
  });

  it('deferrable для прочих reason и по умолчанию', () => {
    expect(probeWindow('idea.status_unclear')).toBe('deferrable');
    expect(probeWindow('card.outdated_summary')).toBe('deferrable');
    expect(probeWindow('unknown.x')).toBe('deferrable');
  });
});

describe('PROBE_REASON_RECHECK', () => {
  it('decision.missing_decider: решающий назначен → пробел закрыт (false)', async () => {
    const prisma = {
      decision: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ decidedByPersonIds: ['p1'], decidedByPersonId: null }),
      },
    } as unknown as PrismaService;
    const rel = await PROBE_REASON_RECHECK['decision.missing_decider']!({
      prisma,
      tenantId: 'org-1',
      contextCardId: 'dec-1',
      contextCardKind: 'decision',
    });
    expect(rel).toBe(false);
  });

  it('decision.missing_decider: решающего нет → пробел открыт (true)', async () => {
    const prisma = {
      decision: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ decidedByPersonIds: [], decidedByPersonId: null }),
      },
    } as unknown as PrismaService;
    const rel = await PROBE_REASON_RECHECK['decision.missing_decider']!({
      prisma,
      tenantId: 'org-1',
      contextCardId: 'dec-1',
      contextCardKind: 'decision',
    });
    expect(rel).toBe(true);
  });

  it('сущность удалена (null) → подавляем (false)', async () => {
    const prisma = {
      decision: { findFirst: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const rel = await PROBE_REASON_RECHECK['decision.overdue']!({
      prisma,
      tenantId: 'org-1',
      contextCardId: 'dec-x',
      contextCardKind: 'decision',
    });
    expect(rel).toBe(false);
  });

  it('нет contextCardId → не подавляем (true)', async () => {
    const prisma = {
      idea: { findFirst: vi.fn() },
    } as unknown as PrismaService;
    const rel = await PROBE_REASON_RECHECK['idea.status_unclear']!({
      prisma,
      tenantId: 'org-1',
      contextCardId: null,
      contextCardKind: 'idea',
    });
    expect(rel).toBe(true);
  });
});

describe('isEntityUnattributed (Ф6)', () => {
  it('customer/vendor без привязки → true', () => {
    expect(isEntityUnattributed({ type: 'customer', metadata: null })).toBe(true);
    expect(isEntityUnattributed({ type: 'vendor', metadata: {} })).toBe(true);
    expect(
      isEntityUnattributed({ type: 'customer', metadata: { note: 'x' } }),
    ).toBe(true);
  });

  it('customer с metadata-ключом привязки → false', () => {
    expect(
      isEntityUnattributed({ type: 'customer', metadata: { departmentId: 'd1' } }),
    ).toBe(false);
    expect(
      isEntityUnattributed({ type: 'vendor', metadata: { owner_person_id: 'p1' } }),
    ).toBe(false);
  });

  it('служебные типы → false (не спрашиваем)', () => {
    expect(isEntityUnattributed({ type: 'person', metadata: null })).toBe(false);
    expect(isEntityUnattributed({ type: 'department', metadata: {} })).toBe(false);
    expect(isEntityUnattributed({ type: 'role', metadata: null })).toBe(false);
  });

  it('пустые значения ключей привязки не считаются привязкой', () => {
    expect(
      isEntityUnattributed({ type: 'customer', metadata: { clientId: '' } }),
    ).toBe(true);
    expect(
      isEntityUnattributed({ type: 'customer', metadata: { clientId: null } }),
    ).toBe(true);
  });
});

describe('PROBE_REASON_RECHECK — attribution.unresolved_at_ingest (Ф6)', () => {
  const reason = 'attribution.unresolved_at_ingest';

  it('contextCardKind ≠ entity → не подавляем (true)', async () => {
    const prisma = { entity: { findFirst: vi.fn() } } as unknown as PrismaService;
    const rel = await PROBE_REASON_RECHECK[reason]!({
      prisma,
      tenantId: 'org-1',
      contextCardId: 'e1',
      contextCardKind: 'card',
    });
    expect(rel).toBe(true);
  });

  it('сущность удалена → подавляем (false)', async () => {
    const prisma = {
      entity: { findFirst: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const rel = await PROBE_REASON_RECHECK[reason]!({
      prisma,
      tenantId: 'org-1',
      contextCardId: 'e1',
      contextCardKind: 'entity',
    });
    expect(rel).toBe(false);
  });

  it('появилась привязка в metadata → подавляем (false)', async () => {
    const prisma = {
      entity: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'e1',
          type: 'customer',
          metadata: { departmentId: 'd1' },
          mergedIntoId: null,
        }),
      },
      entityLink: { findFirst: vi.fn() },
    } as unknown as PrismaService;
    const rel = await PROBE_REASON_RECHECK[reason]!({
      prisma,
      tenantId: 'org-1',
      contextCardId: 'e1',
      contextCardKind: 'entity',
    });
    expect(rel).toBe(false);
  });

  it('появилось ребро привязки → подавляем (false)', async () => {
    const prisma = {
      entity: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'e1',
          type: 'customer',
          metadata: null,
          mergedIntoId: null,
        }),
      },
      entityLink: { findFirst: vi.fn().mockResolvedValue({ id: 'l1' }) },
    } as unknown as PrismaService;
    const rel = await PROBE_REASON_RECHECK[reason]!({
      prisma,
      tenantId: 'org-1',
      contextCardId: 'e1',
      contextCardKind: 'entity',
    });
    expect(rel).toBe(false);
  });

  it('всё ещё не привязана → пробел открыт (true)', async () => {
    const prisma = {
      entity: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'e1',
          type: 'customer',
          metadata: null,
          mergedIntoId: null,
        }),
      },
      entityLink: { findFirst: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const rel = await PROBE_REASON_RECHECK[reason]!({
      prisma,
      tenantId: 'org-1',
      contextCardId: 'e1',
      contextCardKind: 'entity',
    });
    expect(rel).toBe(true);
  });
});
