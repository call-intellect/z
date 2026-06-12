/**
 * Probe-система Фаза 2 (2026-06-11) — окно по типу пробела + recheck.
 * Детерминизм: probeWindow — чистая функция; recheck — с мок-Prisma.
 */
import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../common/prisma/prisma.service';

import {
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
