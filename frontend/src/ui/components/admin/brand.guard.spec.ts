/**
 * Гард D6 (ТЗ 2026-06-11 cabinet-inbox-nav-ui-honesty): после ребренда
 * «Z-Admin» → «Кора-Админ» новая admin-страница не должна снова притащить
 * литерал «Z-Admin» в ВИДИМЫЕ конструкты — title вкладки, хлебную крошку,
 * текст логотипа. Сканируем ТОЛЬКО `app/(admin)` и `src/ui/components/admin`,
 * и ТОЛЬКО три конструкта — комментарии и внутреннее имя роли `super_admin`
 * не трогаем (узкий гард, не ESLint no-restricted-syntax по любому литералу).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOTS = ['app/(admin)', 'src/ui/components/admin'];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      out.push(...walk(p));
    } else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.spec.ts')) {
      out.push(p);
    }
  }
  return out;
}

const FORBIDDEN: ReadonlyArray<{ re: RegExp; what: string }> = [
  { re: /title:\s*['"][^'"]*Z-Admin/, what: "title: '…Z-Admin…'" },
  { re: /label:\s*['"]Z-Admin['"]/, what: "label: 'Z-Admin'" },
];

describe('бренд админки — гард от регресса «Z-Admin» (D6)', () => {
  it('нет литерала «Z-Admin» в title / хлебной крошке / логотипе', () => {
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
          // Логотип: JSX-текст «Z-Admin» отдельной строкой (не комментарий).
          const t = line.trim();
          if (
            /(^|>)Z-Admin(<|$)/.test(t) &&
            !t.startsWith('*') &&
            !t.startsWith('//') &&
            !t.startsWith('/*')
          ) {
            hits.push(`${file}:${idx + 1} JSX-текст Z-Admin`);
          }
        });
      }
    }
    expect(hits).toEqual([]);
  });
});
