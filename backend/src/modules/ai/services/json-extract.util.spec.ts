import { describe, expect, it } from 'vitest';

import { tryParseJson } from './json-extract.util';

describe('tryParseJson', () => {
  it('парсит чистый JSON-объект', () => {
    const out = tryParseJson('{"a":1,"b":"x"}');
    expect(out).toEqual({ a: 1, b: 'x' });
  });

  it('снимает обёртку ```json ... ``` и парсит', () => {
    const text = '```json\n{"relationType":"none","confidence":0.5}\n```';
    const out = tryParseJson(text);
    expect(out).toEqual({ relationType: 'none', confidence: 0.5 });
  });

  it('снимает безымянную ``` ... ``` обёртку и парсит', () => {
    const text = '```\n{"ok":true}\n```';
    const out = tryParseJson(text);
    expect(out).toEqual({ ok: true });
  });

  it('вытаскивает первый объект из прозы/преамбулы', () => {
    const text = 'Вот мой ответ: {"relationType":"supports","confidence":0.9} — готово.';
    const out = tryParseJson(text);
    expect(out).toEqual({ relationType: 'supports', confidence: 0.9 });
  });

  it('на полный мусор возвращает { raw: <text> }', () => {
    const text = 'это совсем не JSON и тут нет фигурных скобок';
    const out = tryParseJson(text);
    expect(out).toEqual({ raw: text });
  });
});
