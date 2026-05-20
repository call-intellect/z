/**
 * Копирует non-TS runtime-ассеты в dist/ после tsc-сборки.
 *
 * tsc компилирует только .ts и НЕ копирует прочие файлы. RbacService читает
 * `policies/model.conf` и `policies/policy.csv` через `join(__dirname, ...)` —
 * в собранном виде они должны лежать рядом с .js. Без этого `bun dist/main.js`
 * падает на старте (ENOENT policy.csv).
 *
 * Запуск: автоматически из `bun run build` (после tsc).
 */
import { cpSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ASSETS: ReadonlyArray<readonly [from: string, to: string]> = [
  [join('src', 'modules', 'rbac', 'policies'), join('dist', 'modules', 'rbac', 'policies')],
];

for (const [from, to] of ASSETS) {
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
  // eslint-disable-next-line no-console
  console.log(`✓ assets: ${from} → ${to}`);
}
