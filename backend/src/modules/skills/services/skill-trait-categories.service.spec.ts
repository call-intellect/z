import { describe, expect, it } from 'vitest';

import { SkillTraitCategoryService } from './skill-trait-categories.service';

/**
 * SBA γ-1 доделки — unit-тесты SkillTraitCategoryService.
 *
 * Полный спект (CRUD + merge) тестируется через integration spec
 * `skill-trait-categories.integration.spec.ts` (требует PrismaService;
 * откладывается до отдельного integration stand). Здесь — чистые функции
 * без зависимостей от БД: `slugify`.
 */
describe('SkillTraitCategoryService.slugify', () => {
  // Создаём instance со стабами — slugify не использует prisma/audit/metrics.
  const svc = new SkillTraitCategoryService(
    {} as never,
    { log: () => Promise.resolve() } as never,
    { setSkillCategoriesTotal: () => undefined } as never,
  );

  it('латиница: lowercase + replace spaces', () => {
    expect(svc.slugify('Hello World')).toBe('hello-world');
  });

  it('кириллица: транслитерация в латиницу', () => {
    expect(svc.slugify('Осторожен с легаси')).toBe('ostorozhen-s-legasi');
  });

  it('кириллица + сложные буквы (Ё/Ж/Щ/Ю/Я)', () => {
    expect(svc.slugify('Ёжик щёлкает южным я')).toBe('ezhik-shchelkaet-yuzhnym-ya');
  });

  it('пунктуация отбрасывается, не вставляется тире', () => {
    expect(svc.slugify('Hi, world!')).toBe('hi-world');
  });

  it('многократные пробелы сворачиваются в одно тире', () => {
    expect(svc.slugify('a    b')).toBe('a-b');
  });

  it('обрезает trailing/leading тире', () => {
    expect(svc.slugify('   hello   ')).toBe('hello');
  });

  it('пустая строка / только символы → fallback на префикс cat-', () => {
    const result = svc.slugify('!!!');
    expect(result.startsWith('cat-')).toBe(true);
  });

  it('обрезает до 220 символов', () => {
    const long = 'a'.repeat(500);
    expect(svc.slugify(long).length).toBeLessThanOrEqual(220);
  });

  it('цифры сохраняются', () => {
    expect(svc.slugify('Stage 2 review')).toBe('stage-2-review');
  });
});
