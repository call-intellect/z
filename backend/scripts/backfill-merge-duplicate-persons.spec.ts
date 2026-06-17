import { describe, expect, it } from 'vitest';

import { isWeakName, planMerge, type MergePersonInput } from './backfill-merge-duplicate-persons';

const D1 = new Date('2026-01-01');
const D2 = new Date('2026-02-01');

function person(over: Partial<MergePersonInput> & { id: string }): MergePersonInput {
  return {
    userId: null,
    name: '',
    email: 'shared@x',
    primaryDepartmentId: null,
    company: null,
    jobTitle: null,
    createdAt: D1,
    hasActiveAppointment: false,
    hasActivePersonRole: false,
    ...over,
  };
}

describe('isWeakName', () => {
  it('логин == локальная часть email → слабое', () => {
    expect(isWeakName('ainaz860707', 'ainaz860707@x')).toBe(true);
  });

  it('локальная часть email (любой ASCII-логин) → слабое', () => {
    expect(isWeakName('john.doe', 'john.doe@example.com')).toBe(true);
  });

  it('человеческое русское имя → НЕ слабое', () => {
    expect(isWeakName('Айназ', 'ainaz860707@x')).toBe(false);
  });

  it('человеческое имя с пробелом → НЕ слабое', () => {
    expect(isWeakName('Иван Петров', 'ivan@x')).toBe(false);
  });

  it('пустое имя → слабое', () => {
    expect(isWeakName('', 'ivan@x')).toBe(true);
  });
});

describe('planMerge', () => {
  it('(а) аккаунт + ручная карточка → аккаунт канонический, обогащение из ручной', () => {
    const account = person({
      id: 'acc',
      userId: 'u1',
      name: 'ainaz860707',
      email: 'ainaz860707@x',
    });
    const manual = person({
      id: 'man',
      userId: null,
      name: 'Айназ',
      email: 'ainaz860707@x',
      jobTitle: 'РОП',
      primaryDepartmentId: 'd1',
    });

    const plan = planMerge([account, manual]);
    expect('skip' in plan).toBe(false);
    if ('skip' in plan) return;

    expect(plan.canonicalId).toBe('acc');
    expect(plan.duplicateIds).toEqual(['man']);
    expect(plan.enrich.name).toBe('Айназ');
    expect(plan.enrich.jobTitle).toBe('РОП');
    expect(plan.enrich.primaryDepartmentId).toBe('d1');
  });

  it('(б) два аккаунта на email → skip multiple_accounts', () => {
    const a = person({ id: 'a', userId: 'u1', name: 'Иван', email: 'shared@x' });
    const b = person({ id: 'b', userId: 'u2', name: 'Пётр', email: 'shared@x' });

    const plan = planMerge([a, b]);
    expect('skip' in plan).toBe(true);
    if (!('skip' in plan)) return;
    expect(plan.skip).toBe('multiple_accounts');
  });

  it('(в) ноль аккаунтов, две ручные с разным createdAt → канонической становится старейшая', () => {
    const older = person({ id: 'old', createdAt: D1 });
    const newer = person({ id: 'new', createdAt: D2 });

    const plan = planMerge([newer, older]);
    expect('skip' in plan).toBe(false);
    if ('skip' in plan) return;
    expect(plan.canonicalId).toBe('old');
    expect(plan.duplicateIds).toEqual(['new']);
  });

  it('(г) у канонической уже есть активная должность → дубльную НЕ переносим', () => {
    const account = person({
      id: 'acc',
      userId: 'u1',
      name: 'Иван',
      hasActiveAppointment: true,
    });
    const manual = person({ id: 'man', userId: null, name: 'Иван', hasActiveAppointment: true });

    const plan = planMerge([account, manual]);
    if ('skip' in plan) throw new Error('не должно быть skip');
    expect(plan.moveAppointmentFrom).toEqual([]);
  });

  it('(д) у канонической нет активной должности, у дубля есть → переносим', () => {
    const account = person({
      id: 'acc',
      userId: 'u1',
      name: 'Иван',
      hasActiveAppointment: false,
    });
    const manual = person({ id: 'man', userId: null, name: 'Иван', hasActiveAppointment: true });

    const plan = planMerge([account, manual]);
    if ('skip' in plan) throw new Error('не должно быть skip');
    expect(plan.moveAppointmentFrom).toEqual(['man']);
  });
});
