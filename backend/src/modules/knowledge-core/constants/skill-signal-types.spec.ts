import { describe, expect, it } from 'vitest';

import {
  SKILL_SUBJECT_SIGNAL_TYPES,
  SKILL_SUBJECT_SIGNAL_TYPE_SET,
} from './skill-signal-types';

describe('SKILL_SUBJECT_SIGNAL_TYPES', () => {
  it('содержит ровно reasoning/rationale/decision_basis/methodology_step', () => {
    expect(SKILL_SUBJECT_SIGNAL_TYPES).toHaveLength(4);
    expect(SKILL_SUBJECT_SIGNAL_TYPES).toContain('reasoning');
    expect(SKILL_SUBJECT_SIGNAL_TYPES).toContain('rationale');
    expect(SKILL_SUBJECT_SIGNAL_TYPES).toContain('decision_basis');
    expect(SKILL_SUBJECT_SIGNAL_TYPES).toContain('methodology_step');
  });

  it('Set знает methodology_step и не знает fact', () => {
    expect(SKILL_SUBJECT_SIGNAL_TYPE_SET.has('methodology_step')).toBe(true);
    expect(SKILL_SUBJECT_SIGNAL_TYPE_SET.has('fact')).toBe(false);
  });
});
