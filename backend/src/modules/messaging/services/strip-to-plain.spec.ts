import { describe, expect, it } from 'vitest';

import { stripToPlain } from './strip-to-plain';

describe('stripToPlain', () => {
  it('убирает HTML-теги, оставляя текст', () => {
    expect(stripToPlain('<p>Привет, <b>мир</b></p>')).toBe('Привет, мир');
  });

  it('переносы блоков и <br> схлопывает в пробел', () => {
    expect(stripToPlain('<div>раз</div><div>два</div>раз<br>два')).toBe('раз два раз два');
  });

  it('декодирует базовые HTML-сущности', () => {
    expect(stripToPlain('a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39; &nbsp;f')).toBe(
      'a & b <c> "d" \'e\' f',
    );
  });

  it('схлопывает лишние пробелы и тримит', () => {
    expect(stripToPlain('  много   пробелов \n\t тут  ')).toBe('много пробелов тут');
  });

  it('чистый текст без HTML не меняет (кроме тримминга)', () => {
    expect(stripToPlain('просто текст')).toBe('просто текст');
  });

  it('пустая строка / только теги → пусто', () => {
    expect(stripToPlain('<p></p>')).toBe('');
    expect(stripToPlain('   ')).toBe('');
  });
});
