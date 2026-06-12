/**
 * Кабинет §3 Ф2 (2026-06-11) — чистый unit-тест `humanizeProbeFallback`.
 *
 * Fallback-вопрос диспетчера probe не должен показывать человеку cuid-подобные
 * технические идентификаторы. Детерминизм: без сети, без времени, без БД.
 */

import { describe, expect, it } from 'vitest';

import { humanizeProbeFallback } from './probe-dispatcher.worker';

describe('humanizeProbeFallback', () => {
  it('вырезает cuid-подобный токен из сообщения', () => {
    const out = humanizeProbeFallback('Карточка cmpzl0mf3k2x9abcd1234 корректна');
    expect(out).not.toContain('cmpzl0mf3k2x9abcd1234');
    expect(out).toBe('Карточка корректна');
  });

  it('пустую строку заменяет на вежливый запрос уточнения', () => {
    expect(humanizeProbeFallback('')).toBe('Можете уточнить, пожалуйста?');
  });

  it('строку только из cuid заменяет на вежливый запрос уточнения', () => {
    expect(humanizeProbeFallback('cmpzl0mf3k2x9abcd1234')).toBe(
      'Можете уточнить, пожалуйста?',
    );
  });

  it('обычный человеческий текст не ломает', () => {
    const text = 'Можете уточнить срок по этой задаче?';
    expect(humanizeProbeFallback(text)).toBe(text);
  });

  it('обрезает длинный текст до 200 символов', () => {
    const long = 'а'.repeat(300);
    expect(humanizeProbeFallback(long)).toHaveLength(200);
  });
});
