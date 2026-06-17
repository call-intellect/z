import { describe, expect, it } from 'vitest';

import {
  isCascadeCritical,
  isCommitmentOverdue,
  selectCascadeCritical,
  type CommitmentForCascade,
} from './promise-cascade.scoring';

const NOW = new Date('2026-06-08T10:00:00.000Z');

function commitment(over: Partial<CommitmentForCascade> = {}): CommitmentForCascade {
  return {
    id: 'c1',
    authorPersonId: 'pAuthor',
    recipientPersonId: 'pRecipient',
    dueDate: new Date('2026-06-01T00:00:00.000Z'),
    status: 'open',
    hasOutgoingDependency: true,
    ...over,
  };
}

describe('promise-cascade.scoring', () => {
  describe('isCommitmentOverdue', () => {
    it('dueDate в прошлом + статус open → overdue', () => {
      expect(
        isCommitmentOverdue({ dueDate: new Date('2026-06-01T00:00:00Z'), status: 'open' }, NOW),
      ).toBe(true);
    });
    it('dueDate в будущем → не overdue', () => {
      expect(
        isCommitmentOverdue({ dueDate: new Date('2026-06-20T00:00:00Z'), status: 'open' }, NOW),
      ).toBe(false);
    });
    it('fulfilled → не overdue (закрыто)', () => {
      expect(
        isCommitmentOverdue(
          { dueDate: new Date('2026-06-01T00:00:00Z'), status: 'fulfilled' },
          NOW,
        ),
      ).toBe(false);
    });
    it('нет dueDate → не overdue', () => {
      expect(isCommitmentOverdue({ dueDate: null, status: 'open' }, NOW)).toBe(false);
    });
    it('asked тоже считается висящим', () => {
      expect(
        isCommitmentOverdue({ dueDate: new Date('2026-06-01T00:00:00Z'), status: 'asked' }, NOW),
      ).toBe(true);
    });
  });

  describe('isCascadeCritical', () => {
    it('просрочено + автор + зависимость → критический каскад', () => {
      expect(isCascadeCritical(commitment(), NOW)).toBe(true);
    });
    it('нет автора → не каскад (нет адресности)', () => {
      expect(isCascadeCritical(commitment({ authorPersonId: null }), NOW)).toBe(false);
    });
    it('нет исходящей зависимости → не каскад', () => {
      expect(isCascadeCritical(commitment({ hasOutgoingDependency: false }), NOW)).toBe(false);
    });
    it('не просрочено → не каскад', () => {
      expect(
        isCascadeCritical(commitment({ dueDate: new Date('2026-06-20T00:00:00Z') }), NOW),
      ).toBe(false);
    });
  });

  describe('selectCascadeCritical', () => {
    it('фильтрует только критические каскады', () => {
      const list = [
        commitment({ id: 'crit' }),
        commitment({ id: 'no-author', authorPersonId: null }),
        commitment({ id: 'no-dep', hasOutgoingDependency: false }),
        commitment({
          id: 'future',
          dueDate: new Date('2026-07-01T00:00:00Z'),
        }),
      ];
      const out = selectCascadeCritical(list, NOW);
      expect(out.map((c) => c.id)).toEqual(['crit']);
    });
  });
});
