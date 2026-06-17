import { describe, expect, it } from 'vitest';

import {
  completeCommitmentWhere,
  incompleteCommitmentReason,
  incompleteCommitmentReasonText,
  isCompleteCommitment,
} from './commitment-completeness';

const DUE = new Date('2026-06-01T00:00:00Z');

describe('isCompleteCommitment — таблица кейсов', () => {
  const cases: Array<{
    name: string;
    author: string | null;
    recipient: string | null;
    due: Date | null;
    expected: boolean;
  }> = [
    { name: 'автор + адресат + срок', author: 'a', recipient: 'r', due: DUE, expected: true },
    { name: 'автор + адресат (без срока)', author: 'a', recipient: 'r', due: null, expected: true },
    { name: 'автор + срок (без адресата)', author: 'a', recipient: null, due: DUE, expected: true },
    {
      name: 'автор, но ни адресата, ни срока',
      author: 'a',
      recipient: null,
      due: null,
      expected: false,
    },
    {
      name: 'нет автора (но есть адресат+срок)',
      author: null,
      recipient: 'r',
      due: DUE,
      expected: false,
    },
    {
      name: 'нет автора (есть только срок)',
      author: null,
      recipient: null,
      due: DUE,
      expected: false,
    },
    {
      name: 'нет автора (есть только адресат)',
      author: null,
      recipient: 'r',
      due: null,
      expected: false,
    },
    { name: 'пусто всё', author: null, recipient: null, due: null, expected: false },
  ];

  for (const c of cases) {
    it(`${c.name} → ${c.expected ? 'полное' : 'неполное'}`, () => {
      expect(
        isCompleteCommitment({
          commitmentAuthorPersonId: c.author,
          commitmentRecipientPersonId: c.recipient,
          commitmentDueDate: c.due,
        }),
      ).toBe(c.expected);
    });
  }
});

describe('completeCommitmentWhere — синхронность с canon', () => {
  it('требует автора и OR(адресат, срок)', () => {
    const where = completeCommitmentWhere();
    expect(where.commitmentAuthorPersonId).toEqual({ not: null });
    expect(where.OR).toEqual([
      { commitmentRecipientPersonId: { not: null } },
      { commitmentDueDate: { not: null } },
    ]);
  });
});

describe('incompleteCommitmentReason', () => {
  it('нет автора → no_author', () => {
    expect(
      incompleteCommitmentReason({
        commitmentAuthorPersonId: null,
        commitmentRecipientPersonId: 'r',
        commitmentDueDate: DUE,
      }),
    ).toBe('no_author');
  });

  it('автор есть, но ни адресата, ни срока → no_recipient_and_due', () => {
    expect(
      incompleteCommitmentReason({
        commitmentAuthorPersonId: 'a',
        commitmentRecipientPersonId: null,
        commitmentDueDate: null,
      }),
    ).toBe('no_recipient_and_due');
  });

  it('полное обещание → null', () => {
    expect(
      incompleteCommitmentReason({
        commitmentAuthorPersonId: 'a',
        commitmentRecipientPersonId: 'r',
        commitmentDueDate: null,
      }),
    ).toBeNull();
  });
});

describe('incompleteCommitmentReasonText — RU без английских слов', () => {
  it('no_author', () => {
    expect(incompleteCommitmentReasonText('no_author')).toBe('не определён автор обещания');
  });
  it('no_recipient_and_due', () => {
    expect(incompleteCommitmentReasonText('no_recipient_and_due')).toBe(
      'не назначен ответственный и нет срока',
    );
  });
});
