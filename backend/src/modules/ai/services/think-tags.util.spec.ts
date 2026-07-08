import { describe, it, expect } from 'vitest';

import { stripThinkTags, hasThinkTags } from './think-tags.util';

describe('stripThinkTags', () => {
  it('убирает закрытый think-блок и оставляет контент', () => {
    const input = '<think>\nThe user asks me.\nAccord\n</think>\nПривет!';
    expect(stripThinkTags(input)).toBe('Привет!');
  });

  it('оставляет контент до think-блока', () => {
    const input = 'Привет!\n<think>\nразмышления\n</think>';
    expect(stripThinkTags(input)).toBe('Привет!');
  });

  it('убирает незакрытый think (когда модель не додумала)', () => {
    const input = 'Привет!\n<think>\nThe user is asking';
    expect(stripThinkTags(input)).toBe('Привет!');
  });

  it('убирает только think, когда контента нет', () => {
    const input = '<think>\nтолько размышления\n</think>';
    expect(stripThinkTags(input)).toBe('');
  });

  it('обрабатывает несколько think-блоков', () => {
    const input =
      '<think>first</think>\nA\n<think>second</think>\nB';
    expect(stripThinkTags(input)).toBe('A\nB');
  });

  it('не трогает строку без think-тегов', () => {
    expect(stripThinkTags('Обычный ответ модели')).toBe('Обычный ответ модели');
  });

  it('обрабатывает регистронезависимо', () => {
    expect(stripThinkTags('<THINK>x</THINK>ок')).toBe('ок');
    expect(stripThinkTags('<Think>x</Think>ок')).toBe('ок');
  });

  it('обрабатывает пустую строку', () => {
    expect(stripThinkTags('')).toBe('');
  });

  it('тримит пробелы и переводы строк', () => {
    const input = '  <think>x</think>  \n\n  ответ  \n';
    expect(stripThinkTags(input)).toBe('ответ');
  });

  it('обрабатывает многострочные размышления', () => {
    const input = `<think>
The user is asking me to identify myself.
According to my knowledge, I am MiniMax-M3.
I should respond in Russian.
</think>
Я — модель MiniMax-M3.`;
    expect(stripThinkTags(input)).toBe('Я — модель MiniMax-M3.');
  });
});

describe('hasThinkTags', () => {
  it('true для строки с think', () => {
    expect(hasThinkTags('<think>x</think>')).toBe(true);
    expect(hasThinkTags('a <think> b')).toBe(true);
  });

  it('false для обычной строки', () => {
    expect(hasThinkTags('обычный ответ')).toBe(false);
    expect(hasThinkTags('')).toBe(false);
  });

  it('регистронезависимо', () => {
    expect(hasThinkTags('<THINK>x</THINK>')).toBe(true);
  });
});
