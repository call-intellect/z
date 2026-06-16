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
