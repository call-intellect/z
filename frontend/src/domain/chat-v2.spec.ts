import { describe, expect, it } from 'vitest';

import { stripContextMarkers } from './chat-v2';

describe('stripContextMarkers (#57)', () => {
  it('снимает все формы служебных маркеров', () => {
    expect(stripContextMarkers('Ответ [BLOCK:abc123] готов.')).toBe(
      'Ответ готов.',
    );
    expect(stripContextMarkers('Текст [DECISION:dec_1] далее')).toBe(
      'Текст далее',
    );
    expect(
      stripContextMarkers('A [CONTRADICTING BLOCK] B'),
    ).toBe('A B');
    expect(
      stripContextMarkers('A [CONTRADICTING BLOCK:xy-9] B'),
    ).toBe('A B');
    expect(
      stripContextMarkers('Вот [REASONING CHAIN FOR BLOCK blk7] цепочка'),
    ).toBe('Вот цепочка');
  });

  it('снимает несколько маркеров в одной строке', () => {
    expect(
      stripContextMarkers('X [BLOCK:a] Y [DECISION:b] Z'),
    ).toBe('X Y Z');
  });

  it('НЕ трогает markdown-ссылку [текст](url)', () => {
    const md = 'См. [документацию](https://example.com/doc) здесь.';
    expect(stripContextMarkers(md)).toBe(md);
  });

  it('НЕ трогает обычный текст в скобках', () => {
    const t = 'Это (обычный текст) и [просто строка] остаётся.';
    expect(stripContextMarkers(t)).toBe(t);
  });

  it('сохраняет переводы строк (для whitespace-pre-wrap)', () => {
    expect(stripContextMarkers('Строка 1 [BLOCK:a]\nСтрока 2')).toBe(
      'Строка 1\nСтрока 2',
    );
  });

  it('идемпотентность — повторный вызов ничего не меняет', () => {
    const once = stripContextMarkers('Ответ [BLOCK:abc] готов [DECISION:d].');
    expect(stripContextMarkers(once)).toBe(once);
  });

  it('без маркеров — возвращает исходный текст (только trim)', () => {
    expect(stripContextMarkers('Просто ответ.')).toBe('Просто ответ.');
  });
});
