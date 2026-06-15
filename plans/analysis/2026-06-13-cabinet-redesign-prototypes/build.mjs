// Сборка единого index.html из оболочки и фрагментов экранов.
// Запуск: node build.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const parts = join(dir, '_parts');
const order = [
  'shell-head.html',
  'part-today.html',
  'part-requires.html',
  'part-week.html',
  'part-month.html',
  'part-meetings.html',
  'part-tasks.html',
  'part-memory.html',
  'part-team.html',
  'part-me.html',
  'part-settings.html',
  'shell-foot.html',
];

let out = '';
const missing = [];
for (const f of order) {
  const p = join(parts, f);
  if (!existsSync(p)) { missing.push(f); continue; }
  out += readFileSync(p, 'utf8') + '\n';
}
writeFileSync(join(dir, 'index.html'), out);
console.log('index.html собран из', order.length - missing.length, 'частей.');
if (missing.length) console.log('ОТСУТСТВУЮТ (пропущены):', missing.join(', '));
