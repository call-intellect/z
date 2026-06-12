import { describe, expect, it } from 'vitest';

import {
  appendJsonWordToUser,
  ensureJsonWordInUser,
  hasJsonWord,
  JSON_MODE_USER_SUFFIX,
} from './json-mode.util';

describe('ensureJsonWordInUser (cache-safety #56/#72)', () => {
  it('дописывает слово в ХВОСТ последнего USER, SYSTEM не трогает', () => {
    const messages = [
      { role: 'system', content: 'Сделай отчёт.' },
      { role: 'user', content: 'Транскрипт' },
    ];
    ensureJsonWordInUser(messages);

    // SYSTEM байт-в-байт неизменен (кэш не ломается).
    expect(messages[0]!.content).toBe('Сделай отчёт.');
    expect(messages[1]!.content).toBe('Транскрипт' + JSON_MODE_USER_SUFFIX);
    expect(messages[1]!.content.toLowerCase()).toContain('json');
  });

  it('выбирает ИМЕННО последний user среди нескольких', () => {
    const messages = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'первый' },
      { role: 'assistant', content: 'ответ' },
      { role: 'user', content: 'второй' },
    ];
    ensureJsonWordInUser(messages);

    expect(messages[1]!.content).toBe('первый'); // прошлый user не тронут
    expect(messages[3]!.content).toBe('второй' + JSON_MODE_USER_SUFFIX);
  });

  it('no-op, если слово «json» уже есть (в любом сообщении) — идемпотентность', () => {
    const messages = [
      { role: 'system', content: 'Верни ответ в JSON.' },
      { role: 'user', content: 'данные' },
    ];
    ensureJsonWordInUser(messages);
    expect(messages[0]!.content).toBe('Верни ответ в JSON.');
    expect(messages[1]!.content).toBe('данные'); // не дописываем

    // Повторный вызов после первой мутации — тоже no-op.
    const m2 = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'u' },
    ];
    ensureJsonWordInUser(m2);
    const afterFirst = m2[1]!.content;
    ensureJsonWordInUser(m2);
    expect(m2[1]!.content).toBe(afterFirst); // не задвоилось
  });

  it('no-op, если нет ни одного user-сообщения', () => {
    const messages = [{ role: 'system', content: 'sys' }];
    ensureJsonWordInUser(messages);
    expect(messages[0]!.content).toBe('sys');
  });
});

describe('appendJsonWordToUser (openai-proxy #72)', () => {
  it('дописывает в user, если слова «json» нет ни в system, ни в user', () => {
    const out = appendJsonWordToUser('Сделай отчёт.', 'Транскрипт');
    expect(out).toBe('Транскрипт' + JSON_MODE_USER_SUFFIX);
  });

  it('не трогает user, если «json» есть в system', () => {
    expect(appendJsonWordToUser('Верни JSON.', 'данные')).toBe('данные');
  });

  it('не трогает user, если «json» уже есть в user', () => {
    expect(appendJsonWordToUser('sys', 'верни json')).toBe('верни json');
  });
});

describe('hasJsonWord', () => {
  it('кейс-инсенситивно и игнорирует null/undefined', () => {
    expect(hasJsonWord('JSON')).toBe(true);
    expect(hasJsonWord('json')).toBe(true);
    expect(hasJsonWord(undefined, null, 'нет слова')).toBe(false);
  });
});
