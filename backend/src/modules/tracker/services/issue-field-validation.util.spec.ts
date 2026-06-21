import { describe, expect, it } from 'vitest';

import {
  validateIssueFieldValue,
  type IssueFieldConfig,
} from './issue-field-validation.util';

const NO_CONFIG: IssueFieldConfig = {};
const SELECT_CONFIG: IssueFieldConfig = {
  options: [
    { id: 'low', name: 'Низкий' },
    { id: 'high', name: 'Высокий' },
  ],
};

describe('validateIssueFieldValue', () => {
  it('null/undefined → ok (очистка значения)', () => {
    expect(validateIssueFieldValue('text', NO_CONFIG, null).ok).toBe(true);
    expect(validateIssueFieldValue('number', NO_CONFIG, undefined).ok).toBe(
      true,
    );
  });

  it('text: строка ok, число → 400', () => {
    expect(validateIssueFieldValue('text', NO_CONFIG, 'привет').ok).toBe(true);
    const bad = validateIssueFieldValue('text', NO_CONFIG, 42);
    expect(bad.ok).toBe(false);
    expect(bad.reason).toBe('expected_string');
  });

  it('number: число ok, строка → 400, NaN → 400', () => {
    expect(validateIssueFieldValue('number', NO_CONFIG, 12.5).ok).toBe(true);
    expect(validateIssueFieldValue('number', NO_CONFIG, '12').ok).toBe(false);
    expect(validateIssueFieldValue('number', NO_CONFIG, NaN).ok).toBe(false);
  });

  it('checkbox: boolean ok, иначе 400', () => {
    expect(validateIssueFieldValue('checkbox', NO_CONFIG, true).ok).toBe(true);
    expect(validateIssueFieldValue('checkbox', NO_CONFIG, 'true').ok).toBe(
      false,
    );
  });

  it('date: ISO ok, мусор → 400', () => {
    expect(
      validateIssueFieldValue('date', NO_CONFIG, '2026-06-21').ok,
    ).toBe(true);
    expect(
      validateIssueFieldValue('date', NO_CONFIG, '2026-06-21T10:00:00Z').ok,
    ).toBe(true);
    const bad = validateIssueFieldValue('date', NO_CONFIG, '21.06.2026');
    expect(bad.ok).toBe(false);
    expect(bad.reason).toBe('invalid_date');
  });

  it('url: http(s) ok, без схемы → 400', () => {
    expect(
      validateIssueFieldValue('url', NO_CONFIG, 'https://kora.ru').ok,
    ).toBe(true);
    const bad = validateIssueFieldValue('url', NO_CONFIG, 'kora.ru');
    expect(bad.ok).toBe(false);
    expect(bad.reason).toBe('invalid_url');
  });

  it('selectSingle: значение из options ok, иначе → 400', () => {
    expect(
      validateIssueFieldValue('selectSingle', SELECT_CONFIG, 'low').ok,
    ).toBe(true);
    const bad = validateIssueFieldValue('selectSingle', SELECT_CONFIG, 'mid');
    expect(bad.ok).toBe(false);
    expect(bad.reason).toBe('option_not_in_config');
  });

  it('status: ведёт себя как selectSingle (значение ∈ options)', () => {
    expect(validateIssueFieldValue('status', SELECT_CONFIG, 'high').ok).toBe(
      true,
    );
    expect(validateIssueFieldValue('status', SELECT_CONFIG, 'x').ok).toBe(
      false,
    );
  });

  it('selectMulti: массив id из options ok, посторонний id → 400', () => {
    expect(
      validateIssueFieldValue('selectMulti', SELECT_CONFIG, ['low', 'high']).ok,
    ).toBe(true);
    const bad = validateIssueFieldValue('selectMulti', SELECT_CONFIG, [
      'low',
      'mid',
    ]);
    expect(bad.ok).toBe(false);
    expect(bad.reason).toBe('option_not_in_config');
    expect(
      validateIssueFieldValue('selectMulti', SELECT_CONFIG, 'low').ok,
    ).toBe(false);
  });

  it('person: непустая строка (userId) ok, пустая → 400', () => {
    expect(validateIssueFieldValue('person', NO_CONFIG, 'user_1').ok).toBe(
      true,
    );
    expect(validateIssueFieldValue('person', NO_CONFIG, '').ok).toBe(false);
  });
});
