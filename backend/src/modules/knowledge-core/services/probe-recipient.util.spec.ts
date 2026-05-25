import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import { resolveProbeRecipients } from './probe-recipient.util';

/**
 * ТЗ 2026-05-25 «clone-reliability-hardening» Фаза 3 — unit-тесты выбора
 * получателей probe (3 сценария из §3.5 DoD).
 */

interface MockSubject {
  userId: string | null;
  primaryDepartmentId: string | null;
}
interface MockDept {
  headPerson: { id: string; userId: string | null } | null;
}
interface MockAdmin {
  userId: string;
}

function buildPrismaMock(args: {
  subject: MockSubject | null;
  dept?: MockDept | null;
  admins: MockAdmin[];
}): PrismaService {
  const personFindUnique = vi.fn().mockResolvedValue(args.subject);
  const departmentFindUnique = vi.fn().mockResolvedValue(args.dept ?? null);
  const membershipFindMany = vi.fn().mockResolvedValue(args.admins);

  return {
    person: { findUnique: personFindUnique },
    department: { findUnique: departmentFindUnique },
    membership: { findMany: membershipFindMany },
  } as unknown as PrismaService;
}

describe('resolveProbeRecipients — Фаза 3 ТЗ clone-reliability-hardening', () => {
  it('сценарий 1: глава отдела назначен и не совпадает с субъектом → возвращает userId главы', async () => {
    const prisma = buildPrismaMock({
      subject: { userId: 'user-subject', primaryDepartmentId: 'dept-1' },
      dept: { headPerson: { id: 'person-head', userId: 'user-head' } },
      admins: [{ userId: 'user-admin-1' }, { userId: 'user-admin-2' }],
    });

    const recipients = await resolveProbeRecipients({
      prisma,
      tenantId: 'org-1',
      subjectPersonId: 'person-subject',
    });

    expect(recipients).toEqual(['user-head']);
    // admins не запрашиваются, потому что глава отдела найден.
    expect((prisma.membership as unknown as { findMany: ReturnType<typeof vi.fn> }).findMany)
      .not.toHaveBeenCalled();
  });

  it('сценарий 2: глава отдела совпадает с субъектом (probe про самого главу) → fallback к admin/owner', async () => {
    const prisma = buildPrismaMock({
      subject: { userId: 'user-same', primaryDepartmentId: 'dept-1' },
      // headPerson.userId === subject.userId — нельзя слать самому себе.
      dept: { headPerson: { id: 'person-head', userId: 'user-same' } },
      admins: [{ userId: 'user-admin-1' }, { userId: 'user-admin-2' }],
    });

    const recipients = await resolveProbeRecipients({
      prisma,
      tenantId: 'org-1',
      subjectPersonId: 'person-head',
    });

    // Сам субъект исключается из списка admin'ов; остальные admin'ы — получатели.
    expect(recipients.sort()).toEqual(['user-admin-1', 'user-admin-2']);
  });

  it('сценарий 3: главы отдела нет (headPerson=null) → fallback к admin/owner', async () => {
    const prisma = buildPrismaMock({
      subject: { userId: 'user-subject', primaryDepartmentId: 'dept-1' },
      dept: { headPerson: null },
      admins: [{ userId: 'user-admin-1' }],
    });

    const recipients = await resolveProbeRecipients({
      prisma,
      tenantId: 'org-1',
      subjectPersonId: 'person-subject',
    });

    expect(recipients).toEqual(['user-admin-1']);
  });
});
