import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import { resolveProbeRecipients } from './probe-recipient.util';

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

describe('resolveProbeRecipients — старое поведение (флаг OFF)', () => {
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
      subjectAddressingEnabled: false,
    });

    expect(recipients).toEqual(['user-head']);
    expect(
      (prisma.membership as unknown as { findMany: ReturnType<typeof vi.fn> }).findMany,
    ).not.toHaveBeenCalled();
  });

  it('сценарий 2: глава отдела совпадает с субъектом (probe про самого главу) → fallback к admin/owner', async () => {
    const prisma = buildPrismaMock({
      subject: { userId: 'user-same', primaryDepartmentId: 'dept-1' },
      dept: { headPerson: { id: 'person-head', userId: 'user-same' } },
      admins: [{ userId: 'user-admin-1' }, { userId: 'user-admin-2' }],
    });

    const recipients = await resolveProbeRecipients({
      prisma,
      tenantId: 'org-1',
      subjectPersonId: 'person-head',
      subjectAddressingEnabled: false,
    });

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
      subjectAddressingEnabled: false,
    });

    expect(recipients).toEqual(['user-admin-1']);
  });

  it('флаг undefined (не передан) ≡ OFF: глава-only, субъекту probe не шлётся', async () => {
    const prisma = buildPrismaMock({
      subject: { userId: 'user-subject', primaryDepartmentId: 'dept-1' },
      dept: { headPerson: { id: 'person-head', userId: 'user-head' } },
      admins: [{ userId: 'user-admin-1' }],
    });

    const recipients = await resolveProbeRecipients({
      prisma,
      tenantId: 'org-1',
      subjectPersonId: 'person-subject',
    });

    expect(recipients).toEqual(['user-head']);
    expect(recipients).not.toContain('user-subject');
  });
});

describe('resolveProbeRecipients — само-подтверждение субъектом (флаг ON, cabinet-leftovers §3)', () => {
  it('ON + есть глава: субъект ПЕРВЫМ, затем глава, затем admins', async () => {
    const prisma = buildPrismaMock({
      subject: { userId: 'user-subject', primaryDepartmentId: 'dept-1' },
      dept: { headPerson: { id: 'person-head', userId: 'user-head' } },
      admins: [{ userId: 'user-admin-1' }, { userId: 'user-admin-2' }],
    });

    const recipients = await resolveProbeRecipients({
      prisma,
      tenantId: 'org-1',
      subjectPersonId: 'person-subject',
      subjectAddressingEnabled: true,
    });

    expect(recipients).toEqual(['user-subject', 'user-head', 'user-admin-1', 'user-admin-2']);
    expect(recipients[0]).toBe('user-subject');
  });

  it('ON + нет главы: [subject.userId, ...admins(excl subject)]', async () => {
    const prisma = buildPrismaMock({
      subject: { userId: 'user-subject', primaryDepartmentId: 'dept-1' },
      dept: { headPerson: null },
      admins: [{ userId: 'user-subject' }, { userId: 'user-admin-1' }],
    });

    const recipients = await resolveProbeRecipients({
      prisma,
      tenantId: 'org-1',
      subjectPersonId: 'person-subject',
      subjectAddressingEnabled: true,
    });

    expect(recipients).toEqual(['user-subject', 'user-admin-1']);
    expect(recipients[0]).toBe('user-subject');
  });

  it('ON + у субъекта нет userId: начинается с главы/admins, без падения', async () => {
    const prisma = buildPrismaMock({
      subject: { userId: null, primaryDepartmentId: 'dept-1' },
      dept: { headPerson: { id: 'person-head', userId: 'user-head' } },
      admins: [{ userId: 'user-admin-1' }],
    });

    const recipients = await resolveProbeRecipients({
      prisma,
      tenantId: 'org-1',
      subjectPersonId: 'person-subject',
      subjectAddressingEnabled: true,
    });

    expect(recipients).toEqual(['user-head', 'user-admin-1']);
    expect(recipients[0]).toBe('user-head');
  });

  it('ON + дедуп: subject.userId совпадает с admin → не дублируется (subject первым)', async () => {
    const prisma = buildPrismaMock({
      subject: { userId: 'user-subject', primaryDepartmentId: null },
      admins: [{ userId: 'user-subject' }, { userId: 'user-admin-1' }],
    });

    const recipients = await resolveProbeRecipients({
      prisma,
      tenantId: 'org-1',
      subjectPersonId: 'person-subject',
      subjectAddressingEnabled: true,
    });

    expect(recipients).toEqual(['user-subject', 'user-admin-1']);
    expect(recipients.filter((r) => r === 'user-subject')).toHaveLength(1);
  });

  it('ON + глава == субъект: глава не дублирует субъекта, дальше admins', async () => {
    const prisma = buildPrismaMock({
      subject: { userId: 'user-same', primaryDepartmentId: 'dept-1' },
      dept: { headPerson: { id: 'person-head', userId: 'user-same' } },
      admins: [{ userId: 'user-admin-1' }],
    });

    const recipients = await resolveProbeRecipients({
      prisma,
      tenantId: 'org-1',
      subjectPersonId: 'person-head',
      subjectAddressingEnabled: true,
    });

    expect(recipients).toEqual(['user-same', 'user-admin-1']);
  });
});
