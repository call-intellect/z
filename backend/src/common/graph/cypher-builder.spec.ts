import { describe, expect, it } from 'vitest';

import { CypherBuilder } from './cypher-builder';

describe('CypherBuilder.escapeString', () => {
  it('escapes single quotes', () => {
    const out = CypherBuilder.escapeString("О'Брайен");
    expect(out).toContain("\\'");
    expect(out).not.toMatch(/(^|[^\\])'/);
  });

  it('escapes backslashes', () => {
    const out = CypherBuilder.escapeString('a\\b');
    expect(out).toBe('a\\\\b');
  });

  it('escapes newlines and carriage returns', () => {
    const out = CypherBuilder.escapeString('line1\nline2\rline3');
    expect(out).toContain('\\n');
    expect(out).toContain('\\r');
    expect(out).not.toContain('\n');
    expect(out).not.toContain('\r');
  });

  it('keeps unicode and emoji intact without throwing', () => {
    const src = 'эмодзи 😀 клиент';
    const out = CypherBuilder.escapeString(src);
    expect(out).toContain('эмодзи');
    expect(out).toContain('😀');
    expect(out).toContain('клиент');
  });
});

describe('CypherBuilder.dollarQuote', () => {
  it('wraps ordinary cypher in $cypher$ delimiters', () => {
    const out = CypherBuilder.dollarQuote('RETURN 1');
    expect(out.startsWith('$cypher$')).toBe(true);
    expect(out.endsWith('$cypher$')).toBe(true);
    expect(out).toBe('$cypher$ RETURN 1 $cypher$');
  });

  it('expands the tag when body already contains $cypher$', () => {
    const body = "RETURN '$cypher$'";
    const out = CypherBuilder.dollarQuote(body);
    expect(out.startsWith('$cypher$ ')).toBe(false);
    expect(out.startsWith('$cypherx$')).toBe(true);
    expect(out.endsWith('$cypherx$')).toBe(true);
    expect(out).toBe(`$cypherx$ ${body} $cypherx$`);
  });

  it('keeps expanding until the tag no longer collides with the body', () => {
    const body = "x '$cypher$' and '$cypherx$'";
    const out = CypherBuilder.dollarQuote(body);
    const match = out.match(/^\$(cypherx+)\$ /);
    expect(match).not.toBeNull();
    const tag = match![1];
    expect(body.includes(`$${tag}$`)).toBe(false);
    expect(out).toBe(`$${tag}$ ${body} $${tag}$`);
  });
});
