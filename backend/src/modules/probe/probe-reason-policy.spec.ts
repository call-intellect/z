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
    expect(probeWindow('task.assignee_unresolved')).toBe('immediate');
    expect(probeWindow('consistency_violation.R3')).toBe('immediate');
    expect(probeWindow('kr_checkpoint_suggested')).toBe('immediate');
  });

  it('deferrable для прочих reason и по умолчанию', () => {
    expect(probeWindow('idea.status_unclear')).toBe('deferrable');
    expect(probeWindow('card.outdated_summary')).toBe('deferrable');
    expect(probeWindow('unknown.x')).toBe('deferrable');
  });

  it('Ф5 — task.poorly_specified / task.false_positive — immediate', () => {
    expect(probeWindow('task.poorly_specified')).toBe('immediate');
    expect(probeWindow('task.false_positive')).toBe('immediate');
  });
});

describe('PROBE_REASON_RECHECK', () => {
  it('idea.status_unclear: идея зависла в обсуждении → пробел открыт (true)', async () => {
    const prisma = {
      idea: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ status: 'in_discussion', statusChangedAt: null }),
      },
    } as unknown as PrismaService;
    const rel = await PROBE_REASON_RECHECK['idea.status_unclear']!({
      prisma,
      tenantId: 'org-1',
      contextCardId: 'idea-1',
      contextCardKind: 'idea',
    });
    expect(rel).toBe(true);
  });

  it('idea.status_unclear: статус сменён → пробел закрыт (false)', async () => {
    const prisma = {
      idea: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ status: 'accepted', statusChangedAt: new Date() }),
      },
    } as unknown as PrismaService;
    const rel = await PROBE_REASON_RECHECK['idea.status_unclear']!({
      prisma,
      tenantId: 'org-1',
      contextCardId: 'idea-1',
      contextCardKind: 'idea',
    });
    expect(rel).toBe(false);
  });

  it('сущность удалена (null) → подавляем (false)', async () => {
    const prisma = {
      idea: { findFirst: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const rel = await PROBE_REASON_RECHECK['idea.status_unclear']!({
      prisma,
      tenantId: 'org-1',
      contextCardId: 'idea-x',
      contextCardKind: 'idea',
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

describe('PROBE_REASON_RECHECK — task.assignee_unresolved (intake_issue, Блок A Ф5)', () => {
  const reason = 'task.assignee_unresolved';

  it('intake без исполнителя + pending → пробел открыт (true)', async () => {
    const prisma = {
      intakeIssue: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ suggestedAssigneeId: null, status: 'pending' }),
      },
    } as unknown as PrismaService;
    const rel = await PROBE_REASON_RECHECK[reason]!({
      prisma,
      tenantId: 'org-1',
      contextCardId: 'ii-1',
      contextCardKind: 'intake_issue',
    });
    expect(rel).toBe(true);
  });

  it('intake исполнитель назначен → пробел закрыт (false)', async () => {
    const prisma = {
      intakeIssue: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ suggestedAssigneeId: 'u-1', status: 'pending' }),
      },
    } as unknown as PrismaService;
    const rel = await PROBE_REASON_RECHECK[reason]!({
      prisma,
      tenantId: 'org-1',
      contextCardId: 'ii-1',
      contextCardKind: 'intake_issue',
    });
    expect(rel).toBe(false);
  });

  it('intake уже не pending (accepted) → пробел закрыт (false)', async () => {
    const prisma = {
      intakeIssue: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ suggestedAssigneeId: null, status: 'accepted' }),
      },
    } as unknown as PrismaService;
    const rel = await PROBE_REASON_RECHECK[reason]!({
      prisma,
      tenantId: 'org-1',
      contextCardId: 'ii-1',
      contextCardKind: 'intake_issue',
    });
    expect(rel).toBe(false);
  });

  it('intake не найден → подавляем (false)', async () => {
    const prisma = {
      intakeIssue: { findFirst: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const rel = await PROBE_REASON_RECHECK[reason]!({
      prisma,
      tenantId: 'org-1',
      contextCardId: 'ii-1',
      contextCardKind: 'intake_issue',
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

describe('PROBE_REASON_RECHECK — task.poorly_specified (Ф5)', () => {
  const reason = 'task.poorly_specified';

  it('нет contextCardId → не подавляем (true)', async () => {
    const prisma = {
      intakeIssue: { findFirst: vi.fn() },
    } as unknown as PrismaService;
    const rel = await PROBE_REASON_RECHECK[reason]!({
      prisma,
      tenantId: 'org-1',
      contextCardId: null,
      contextCardKind: 'intake_issue',
    });
    expect(rel).toBe(true);
  });

  it('intake pending с коротким описанием → пробел открыт (true)', async () => {
    const prisma = {
      intakeIssue: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ extractedDescription: 'ок', status: 'pending' }),
      },
    } as unknown as PrismaService;
    const rel = await PROBE_REASON_RECHECK[reason]!({
      prisma,
      tenantId: 'org-1',
      contextCardId: 'ii-1',
      contextCardKind: 'intake_issue',
    });
    expect(rel).toBe(true);
  });

  it('intake pending с подробным описанием → пробел закрыт (false)', async () => {
    const prisma = {
      intakeIssue: {
        findFirst: vi.fn().mockResolvedValue({
          extractedDescription: 'подробное описание задачи',
          status: 'pending',
        }),
      },
    } as unknown as PrismaService;
    const rel = await PROBE_REASON_RECHECK[reason]!({
      prisma,
      tenantId: 'org-1',
      contextCardId: 'ii-1',
      contextCardKind: 'intake_issue',
    });
    expect(rel).toBe(false);
  });

  it('intake уже не pending → пробел закрыт (false)', async () => {
    const prisma = {
      intakeIssue: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ extractedDescription: '', status: 'accepted' }),
      },
    } as unknown as PrismaService;
    const rel = await PROBE_REASON_RECHECK[reason]!({
      prisma,
      tenantId: 'org-1',
      contextCardId: 'ii-1',
      contextCardKind: 'intake_issue',
    });
    expect(rel).toBe(false);
  });

  it('intake не найден → подавляем (false)', async () => {
    const prisma = {
      intakeIssue: { findFirst: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const rel = await PROBE_REASON_RECHECK[reason]!({
      prisma,
      tenantId: 'org-1',
      contextCardId: 'ii-1',
      contextCardKind: 'intake_issue',
    });
    expect(rel).toBe(false);
  });
});

describe('PROBE_REASON_RECHECK — task.false_positive (Ф5)', () => {
  const reason = 'task.false_positive';

  it('нет contextCardId → не подавляем (true)', async () => {
    const prisma = {
      intakeIssue: { findFirst: vi.fn() },
    } as unknown as PrismaService;
    const rel = await PROBE_REASON_RECHECK[reason]!({
      prisma,
      tenantId: 'org-1',
      contextCardId: null,
      contextCardKind: 'intake_issue',
    });
    expect(rel).toBe(true);
  });

  it('intake ещё pending → пробел открыт (true)', async () => {
    const prisma = {
      intakeIssue: {
        findFirst: vi.fn().mockResolvedValue({ status: 'pending' }),
      },
    } as unknown as PrismaService;
    const rel = await PROBE_REASON_RECHECK[reason]!({
      prisma,
      tenantId: 'org-1',
      contextCardId: 'ii-1',
      contextCardKind: 'intake_issue',
    });
    expect(rel).toBe(true);
  });

  it('intake уже не pending → пробел закрыт (false)', async () => {
    const prisma = {
      intakeIssue: {
        findFirst: vi.fn().mockResolvedValue({ status: 'rejected' }),
      },
    } as unknown as PrismaService;
    const rel = await PROBE_REASON_RECHECK[reason]!({
      prisma,
      tenantId: 'org-1',
      contextCardId: 'ii-1',
      contextCardKind: 'intake_issue',
    });
    expect(rel).toBe(false);
  });

  it('issue не удалён → пробел открыт (true)', async () => {
    const prisma = {
      issue: { findFirst: vi.fn().mockResolvedValue({ id: 'i1' }) },
    } as unknown as PrismaService;
    const rel = await PROBE_REASON_RECHECK[reason]!({
      prisma,
      tenantId: 'org-1',
      contextCardId: 'i1',
      contextCardKind: 'issue',
    });
    expect(rel).toBe(true);
  });

  it('issue удалён (не найден) → пробел закрыт (false)', async () => {
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
});

describe('resolveProbeProvenance (центральный гейт политики)', () => {
  it('regulation.* больше не разрешает провенанс → unknown', async () => {
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
    expect(p).toBe('unknown');
  });

  it('reason вне семьи regulation → unknown', async () => {
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
    expect(MACHINE_FILLABLE_REASONS.has('card.merge_suggestion')).toBe(true);
    expect(MACHINE_FILLABLE_REASONS.has('experiment.no_owner')).toBe(true);
    expect(
      MACHINE_FILLABLE_REASONS.has('process_template.step_without_owner'),
    ).toBe(true);
  });

  it('НЕ содержит regulation / attribution / decision', () => {
    expect(MACHINE_FILLABLE_REASONS.has('regulation.missing_owner')).toBe(false);
    expect(
      MACHINE_FILLABLE_REASONS.has('attribution.unresolved_at_ingest'),
    ).toBe(false);
    expect(MACHINE_FILLABLE_REASONS.has('decision.missing_decider')).toBe(false);
    expect(MACHINE_FILLABLE_REASONS.has('decision.overdue')).toBe(false);
  });
});
