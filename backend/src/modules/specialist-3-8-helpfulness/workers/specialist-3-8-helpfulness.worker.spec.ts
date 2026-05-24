import { describe, expect, it } from 'vitest';

import { Specialist38HelpfulnessWorker } from './specialist-3-8-helpfulness.worker';

/**
 * SBA Wave 2 — unit-тесты для filtering логики worker'а.
 * Сам worker зависит от BullMQ + Redis; здесь — только static-инварианты.
 */
describe('Specialist38HelpfulnessWorker', () => {
  it('SPECIALIST_NAME = 3-8-helpfulness (match RouterService)', () => {
    expect(Specialist38HelpfulnessWorker.SPECIALIST_NAME).toBe(
      '3-8-helpfulness',
    );
  });

  it('ALLOWED_SIGNAL_TYPES — содержит все 7 helpfulness signal types', () => {
    expect(
      Specialist38HelpfulnessWorker.ALLOWED_SIGNAL_TYPES.has('help_provided'),
    ).toBe(true);
    expect(
      Specialist38HelpfulnessWorker.ALLOWED_SIGNAL_TYPES.has('proactive_hint'),
    ).toBe(true);
    expect(
      Specialist38HelpfulnessWorker.ALLOWED_SIGNAL_TYPES.has('mentoring'),
    ).toBe(true);
    expect(
      Specialist38HelpfulnessWorker.ALLOWED_SIGNAL_TYPES.has(
        'emotional_support',
      ),
    ).toBe(true);
    expect(
      Specialist38HelpfulnessWorker.ALLOWED_SIGNAL_TYPES.has(
        'constructive_feedback',
      ),
    ).toBe(true);
    expect(
      Specialist38HelpfulnessWorker.ALLOWED_SIGNAL_TYPES.has(
        'question_unanswered',
      ),
    ).toBe(true);
    expect(
      Specialist38HelpfulnessWorker.ALLOWED_SIGNAL_TYPES.has(
        'question_acknowledged_no_action',
      ),
    ).toBe(true);
  });

  it('ALLOWED_SIGNAL_TYPES — содержит 3 gamification signal types', () => {
    expect(
      Specialist38HelpfulnessWorker.ALLOWED_SIGNAL_TYPES.has('helped_by'),
    ).toBe(true);
    expect(
      Specialist38HelpfulnessWorker.ALLOWED_SIGNAL_TYPES.has('helped_to'),
    ).toBe(true);
    expect(
      Specialist38HelpfulnessWorker.ALLOWED_SIGNAL_TYPES.has('thanks_explicit'),
    ).toBe(true);
  });

  it('ALLOWED_SIGNAL_TYPES — содержит tracker types (task_comment, task_mention)', () => {
    expect(
      Specialist38HelpfulnessWorker.ALLOWED_SIGNAL_TYPES.has('task_comment'),
    ).toBe(true);
    expect(
      Specialist38HelpfulnessWorker.ALLOWED_SIGNAL_TYPES.has('task_mention'),
    ).toBe(true);
  });

  it('ALLOWED_SIGNAL_TYPES — НЕ содержит decision/idea/regulation', () => {
    expect(
      Specialist38HelpfulnessWorker.ALLOWED_SIGNAL_TYPES.has('decision'),
    ).toBe(false);
    expect(Specialist38HelpfulnessWorker.ALLOWED_SIGNAL_TYPES.has('idea')).toBe(
      false,
    );
    expect(
      Specialist38HelpfulnessWorker.ALLOWED_SIGNAL_TYPES.has('regulation'),
    ).toBe(false);
  });
});
