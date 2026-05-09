import { describe, expect, it } from 'vitest';

import {
  CARD_HEX_COLOR_REGEX,
  CARD_KINDS,
  CardKindSchema,
} from './card-kind';

describe('Card kind/colour validation', () => {
  it('CardKindSchema accepts all known kinds', () => {
    for (const kind of CARD_KINDS) {
      const parsed = CardKindSchema.safeParse(kind);
      expect(parsed.success).toBe(true);
    }
  });

  it('CardKindSchema rejects unknown kinds', () => {
    expect(CardKindSchema.safeParse('unknown').success).toBe(false);
    expect(CardKindSchema.safeParse('').success).toBe(false);
    expect(CardKindSchema.safeParse('CLIENT').success).toBe(false);
  });

  it('CARD_HEX_COLOR_REGEX accepts 7-char hex', () => {
    expect(CARD_HEX_COLOR_REGEX.test('#5EEAD4')).toBe(true);
    expect(CARD_HEX_COLOR_REGEX.test('#000000')).toBe(true);
    expect(CARD_HEX_COLOR_REGEX.test('#abcdef')).toBe(true);
  });

  it('CARD_HEX_COLOR_REGEX rejects shorthand and non-hex', () => {
    expect(CARD_HEX_COLOR_REGEX.test('#FFF')).toBe(false);
    expect(CARD_HEX_COLOR_REGEX.test('5EEAD4')).toBe(false);
    expect(CARD_HEX_COLOR_REGEX.test('#GGGGGG')).toBe(false);
    expect(CARD_HEX_COLOR_REGEX.test('blue')).toBe(false);
  });
});
