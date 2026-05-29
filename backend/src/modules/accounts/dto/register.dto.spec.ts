/**
 * audit В8 (2026-05-29): unit-тесты для нормализации телефона в E.164.
 *
 * Покрытие:
 *   - Российские форматы (+7, 8, 9XXX) → +7XXXXXXXXXX
 *   - Грязный ввод (скобки, дефисы, пробелы) → очищается
 *   - Невалидное (буквы, <10 цифр) → null
 *   - Международные ≥10 цифр без 7/8 → +<digits>
 *   - RegisterSchema принимает/отклоняет согласно валидации
 */

import { describe, expect, it } from 'vitest';

import { RegisterSchema, normalizePhoneE164 } from './register.dto';

describe('normalizePhoneE164', () => {
  it('российский с +7 и форматированием → +7XXXXXXXXXX', () => {
    expect(normalizePhoneE164('+7 (905) 123-45-67')).toBe('+79051234567');
    expect(normalizePhoneE164('+7-905-123-45-67')).toBe('+79051234567');
    expect(normalizePhoneE164('+79051234567')).toBe('+79051234567');
  });

  it('российский с 8 в начале → +7XXXXXXXXXX', () => {
    expect(normalizePhoneE164('8 905 123 45 67')).toBe('+79051234567');
    expect(normalizePhoneE164('89051234567')).toBe('+79051234567');
  });

  it('10 цифр начиная с 9 (мобильный без кода) → +7 9XXXXXXXXX', () => {
    expect(normalizePhoneE164('9051234567')).toBe('+79051234567');
  });

  it('международный (≥10 цифр, не с 7/8) → +<digits>', () => {
    // США в формате +1
    expect(normalizePhoneE164('+1 415 555 2671')).toBe('+14155552671');
    // Германия +49
    expect(normalizePhoneE164('+49 89 12345678')).toBe('+498912345678');
  });

  it('менее 10 цифр → null', () => {
    expect(normalizePhoneE164('12345')).toBeNull();
    expect(normalizePhoneE164('+7 800')).toBeNull();
    expect(normalizePhoneE164('()')).toBeNull();
  });

  it('более 15 цифр → null (E.164 max)', () => {
    expect(normalizePhoneE164('1234567890123456')).toBeNull();
  });

  it('пустая строка / только символы → null', () => {
    expect(normalizePhoneE164('---')).toBeNull();
    expect(normalizePhoneE164('abc')).toBeNull();
  });
});

describe('RegisterSchema (phone)', () => {
  const basePayload = {
    email: 'user@example.com',
    name: 'Иван',
    consentDataProcessing: true,
    consentMarketing: false,
  };

  it('phone опционален — без него RegisterDto валиден', () => {
    const result = RegisterSchema.safeParse(basePayload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.phone).toBeUndefined();
    }
  });

  it('phone грязный российский → нормализован в +7XXXXXXXXXX', () => {
    const result = RegisterSchema.safeParse({
      ...basePayload,
      phone: '8 (905) 123-45-67',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.phone).toBe('+79051234567');
    }
  });

  it('phone невалидный (буквы) → null после transform, refine пропускает', () => {
    // refine допускает null (т.к. поле optional), сервис сам решит игнорировать
    const result = RegisterSchema.safeParse({
      ...basePayload,
      phone: 'abcdef',
    });
    // refine: v === null || v.startsWith('+'). null проходит.
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.phone).toBeNull();
    }
  });

  it('phone слишком длинный (>32 chars) → ошибка валидации', () => {
    const result = RegisterSchema.safeParse({
      ...basePayload,
      phone: '+'.padEnd(40, '7'),
    });
    expect(result.success).toBe(false);
  });
});

/**
 * audit С12 (2026-05-29): регресс-тест на `consentDataProcessing`.
 *
 * `consentAcceptedAt` пишется в `accounts.service.ts` строго ПОСЛЕ
 * успешной валидации DTO. Если refine не сработает (false / undefined /
 * не-boolean) — service не должен дойти до записи Date. Проверяем,
 * что Zod-схема отрезает все невалидные варианты.
 */
describe('RegisterSchema (consentDataProcessing — С12 регресс)', () => {
  const basePayload = {
    email: 'user@example.com',
    name: 'Иван',
    consentMarketing: false,
  };

  it('consentDataProcessing=true → success', () => {
    const result = RegisterSchema.safeParse({
      ...basePayload,
      consentDataProcessing: true,
    });
    expect(result.success).toBe(true);
  });

  it('consentDataProcessing=false → ошибка валидации', () => {
    const result = RegisterSchema.safeParse({
      ...basePayload,
      consentDataProcessing: false,
    });
    expect(result.success).toBe(false);
  });

  it('consentDataProcessing отсутствует → ошибка валидации', () => {
    const result = RegisterSchema.safeParse(basePayload);
    expect(result.success).toBe(false);
  });

  it('consentDataProcessing не boolean → ошибка валидации', () => {
    const result = RegisterSchema.safeParse({
      ...basePayload,
      consentDataProcessing: 'yes',
    });
    expect(result.success).toBe(false);
  });
});
