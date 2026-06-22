import type { SignalType } from '@prisma/client';

export const SKILL_SUBJECT_SIGNAL_TYPES: readonly SignalType[] = [
  'reasoning',
  'rationale',
  'decision_basis',
  'methodology_step',
];

export const SKILL_SUBJECT_SIGNAL_TYPE_SET: ReadonlySet<string> = new Set(
  SKILL_SUBJECT_SIGNAL_TYPES,
);
