import { describe, expect, it, vi } from 'vitest';

import { PromiseCascadeService } from './promise-cascade.service';

/**
 * TZ-1 Фаза 3.C (daily-value-engine) — unit-тесты PromiseCascadeService.
 *
 * Mock Prisma, без сети/времени. Покрываем:
 *   1. просроченное обещание с зависимостью (цель адресата) → каскад.
 *   2. просроченное обещание БЕЗ зависимости → не каскад.
 *   3. обещание без автора → не каскад.
 */
describe('PromiseCascadeService', () => {
  const now = new Date('2026-06-08T10:00:00.000Z');

  function build(opts: {
    commitments?: Array<{
      id: string;
      name: string;
      criticalQuestion: string;
      commitmentDueDate: Date | null;
      commitmentStatus: string | null;
      commitmentAuthorPersonId: string | null;
      commitmentRecipientPersonId: string | null;
      commitmentAuthor: { id: string; name: string } | null;
      commitmentRecipient: { id: string; name: string; userId: string | null } | null;
    }>;
    goal?: { name: string } | null;
    assignee?: { issue: { title: string } } | null;
  }) {
    const prisma = {
      ideaBlock: {
        findMany: vi.fn().mockResolvedValue(opts.commitments ?? []),
      },
      goal: {
        findFirst: vi.fn().mockResolvedValue(opts.goal ?? null),
      },
      issueAssignee: {
        findFirst: vi.fn().mockResolvedValue(opts.assignee ?? null),
      },
    };
    const svc = new PromiseCascadeService(prisma as never);
    return { svc, prisma };
  }

  it('просроченное обещание держит цель адресата → каскад', async () => {
    const { svc } = build({
      commitments: [
        {
          id: 'c1',
          name: 'Подготовлю макет к пятнице',
          criticalQuestion: '',
          commitmentDueDate: new Date('2026-06-01T00:00:00Z'),
          commitmentStatus: 'open',
          commitmentAuthorPersonId: 'pAuthor',
          commitmentRecipientPersonId: 'pRecipient',
          commitmentAuthor: { id: 'pAuthor', name: 'Антон' },
          commitmentRecipient: { id: 'pRecipient', name: 'Маша', userId: 'u2' },
        },
      ],
      goal: { name: 'Запуск маркетинга Q3' },
    });
    const res = await svc.findCascadesForTenant({ tenantId: 't1', now });
    expect(res).toHaveLength(1);
    expect(res[0]!.authorName).toBe('Антон');
    expect(res[0]!.recipientName).toBe('Маша');
    expect(res[0]!.blockedGoalName).toBe('Запуск маркетинга Q3');
  });

  it('просроченное обещание без зависимости → не каскад', async () => {
    const { svc } = build({
      commitments: [
        {
          id: 'c1',
          name: 'Подготовлю отчёт',
          criticalQuestion: '',
          commitmentDueDate: new Date('2026-06-01T00:00:00Z'),
          commitmentStatus: 'open',
          commitmentAuthorPersonId: 'pAuthor',
          commitmentRecipientPersonId: 'pRecipient',
          commitmentAuthor: { id: 'pAuthor', name: 'Антон' },
          commitmentRecipient: { id: 'pRecipient', name: 'Маша', userId: 'u2' },
        },
      ],
      goal: null, // нет цели
      assignee: null, // нет задачи
    });
    const res = await svc.findCascadesForTenant({ tenantId: 't1', now });
    expect(res).toHaveLength(0);
  });

  it('обещание без автора (where отфильтровал бы; двойная защита) → не каскад', async () => {
    const { svc } = build({
      commitments: [
        {
          id: 'c1',
          name: 'Что-то',
          criticalQuestion: '',
          commitmentDueDate: new Date('2026-06-01T00:00:00Z'),
          commitmentStatus: 'open',
          commitmentAuthorPersonId: null,
          commitmentRecipientPersonId: 'pRecipient',
          commitmentAuthor: null,
          commitmentRecipient: { id: 'pRecipient', name: 'Маша', userId: 'u2' },
        },
      ],
      goal: { name: 'Цель' },
    });
    const res = await svc.findCascadesForTenant({ tenantId: 't1', now });
    expect(res).toHaveLength(0);
  });
});
