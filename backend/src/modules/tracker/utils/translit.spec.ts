import { describe, expect, it, vi } from 'vitest';

import {
  deriveIdentifier,
  generateProjectIdentifier,
  generateProjectSlug,
  slugify,
  transliterate,
} from './translit';

describe('translit utils', () => {
  describe('transliterate', () => {
    it('кириллица → латиница (lower-case на выходе)', () => {
      expect(transliterate('Альфа')).toBe('alfa');
      expect(transliterate('Маркетинг')).toBe('marketing');
      expect(transliterate('Щёткин')).toBe('schetkin');
      expect(transliterate('ООО «Ромашка»')).toBe('ooo «romashka»');
    });

    it('пустая строка → пустая строка', () => {
      expect(transliterate('')).toBe('');
    });

    it('ASCII сохраняется как есть (но в lower)', () => {
      expect(transliterate('ACME Corp')).toBe('acme corp');
      expect(transliterate('foo-bar_baz')).toBe('foo-bar_baz');
    });

    it('смешанный текст', () => {
      expect(transliterate('Альфа-Bank')).toBe('alfa-bank');
    });
  });

  describe('slugify', () => {
    it('русские имена', () => {
      expect(slugify('Альфа')).toBe('alfa');
      expect(slugify('ООО «Ромашка»')).toBe('ooo-romashka');
      expect(slugify('Маркетинг отдел')).toBe('marketing-otdel');
    });

    it('обрезает по maxLen', () => {
      const long = 'А'.repeat(100);
      const result = slugify(long, 10);
      expect(result.length).toBeLessThanOrEqual(10);
    });

    it('пустой результат → fallback "project"', () => {
      expect(slugify('')).toBe('project');
      expect(slugify('!!!---???')).toBe('project');
    });

    it('схлопывает повторы дефисов', () => {
      expect(slugify('foo   bar')).toBe('foo-bar');
      expect(slugify('foo---bar')).toBe('foo-bar');
    });
  });

  describe('deriveIdentifier', () => {
    it('первые 3-5 заглавных букв', () => {
      expect(deriveIdentifier('Маркетинг')).toBe('MARKE');
      expect(deriveIdentifier('Альфа')).toBe('ALFA');
    });

    it('добивка X для коротких', () => {
      // 'ИТ' → 'it' → 'IT' (2 буквы), добивает до 3
      expect(deriveIdentifier('ИТ')).toBe('ITX');
    });

    it('fallback PRJ для пустого / без букв', () => {
      expect(deriveIdentifier('')).toBe('PRJ');
      expect(deriveIdentifier('123!@#')).toBe('PRJ');
    });

    it('ASCII работает', () => {
      expect(deriveIdentifier('ACME Corp')).toBe('ACMEC');
    });
  });

  describe('generateProjectSlug', () => {
    function buildPrismaStub(existsByCallIndex: boolean[]) {
      let callIdx = 0;
      return {
        project: {
          findUnique: vi.fn(async () => {
            const exists = existsByCallIndex[callIdx] ?? false;
            callIdx += 1;
            return exists ? ({ id: 'x' } as { id: string }) : null;
          }),
        },
      };
    }

    it('возвращает base slug, если нет коллизии', async () => {
      const prisma = buildPrismaStub([false]);
      const slug = await generateProjectSlug('Альфа', 'org-1', prisma as never);
      expect(slug).toBe('alfa');
      expect(prisma.project.findUnique).toHaveBeenCalledTimes(1);
    });

    it('добавляет суффикс -2 при коллизии', async () => {
      const prisma = buildPrismaStub([true, false]);
      const slug = await generateProjectSlug('Альфа', 'org-1', prisma as never);
      expect(slug).toBe('alfa-2');
      expect(prisma.project.findUnique).toHaveBeenCalledTimes(2);
    });

    it('падает после 5 попыток', async () => {
      const prisma = buildPrismaStub([true, true, true, true, true]);
      await expect(
        generateProjectSlug('Альфа', 'org-1', prisma as never),
      ).rejects.toThrow('slug_collision');
    });
  });

  describe('generateProjectIdentifier', () => {
    function buildPrismaStub(existsByCallIndex: boolean[]) {
      let callIdx = 0;
      return {
        project: {
          findUnique: vi.fn(async () => null),
          findFirst: vi.fn(async () => {
            const exists = existsByCallIndex[callIdx] ?? false;
            callIdx += 1;
            return exists ? ({ id: 'x' } as { id: string }) : null;
          }),
        },
      };
    }

    it('возвращает base, если нет коллизии', async () => {
      const prisma = buildPrismaStub([false]);
      const ident = await generateProjectIdentifier(
        'Маркетинг',
        'org-1',
        prisma as never,
      );
      expect(ident).toBe('MARKE');
    });

    it('добавляет числовой суффикс при коллизии (общая длина ≤ 5)', async () => {
      const prisma = buildPrismaStub([true, false]);
      const ident = await generateProjectIdentifier(
        'Маркетинг',
        'org-1',
        prisma as never,
      );
      // base='MARKE' (5 симв), при коллизии обрезаем до 4 и приклеиваем '2'
      expect(ident).toBe('MARK2');
    });

    it('fallback PRJ для пустого, без коллизии', async () => {
      const prisma = buildPrismaStub([false]);
      const ident = await generateProjectIdentifier('', 'org-1', prisma as never);
      expect(ident).toBe('PRJ');
    });

    it('падает после 5 попыток', async () => {
      const prisma = buildPrismaStub([true, true, true, true, true]);
      await expect(
        generateProjectIdentifier('Маркетинг', 'org-1', prisma as never),
      ).rejects.toThrow('identifier_collision');
    });
  });
});
