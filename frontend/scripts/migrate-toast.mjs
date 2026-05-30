#!/usr/bin/env node
/**
 * Codemod: legacy useToast/addToast → sonner.
 *
 * Запускается из корня frontend/. Перебирает все .ts/.tsx файлы,
 * заменяет импорты `from '@/contexts/toast-context'` и вызовы `addToast({...})`.
 *
 * Стратегия: regex-based (не AST) — наши вызовы достаточно однообразны.
 * После прогона — `bun run typecheck`.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

const ROOTS = ['app', 'src'];
const SKIP_FILES = new Set([
  'src/contexts/toast-context.tsx',
  'src/ui/shadcn/toast.tsx',
  'scripts/migrate-toast.mjs',
]);

function listFiles() {
  const files = [];
  for (const root of ROOTS) {
    // tracked + untracked (но не игнорированные).
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

function transform(source) {
  let out = source;
  let changed = false;

  // 1) Если файл не импортирует toast-context И не использует addToast —
  // пропускаем.
  if (!/toast-context/.test(out) && !/\baddToast\b/.test(out))
    return { out, changed };

  // 2) Заменяем impорт. Возможные варианты:
  //    import { useToast, type ToastType, ... } from '...toast-context';
  //    import { useToast } from '...toast-context';
  //    import { useToast, ToastProvider } from '...toast-context';
  const importLineRe = /^import\s*\{([^}]+)\}\s*from\s*['"][^'"]*toast-context['"]\s*;?\s*$/gm;

  const matches = [...out.matchAll(importLineRe)];
  // Если импортов нет — НЕ ранний возврат: возможно, осталось `addToast(`
  // от предыдущего прохода (импорт уже удалён). Просто переходим к шагам 3-6.

  for (const m of matches) {
    const namedRaw = m[1];
    const names = namedRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    // Полезные имена для legacy code:
    //   useToast, ToastProvider, Toast, ToastType, ToastAction
    // useToast → удаляем строку, добавляем `import { toast } from 'sonner';`
    // Если остались type-only имена (ToastType, ToastAction, Toast) — нужно ли что-то?
    // Эти типы больше нигде не нужны — заменим на локальные/инлайн или оставим импорт shim.

    const hasUseToast = names.some((n) => n.replace(/^type\s+/, '') === 'useToast');
    const hasProvider = names.some((n) => n.replace(/^type\s+/, '') === 'ToastProvider');
    const remainingTypes = names.filter((n) => {
      const clean = n.replace(/^type\s+/, '');
      return clean !== 'useToast' && clean !== 'ToastProvider';
    });

    let replacement = '';
    if (hasUseToast || hasProvider) {
      replacement += `import { toast } from 'sonner';`;
    }
    if (remainingTypes.length > 0) {
      // Сохраняем оставшиеся импорты типов из shim.
      replacement += (replacement ? '\n' : '') +
        `import { ${remainingTypes.join(', ')} } from '@/contexts/toast-context';`;
    }

    out = out.replace(m[0], replacement);
    changed = true;
  }

  // 3) Заменяем `const { addToast, dismissToast?, toasts? } = useToast();`
  // — больше не нужно.
  out = out.replace(
    /^\s*const\s*\{\s*([^}]+)\s*\}\s*=\s*useToast\(\)\s*;?\s*$/gm,
    (full, names) => {
      // Если используются только addToast/toasts/dismissToast — убираем строку.
      const clean = names
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const onlyLegacy = clean.every((n) =>
        ['addToast', 'toasts', 'dismissToast'].includes(n),
      );
      if (onlyLegacy) {
        changed = true;
        return '';
      }
      return full;
    },
  );

  // 4) Заменяем addToast({ type: 'success', message: 'X' }) →
  //    toast.success('X')
  // Однострочный случай.
  out = out.replace(
    /addToast\(\s*\{\s*type:\s*['"](success|error|info)['"]\s*,\s*message:\s*([^,}]+?)\s*\}\s*\)/g,
    (full, type, msg) => {
      changed = true;
      const fn = type === 'info' ? 'toast' : `toast.${type}`;
      return `${fn}(${msg.trim()})`;
    },
  );

  // 5) addToast({ message: '...', type: '...' }) — обратный порядок ключей.
  out = out.replace(
    /addToast\(\s*\{\s*message:\s*([^,}]+?)\s*,\s*type:\s*['"](success|error|info)['"]\s*\}\s*\)/g,
    (full, msg, type) => {
      changed = true;
      const fn = type === 'info' ? 'toast' : `toast.${type}`;
      return `${fn}(${msg.trim()})`;
    },
  );

  // 6) Многострочный addToast({ type: 'error', message: <expr с переносами> })
  // Простейшее: ищем парный balanced литерал { ... } по одной фигурной скобке
  // в `addToast(   {  ... }   )`. Реализуем балансовый парсер по символам.
  out = applyBalancedAddToast(out, (replaced) => {
    if (replaced) changed = true;
  });

  return { out, changed };
}

/**
 * Балансовый парсер для addToast({...}). Находит все вхождения, разбирает
 * объект-литерал верхнего уровня, и если в нём только { type, message,
 * durationMs?, action? } — конвертирует в sonner-вызов.
 */
function applyBalancedAddToast(source, onChange) {
  let out = '';
  let i = 0;
  let didChange = false;
  while (i < source.length) {
    const idx = source.indexOf('addToast(', i);
    if (idx < 0) {
      out += source.slice(i);
      break;
    }
    out += source.slice(i, idx);
    // Скип, если перед addToast идёт точка/идентификатор: например `ctx.addToast`.
    const prev = source[idx - 1];
    const isProp = prev === '.';
    // Парсим аргументы.
    const argsStart = idx + 'addToast('.length;
    const objStart = skipWs(source, argsStart);
    if (source[objStart] !== '{') {
      // не объект-литерал — оставляем как есть
      out += source.slice(idx, argsStart);
      i = argsStart;
      continue;
    }
    const objEnd = findMatchingBrace(source, objStart);
    if (objEnd < 0) {
      out += source.slice(idx);
      break;
    }
    const afterObj = skipWs(source, objEnd + 1);
    if (source[afterObj] !== ')') {
      // что-то нетипичное (например, второй аргумент) — пропускаем
      out += source.slice(idx, argsStart);
      i = argsStart;
      continue;
    }
    const callEnd = afterObj + 1;
    const objLiteral = source.slice(objStart, objEnd + 1);
    const parsed = tryParseToastLiteral(objLiteral);
    if (!parsed) {
      // Сложный кейс (computed property, spread, и т.п.) — не трогаем
      out += source.slice(idx, callEnd);
      i = callEnd;
      continue;
    }
    const fn =
      parsed.type === 'info' ? 'toast' : `toast.${parsed.type}`;
    let optionParts = [];
    if (parsed.durationMs !== null) {
      optionParts.push(`duration: ${parsed.durationMs}`);
    }
    if (parsed.action !== null) {
      optionParts.push(`action: ${parsed.action}`);
    }
    const optionsArg =
      optionParts.length > 0 ? `, { ${optionParts.join(', ')} }` : '';
    // Префикс `ctx.addToast` сохраняем — sonner глобален, но если код
    // вызывается через ctx.addToast, нужно заменить на toast.*.
    if (isProp) {
      // удалим '.' и предыдущий идентификатор (например `ctx`).
      // Найдём начало идентификатора.
      let k = idx - 1; // на точке
      let m = k - 1;
      while (m >= 0 && /[A-Za-z0-9_$]/.test(source[m])) m--;
      // out на данный момент включает source[i..idx-1]; нужно вычесть
      // префикс длиной idx - (m + 1) (это `ctx.`).
      const prefixLen = idx - (m + 1);
      out = out.slice(0, out.length - prefixLen);
    }
    out += `${fn}(${parsed.message}${optionsArg})`;
    didChange = true;
    i = callEnd;
  }
  onChange?.(didChange);
  return out;
}

function skipWs(s, i) {
  while (i < s.length && /\s/.test(s[i])) i++;
  return i;
}

function findMatchingBrace(s, openIdx) {
  // Учитываем строки, шаблонные литералы, комментарии.
  let depth = 0;
  let i = openIdx;
  while (i < s.length) {
    const c = s[i];
    if (c === '/' && s[i + 1] === '/') {
      const nl = s.indexOf('\n', i);
      i = nl < 0 ? s.length : nl + 1;
      continue;
    }
    if (c === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2);
      i = end < 0 ? s.length : end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      i = skipString(s, i, c);
      continue;
    }
    if (c === '`') {
      i = skipTemplate(s, i);
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

function skipString(s, i, quote) {
  i++;
  while (i < s.length) {
    if (s[i] === '\\') {
      i += 2;
      continue;
    }
    if (s[i] === quote) return i + 1;
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
      // вложенное выражение
      let depth = 1;
      i += 2;
      while (i < s.length && depth > 0) {
        if (s[i] === '{') depth++;
        else if (s[i] === '}') depth--;
        i++;
      }
      continue;
    }
    i++;
  }
  return i;
}

function tryParseToastLiteral(lit) {
  // Простой парсер свойств верхнего уровня: type, message, durationMs, action.
  // Поддерживаем shorthand и trailing-comma, не поддерживаем computed keys.
  if (!lit.startsWith('{') || !lit.endsWith('}')) return null;
  const inner = lit.slice(1, -1);
  const props = splitTopLevel(inner);
  let type = null;
  let message = null;
  let durationMs = null;
  let action = null;
  for (const raw of props) {
    const seg = raw.trim();
    if (!seg) continue;
    if (seg.startsWith('//')) return null;
    const colon = findTopLevelColon(seg);
    let key, value;
    if (colon < 0) {
      // shorthand: { message }, { type } и т.п.
      if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(seg)) return null;
      key = seg;
      value = seg;
    } else {
      key = seg.slice(0, colon).trim();
      value = seg.slice(colon + 1).trim();
    }
    if (key === 'type') {
      const m = value.match(/^['"](success|error|info)['"]$/);
      if (!m) return null;
      type = m[1];
    } else if (key === 'message') {
      message = value;
    } else if (key === 'durationMs') {
      durationMs = value;
    } else if (key === 'action') {
      action = value;
    } else {
      return null;
    }
  }
  if (!type || message === null) return null;
  return { type, message, durationMs, action };
}

function splitTopLevel(s) {
  const out = [];
  let depthCurly = 0;
  let depthParen = 0;
  let depthSquare = 0;
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
    if (c === '/' && s[i + 1] === '/') {
      const nl = s.indexOf('\n', i);
      i = nl < 0 ? s.length : nl + 1;
      continue;
    }
    if (c === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2);
      i = end < 0 ? s.length : end + 2;
      continue;
    }
    if (c === '{') depthCurly++;
    else if (c === '}') depthCurly--;
    else if (c === '(') depthParen++;
    else if (c === ')') depthParen--;
    else if (c === '[') depthSquare++;
    else if (c === ']') depthSquare--;
    else if (
      c === ',' &&
      depthCurly === 0 &&
      depthParen === 0 &&
      depthSquare === 0
    ) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
    i++;
  }
  out.push(s.slice(start));
  return out;
}

function findTopLevelColon(s) {
  let depthCurly = 0;
  let depthParen = 0;
  let depthSquare = 0;
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
    if (c === '{') depthCurly++;
    else if (c === '}') depthCurly--;
    else if (c === '(') depthParen++;
    else if (c === ')') depthParen--;
    else if (c === '[') depthSquare++;
    else if (c === ']') depthSquare--;
    else if (
      c === ':' &&
      depthCurly === 0 &&
      depthParen === 0 &&
      depthSquare === 0
    ) {
      return i;
    }
    i++;
  }
  return -1;
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
