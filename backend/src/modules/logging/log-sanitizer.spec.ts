import { describe, expect, it } from 'vitest';

import { REDACTED, capPayloadSize, sanitizePayload } from './log-sanitizer';

describe('sanitizePayload', () => {
  it('маскирует чувствительные ключи рекурсивно', () => {
    const out = sanitizePayload({
      password: 'secret',
      nested: { authorization: 'Bearer x', ok: 1 },
      apiKey: 'k',
      safe: 'value',
    }) as Record<string, unknown>;
    expect(out['password']).toBe(REDACTED);
    expect((out['nested'] as Record<string, unknown>)['authorization']).toBe(REDACTED);
    expect((out['nested'] as Record<string, unknown>)['ok']).toBe(1);
    expect(out['apiKey']).toBe(REDACTED);
    expect(out['safe']).toBe('value');
  });

  it('усекает длинные строки', () => {
    const long = 'x'.repeat(5000);
    const out = sanitizePayload({ note: long }, 100) as Record<string, string>;
    const note = out['note'] ?? '';
    expect(note.length).toBeLessThan(long.length);
    expect(note).toContain('…[+');
  });

  it('ограничивает глубину', () => {
    let deep: unknown = 'leaf';
    for (let i = 0; i < 20; i++) deep = { child: deep };
    const out = JSON.stringify(sanitizePayload(deep));
    expect(out).toContain('[TRUNCATED_DEPTH]');
  });

  it('ограничивает массивы 200 элементами', () => {
    const arr = Array.from({ length: 500 }, (_, i) => i);
    const out = sanitizePayload(arr) as unknown[];
    expect(out.length).toBe(201);
    expect(out[200]).toContain('more');
  });

  it('Date → ISO', () => {
    const d = new Date('2026-06-01T00:00:00.000Z');
    expect(sanitizePayload(d)).toBe('2026-06-01T00:00:00.000Z');
  });
});

describe('capPayloadSize', () => {
  it('возвращает значение как есть, если в лимите', () => {
    const v = { a: 1 };
    expect(capPayloadSize(v, 1000)).toBe(v);
  });

  it('заглушка при превышении лимита', () => {
    const big = { data: 'x'.repeat(50_000) };
    const out = capPayloadSize(big, 16_000) as Record<string, unknown>;
    expect(out['_note']).toBe('[PAYLOAD_TOO_LARGE]');
    expect(typeof out['_bytes']).toBe('number');
    expect(typeof out['_preview']).toBe('string');
  });

  it('[UNSERIALIZABLE_PAYLOAD] при циклической ссылке', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    const out = capPayloadSize(cyclic) as Record<string, unknown>;
    expect(out['_note']).toBe('[UNSERIALIZABLE_PAYLOAD]');
  });
});
