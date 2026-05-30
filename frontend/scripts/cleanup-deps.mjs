#!/usr/bin/env node
/**
 * Cleanup: убрать `addToast` из useCallback/useEffect/useMemo deps-array'ов
 * после миграции на sonner. Также подчищает оставшиеся `addToast` идентификаторы
 * в простых случаях.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

const ROOTS = ['app', 'src'];
const SKIP_FILES = new Set([
  'src/contexts/toast-context.tsx',
  'src/ui/shadcn/toast.tsx',
  'scripts/migrate-toast.mjs',
  'scripts/cleanup-deps.mjs',
  'scripts/_test-toast.mjs',
  // тестовые моки на useToast — оставляем
  'src/ui/tracker/Board.spec.tsx',
]);

function listFiles() {
  const files = [];
  for (const root of ROOTS) {
    const tracked = execSync(`git ls-files "${root}"`, { encoding: 'utf-8' });
    const untracked = execSync(
      `git ls-files --others --exclude-standard "${root}"`,
      { encoding: 'utf-8' },
    );
    const all = (tracked + '\n' + untracked).split('\n');
    for (const f of all) {
      const t = f.trim();
      if (!t) continue;
      if (!t.endsWith('.ts') && !t.endsWith('.tsx')) continue;
      if (SKIP_FILES.has(t.replaceAll('\\', '/'))) continue;
      files.push(t);
    }
  }
  return files;
}

function transform(src) {
  let out = src;
  let changed = false;
  if (!/\baddToast\b/.test(out)) return { out, changed };

  // 1) Убрать `, addToast` или `addToast, ` или одиночный `addToast` в deps-array.
  // Внутри квадратных скобок: [..., addToast] / [addToast] / [addToast, ...].
  // Регулярно: ищем `[ ... ]` блоки и в них чистим.
  const arrRe = /\[([^\[\]]*)\]/g;
  out = out.replace(arrRe, (full, inner) => {
    if (!/\baddToast\b/.test(inner)) return full;
    const items = splitTopLevel(inner)
      .map((s) => s.trim())
      .filter((s) => s !== 'addToast' && s !== '');
    if (items.length !== splitTopLevel(inner).map((s) => s.trim()).length) {
      changed = true;
      return `[${items.join(', ')}]`;
    }
    return full;
  });

  return { out, changed };
}

function splitTopLevel(s) {
  const out = [];
  let dc = 0,
    dp = 0,
    ds = 0;
  let start = 0;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '"' || c === "'") {
      i = skipString(s, i, c);
      continue;
    }
    if (c === '`') {
      i = skipTemplate(s, i);
      continue;
    }
    if (c === '{') dc++;
    else if (c === '}') dc--;
    else if (c === '(') dp++;
    else if (c === ')') dp--;
    else if (c === '[') ds++;
    else if (c === ']') ds--;
    else if (c === ',' && dc === 0 && dp === 0 && ds === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
    i++;
  }
  out.push(s.slice(start));
  return out;
}

function skipString(s, i, q) {
  i++;
  while (i < s.length) {
    if (s[i] === '\\') {
      i += 2;
      continue;
    }
    if (s[i] === q) return i + 1;
    i++;
  }
  return i;
}

function skipTemplate(s, i) {
  i++;
  while (i < s.length) {
    if (s[i] === '\\') {
      i += 2;
      continue;
    }
    if (s[i] === '`') return i + 1;
    if (s[i] === '$' && s[i + 1] === '{') {
      let d = 1;
      i += 2;
      while (i < s.length && d > 0) {
        if (s[i] === '{') d++;
        else if (s[i] === '}') d--;
        i++;
      }
      continue;
    }
    i++;
  }
  return i;
}

function main() {
  const files = listFiles();
  let modified = 0;
  for (const file of files) {
    const abs = path.resolve(file);
    const src = readFileSync(abs, 'utf-8');
    const { out, changed } = transform(src);
    if (changed && out !== src) {
      writeFileSync(abs, out);
      modified++;
      console.log('updated', file);
    }
  }
  console.log(`done: ${modified} files`);
}

main();
