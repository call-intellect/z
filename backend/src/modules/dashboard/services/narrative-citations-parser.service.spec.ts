import { describe, expect, it, beforeEach } from 'vitest';

import {
  NarrativeCitationsParserService,
  type CitationSource,
} from './narrative-citations-parser.service';

describe('NarrativeCitationsParserService', () => {
  let parser: NarrativeCitationsParserService;

  beforeEach(() => {
    parser = new NarrativeCitationsParserService();
  });

  it('пустой текст → пустые text и citations', () => {
    const result = parser.parse('', []);
    expect(result.text).toBe('');
    expect(result.citations).toEqual([]);
  });

  it('текст без маркеров → возвращается as-is', () => {
    const result = parser.parse('Просто текст без ссылок.', []);
    expect(result.text).toBe('Просто текст без ссылок.');
    expect(result.citations).toEqual([]);
  });

  it('валидный маркер темы → [1] + один citation с URL', () => {
    const sources: CitationSource[] = [{ type: 'theme', id: 'abc123', label: 'T1' }];
    const result = parser.parse('Foo [theme:abc123] bar', sources);

    expect(result.text).toBe('Foo [1] bar');
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]).toEqual({
      number: 1,
      type: 'theme',
      id: 'abc123',
      label: 'T1',
      url: '/themes/abc123',
    });
  });

  it('несколько маркеров разных типов → правильная нумерация в порядке появления', () => {
    const sources: CitationSource[] = [
      { type: 'theme', id: 'theme01', label: 'Theme A' },
      { type: 'ib', id: 'block02', label: 'Block B' },
      { type: 'dec', id: 'dec0003', label: 'Decision C' },
    ];
    const result = parser.parse(
      'Факт один [theme:theme01]. Факт два [ib:block02][dec:dec0003].',
      sources,
    );

    expect(result.text).toBe('Факт один [1]. Факт два [2][3].');
    expect(result.citations.map((c) => c.number)).toEqual([1, 2, 3]);
    expect(result.citations[0]!.type).toBe('theme');
    expect(result.citations[1]!.type).toBe('ib');
    expect(result.citations[2]!.type).toBe('dec');
    expect(result.citations[0]!.url).toBe('/themes/theme01');
    expect(result.citations[1]!.url).toBeNull();
    expect(result.citations[2]!.url).toBe('/decisions/dec0003');
  });

  it('один маркер дважды → одна citation, обе замены имеют тот же [1]', () => {
    const sources: CitationSource[] = [{ type: 'theme', id: 'aaa111', label: 'Тема X' }];
    const result = parser.parse(
      '[theme:aaa111] первое упоминание, [theme:aaa111] второе.',
      sources,
    );

    expect(result.text).toBe('[1] первое упоминание, [1] второе.');
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]!.number).toBe(1);
  });

  it('галлюцинированный маркер (id не в sources) → стрипается, в citations не попадает', () => {
    const sources: CitationSource[] = [{ type: 'theme', id: 'real01', label: 'Реальная' }];
    const result = parser.parse(
      'Реальный факт [theme:real01], а вот выдуманный [theme:fakefake123].',
      sources,
    );

    expect(result.text).toBe('Реальный факт [1], а вот выдуманный.');
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]!.id).toBe('real01');
  });

  it('маркер с типом не из whitelist (xxx) → не матчится, остаётся в тексте как есть', () => {
    const result = parser.parse('Текст [xxx:abc123] хвост', []);
    expect(result.text).toBe('Текст [xxx:abc123] хвост');
    expect(result.citations).toEqual([]);
  });

  it('построение URL: разные типы → правильные пути', () => {
    const sources: CitationSource[] = [
      { type: 'theme', id: 'TID0001', label: 'T' },
      { type: 'goal', id: 'GID0001', label: 'G' },
      { type: 'dec', id: 'DID0001', label: 'D' },
      { type: 'mtg', id: 'MID0001', label: 'M' },
      { type: 'ib', id: 'IBID001', label: 'IB' },
      { type: 'ent', id: 'ENT0001', label: 'E' },
    ];
    const result = parser.parse(
      '[theme:TID0001] [goal:GID0001] [dec:DID0001] [mtg:MID0001] [ib:IBID001] [ent:ENT0001]',
      sources,
    );

    const byType = new Map(result.citations.map((c) => [c.type, c]));
    expect(byType.get('theme')!.url).toBe('/themes/TID0001');
    expect(byType.get('goal')!.url).toBe('/goals/GID0001');
    expect(byType.get('dec')!.url).toBe('/decisions/DID0001');
    expect(byType.get('mtg')!.url).toBe('/meetings/MID0001/result');
    expect(byType.get('ib')!.url).toBeNull();
    expect(byType.get('ent')!.url).toBeNull();
  });

  it('косметика пробелов: пробел перед точкой убирается', () => {
    const sources: CitationSource[] = [{ type: 'theme', id: 'abc123', label: 'T' }];
    const result = parser.parse('Foo [theme:abc123] .', sources);
    expect(result.text).toBe('Foo [1].');
  });

  it('косметика: множественные пробелы схлопываются и trim по краям', () => {
    const sources: CitationSource[] = [{ type: 'theme', id: 'abc123', label: 'T' }];
    const result = parser.parse('  Foo   [theme:abc123]  bar  ', sources);
    expect(result.text).toBe('Foo [1] bar');
  });

  it('label берётся из sources, не из текста', () => {
    const sources: CitationSource[] = [{ type: 'mtg', id: 'meet01', label: 'Встреча: ретро' }];
    const result = parser.parse('Встреча состоялась [mtg:meet01].', sources);
    expect(result.citations[0]!.label).toBe('Встреча: ретро');
  });

  it('короткий id (<6 chars) → regex не матчит, маркер остаётся в тексте', () => {
    const result = parser.parse('Текст [theme:abc] хвост', [
      { type: 'theme', id: 'abc', label: 'X' },
    ]);
    expect(result.text).toBe('Текст [theme:abc] хвост');
    expect(result.citations).toEqual([]);
  });
});
