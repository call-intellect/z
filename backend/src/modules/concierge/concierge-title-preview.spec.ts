import { describe, expect, it } from 'vitest';

import { conciergeTitlePreview } from './concierge-title-preview';

describe('conciergeTitlePreview', () => {
  it('null → null', () => {
    expect(conciergeTitlePreview(null)).toBeNull();
  });

  it('пустая строка → null', () => {
    expect(conciergeTitlePreview('')).toBeNull();
  });

  it('строка из пробелов → null', () => {
    expect(conciergeTitlePreview('   \n\t  ')).toBeNull();
  });

  it('обычный текст → как есть', () => {
    expect(conciergeTitlePreview('Что решили по подрядчику?')).toBe('Что решили по подрядчику?');
  });

  it('длинный (>80) → обрезан до 80 + многоточие', () => {
    const long = 'а'.repeat(120);
    const out = conciergeTitlePreview(long);
    expect(out).toBe(`${'а'.repeat(80)}…`);
    expect(out).toHaveLength(81);
  });

  it('ровно 80 символов → без многоточия', () => {
    const exact = 'б'.repeat(80);
    expect(conciergeTitlePreview(exact)).toBe(exact);
  });

  it('многострочный/множественные пробелы → схлопнуты в один пробел', () => {
    expect(conciergeTitlePreview('Привет,\n\n  как   дела?\tвсё ок')).toBe(
      'Привет, как дела? всё ок',
    );
  });
});
