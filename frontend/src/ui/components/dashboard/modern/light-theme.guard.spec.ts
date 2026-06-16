/**
 * Гард A1 (мастер-ТЗ cabinet-master-fixes, доводка светлой темы): после Ф10
 * новые modern-примитивы и реферальные экраны не должны снова притащить
 * «осветление по белому», невидимое на светлом фоне. Запрещаем:
 *   1) литерал белого оверлея `oklch(1 0 0 / …)` — белый с альфой невидим
 *      на светлой теме (нужны тема-зависимые `--surface-inset` / `--border-inset`);
 *   2) Tailwind-классы `bg-white/…` и `text-white` — то же осветление по белому.
 *
 * Сканируем `src/ui/components/dashboard/modern` и `app/(authenticated)/referrals`.
 * НЕ запрещаем `color: CHART.x` — это легитимные recharts series-цвета
 * (объекты `{ key, color: CHART.x, label }`), читаемые в обеих темах.
 *
 * recharts gradient-stop с белым здесь не используется — если появится белый
 * оверлей легитимно, добавляй тема-зависимый токен, а не литерал.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOTS = [
  'src/ui/components/dashboard/modern',
  'app/(authenticated)/referrals',
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      out.push(...walk(p));
    } else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.spec.ts') && !entry.endsWith('.spec.tsx')) {
      out.push(p);
    }
  }
  return out;
}

const FORBIDDEN: ReadonlyArray<{ re: RegExp; what: string }> = [
  { re: /oklch\(\s*1\s+0\s+0\s*\//, what: 'белый оверлей oklch(1 0 0 / …) — невидим на светлой теме' },
  { re: /\bbg-white\//, what: 'Tailwind bg-white/… — осветление по белому' },
  { re: /\btext-white\b/, what: 'Tailwind text-white — осветление по белому' },
];

describe('светлая тема — гард от регресса «осветления по белому» (A1)', () => {
  it('нет белых оверлеев / bg-white / text-white в modern и referrals', () => {
    const root = process.cwd();
    const hits: string[] = [];
    for (const rel of ROOTS) {
      let files: string[];
      try {
        files = walk(join(root, rel));
      } catch {
        continue; // каталог может отсутствовать в изолированном прогоне
      }
      for (const file of files) {
        const lines = readFileSync(file, 'utf8').split('\n');
        lines.forEach((line, idx) => {
          for (const { re, what } of FORBIDDEN) {
            if (re.test(line)) hits.push(`${file}:${idx + 1} ${what}`);
          }
        });
      }
    }
    expect(hits).toEqual([]);
  });
});
