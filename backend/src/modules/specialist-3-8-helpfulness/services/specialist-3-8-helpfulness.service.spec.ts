import { describe, expect, it } from 'vitest';

import {
  ALLOWED_TRAIT_TYPES,
  PRIVATE_TRAIT_TYPES,
  Specialist38HelpfulnessService,
} from './specialist-3-8-helpfulness.service';

/**
 * SBA Wave 2 — unit-тесты для Specialist 3.8 (Helpfulness Agent).
 * Этическая защита: фокус на isValidTraitType и defaultVisibilityFor.
 */
describe('Specialist38HelpfulnessService', () => {
  describe('isValidTraitType', () => {
    it('возвращает true для всех 7 валидных traitType', () => {
      for (const t of ALLOWED_TRAIT_TYPES) {
        expect(Specialist38HelpfulnessService.isValidTraitType(t)).toBe(true);
      }
    });

    it('возвращает false для невалидных значений', () => {
      expect(Specialist38HelpfulnessService.isValidTraitType('foo')).toBe(
        false,
      );
      expect(Specialist38HelpfulnessService.isValidTraitType('')).toBe(false);
      expect(Specialist38HelpfulnessService.isValidTraitType(null)).toBe(false);
      expect(Specialist38HelpfulnessService.isValidTraitType(undefined)).toBe(
        false,
      );
      expect(Specialist38HelpfulnessService.isValidTraitType(123)).toBe(false);
      expect(Specialist38HelpfulnessService.isValidTraitType({})).toBe(false);
    });
  });

  describe('defaultVisibilityFor (ЭТИЧЕСКАЯ ЗАЩИТА)', () => {
    it('question_unanswered → restricted (никогда публично)', () => {
      expect(
        Specialist38HelpfulnessService.defaultVisibilityFor(
          'question_unanswered',
        ),
      ).toBe('restricted');
    });

    it('question_acknowledged_no_action → restricted (никогда публично)', () => {
      expect(
        Specialist38HelpfulnessService.defaultVisibilityFor(
          'question_acknowledged_no_action',
        ),
      ).toBe('restricted');
    });

    it('5 публичных trait — internal (могут попасть в spotlight)', () => {
      expect(
        Specialist38HelpfulnessService.defaultVisibilityFor('help_provided'),
      ).toBe('internal');
      expect(
        Specialist38HelpfulnessService.defaultVisibilityFor('proactive_hint'),
      ).toBe('internal');
      expect(
        Specialist38HelpfulnessService.defaultVisibilityFor('mentoring'),
      ).toBe('internal');
      expect(
        Specialist38HelpfulnessService.defaultVisibilityFor('emotional_support'),
      ).toBe('internal');
      expect(
        Specialist38HelpfulnessService.defaultVisibilityFor(
          'constructive_feedback',
        ),
      ).toBe('internal');
    });
  });

  describe('PRIVATE_TRAIT_TYPES set — invariant', () => {
    it('содержит ровно 2 элемента', () => {
      expect(PRIVATE_TRAIT_TYPES.size).toBe(2);
    });

    it('содержит question_unanswered и question_acknowledged_no_action', () => {
      expect(PRIVATE_TRAIT_TYPES.has('question_unanswered')).toBe(true);
      expect(
        PRIVATE_TRAIT_TYPES.has('question_acknowledged_no_action'),
      ).toBe(true);
    });

    it('НЕ содержит ни одного из 5 публичных traitType', () => {
      expect(PRIVATE_TRAIT_TYPES.has('help_provided')).toBe(false);
      expect(PRIVATE_TRAIT_TYPES.has('proactive_hint')).toBe(false);
      expect(PRIVATE_TRAIT_TYPES.has('mentoring')).toBe(false);
      expect(PRIVATE_TRAIT_TYPES.has('emotional_support')).toBe(false);
      expect(PRIVATE_TRAIT_TYPES.has('constructive_feedback')).toBe(false);
    });
  });

  describe('ALLOWED_TRAIT_TYPES — invariant', () => {
    it('содержит ровно 7 traitType (sub-ТЗ §«Паттерны»)', () => {
      expect(ALLOWED_TRAIT_TYPES.length).toBe(7);
    });

    it('все из ALLOWED_TRAIT_TYPES проходят isValidTraitType', () => {
      for (const t of ALLOWED_TRAIT_TYPES) {
        expect(Specialist38HelpfulnessService.isValidTraitType(t)).toBe(true);
      }
    });

    it('5 публичных + 2 restricted = 7 total', () => {
      const publicCount = ALLOWED_TRAIT_TYPES.filter(
        (t) => !PRIVATE_TRAIT_TYPES.has(t),
      ).length;
      expect(publicCount).toBe(5);
      expect(PRIVATE_TRAIT_TYPES.size).toBe(2);
    });
  });

  describe('SPECIALIST_NAME constant', () => {
    it('совпадает с RouterService.SPECIALIST.HELPFULNESS', () => {
      expect(Specialist38HelpfulnessService.SPECIALIST_NAME).toBe(
        '3-8-helpfulness',
      );
    });
  });
});
