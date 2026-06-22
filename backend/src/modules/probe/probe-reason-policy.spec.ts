import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../common/prisma/prisma.service';

import {
  isEntityUnattributed,
  MACHINE_FILLABLE_REASONS,
  PROBE_REASON_RECHECK,
  probeWindow,
  resolveProbeProvenance,
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

describe('PROBE_REASON_RECHECK — task.assignee_unresolved (Блок A Ф1)', () => {
  const reason = 'task.assignee_unresolved';

  it('нет contextCardId → не подавляем (true)', async () => {
    const prisma = { issue: { findFirst: vi.fn() } } as unknown as PrismaService;
    const rel = await PROBE_REASON_RECHECK[reason]!({
      prisma,
      tenantId: 'org-1',
      contextCardId: null,
      contextCardKind: 'issue',
    });
    expect(rel).toBe(true);
  });

  it('задача не найдена → подавляем (false)', async () => {
    const prisma = {
      issue: { findFirst: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const rel = await PROBE_REASON_RECHECK[reason]!({
      prisma,
      tenantId: 'org-1',
      contextCardId: 'i1',
      contextCardKind: 'issue',
    });
    expect(rel).toBe(false);
  });

  it('исполнителей нет (assignees=[]) → пробел открыт (true)', async () => {
    const prisma = {
      issue: { findFirst: vi.fn().mockResolvedValue({ assignees: [] }) },
    } as unknown as PrismaService;
    const rel = await PROBE_REASON_RECHECK[reason]!({
      prisma,
      tenantId: 'org-1',
      contextCardId: 'i1',
      contextCardKind: 'issue',
    });
    expect(rel).toBe(true);
  });

  it('исполнитель назначен → пробел закрыт (false)', async () => {
    const prisma = {
      issue: {
        findFirst: vi.fn().mockResolvedValue({ assignees: [{ id: 'a1' }] }),
      },
    } as unknown as PrismaService;
    const rel = await PROBE_REASON_RECHECK[reason]!({
      prisma,
      tenantId: 'org-1',
      contextCardId: 'i1',
      contextCardKind: 'issue',
    });
    expect(rel).toBe(false);
  });
});

describe('PROBE_REASON_RECHECK — task.due_date_missing (Блок A Ф1)', () => {
  const reason = 'task.due_date_missing';

  it('нет contextCardId → не подавляем (true)', async () => {
    const prisma = { issue: { findFirst: vi.fn() } } as unknown as PrismaService;
    const rel = await PROBE_REASON_RECHECK[reason]!({
      prisma,
      tenantId: 'org-1',
      contextCardId: null,
      contextCardKind: 'issue',
    });
    expect(rel).toBe(true);
  });

  it('задача не найдена → подавляем (false)', async () => {
    const prisma = {
      issue: { findFirst: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const rel = await PROBE_REASON_RECHECK[reason]!({
      prisma,
      tenantId: 'org-1',
      contextCardId: 'i1',
      contextCardKind: 'issue',
    });
    expect(rel).toBe(false);
  });

  it('срок не указан (dueDate=null) → пробел открыт (true)', async () => {
    const prisma = {
      issue: { findFirst: vi.fn().mockResolvedValue({ dueDate: null }) },
    } as unknown as PrismaService;
    const rel = await PROBE_REASON_RECHECK[reason]!({
      prisma,
      tenantId: 'org-1',
      contextCardId: 'i1',
      contextCardKind: 'issue',
    });
    expect(rel).toBe(true);
  });

  it('срок указан (dueDate=Date) → пробел закрыт (false)', async () => {
    const prisma = {
      issue: {
        findFirst: vi.fn().mockResolvedValue({ dueDate: new Date() }),
      },
    } as unknown as PrismaService;
    const rel = await PROBE_REASON_RECHECK[reason]!({
      prisma,
      tenantId: 'org-1',
      contextCardId: 'i1',
      contextCardKind: 'issue',
    });
    expect(rel).toBe(false);
  });
});

describe('resolveProbeProvenance (центральный гейт политики)', () => {
  it('regulation.missing_owner: sourceBlockIds непуст, version null, нет curation → auto_unconfirmed', async () => {
    const prisma = {
      regulation: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ sourceBlockIds: ['b1'], currentVersion: null }),
      },
      curationItem: { findFirst: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const p = await resolveProbeProvenance('regulation.missing_owner', {
      prisma,
      tenantId: 'org-1',
      contextCardId: 'r1',
      contextCardKind: 'regulation',
    });
    expect(p).toBe('auto_unconfirmed');
  });

  it('currentVersion.trustTier=human → confirmed_or_manual', async () => {
    const prisma = {
      regulation: {
        findFirst: vi.fn().mockResolvedValue({
          sourceBlockIds: ['b1'],
          currentVersion: { trustTier: 'human' },
        }),
      },
      curationItem: { findFirst: vi.fn() },
    } as unknown as PrismaService;
    const p = await resolveProbeProvenance('regulation.missing_owner', {
      prisma,
      tenantId: 'org-1',
      contextCardId: 'r1',
      contextCardKind: 'regulation',
    });
    expect(p).toBe('confirmed_or_manual');
  });

  it('открытый CurationItem (pending) при sourceBlockIds=[] → auto_unconfirmed', async () => {
    const prisma = {
      process: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ sourceBlockIds: [], currentVersion: null }),
      },
      curationItem: { findFirst: vi.fn().mockResolvedValue({ id: 'ci-1' }) },
    } as unknown as PrismaService;
    const p = await resolveProbeProvenance('regulation.missing_owner', {
      prisma,
      tenantId: 'org-1',
      contextCardId: 'p1',
      contextCardKind: 'process',
    });
    expect(p).toBe('auto_unconfirmed');
  });

  it('карточка не найдена → unknown', async () => {
    const prisma = {
      regulation: { findFirst: vi.fn().mockResolvedValue(null) },
      curationItem: { findFirst: vi.fn() },
    } as unknown as PrismaService;
    const p = await resolveProbeProvenance('regulation.missing_owner', {
      prisma,
      tenantId: 'org-1',
      contextCardId: 'r1',
      contextCardKind: 'regulation',
    });
    expect(p).toBe('unknown');
  });

  it('нет contextCardId → unknown', async () => {
    const prisma = {
      regulation: { findFirst: vi.fn() },
    } as unknown as PrismaService;
    const p = await resolveProbeProvenance('regulation.missing_owner', {
      prisma,
      tenantId: 'org-1',
      contextCardId: null,
      contextCardKind: 'regulation',
    });
    expect(p).toBe('unknown');
  });

  it('reason не из семьи regulation (decision.missing_decider) → unknown', async () => {
    const prisma = {
      regulation: { findFirst: vi.fn() },
    } as unknown as PrismaService;
    const p = await resolveProbeProvenance('decision.missing_decider', {
      prisma,
      tenantId: 'org-1',
      contextCardId: 'd1',
      contextCardKind: 'decision',
    });
    expect(p).toBe('unknown');
  });
});

describe('MACHINE_FILLABLE_REASONS (защита human-only)', () => {
  it('содержит машинно-закрываемые gap-reason', () => {
    expect(MACHINE_FILLABLE_REASONS.has('regulation.missing_owner')).toBe(true);
    expect(MACHINE_FILLABLE_REASONS.has('regulation.process_no_steps')).toBe(
      true,
    );
    expect(MACHINE_FILLABLE_REASONS.has('regulation.scope_unclear')).toBe(true);
  });

  it('НЕ содержит attribution / decision / commitment (human-only)', () => {
    expect(
      MACHINE_FILLABLE_REASONS.has('attribution.unresolved_at_ingest'),
    ).toBe(false);
    expect(MACHINE_FILLABLE_REASONS.has('decision.missing_decider')).toBe(false);
    expect(MACHINE_FILLABLE_REASONS.has('decision.overdue')).toBe(false);
    expect(MACHINE_FILLABLE_REASONS.has('commitment.followup')).toBe(false);
    expect(MACHINE_FILLABLE_REASONS.has('commitment.silence_escalation')).toBe(
      false,
    );
  });
});
