import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { registeredSettingKeys } from './admin-setting-schema-registry';

const SKIP_DIRS = new Set(['node_modules', '.next', '.turbo', 'dist', 'coverage', '.git']);
const FE_KEY_RE = /(^|[^A-Za-z])key:\s*["']([^"']+)["']/g;

function findRepoRoot(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, 'frontend', 'app')) && existsSync(join(dir, 'backend'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('repo root (frontend/app + backend) не найден');
}

function collectSettingsClientFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) collectSettingsClientFiles(p, out);
    else if (name.endsWith('SettingsClient.tsx')) out.push(p);
  }
  return out;
}

function extractFeKeys(source: string): string[] {
  const keys: string[] = [];
  let m: RegExpExecArray | null;
  FE_KEY_RE.lastIndex = 0;
  while ((m = FE_KEY_RE.exec(source)) !== null) {
    const captured = m[2];
    if (captured !== undefined) keys.push(captured);
  }
  return keys;
}

function findPhantomFeKeys(feKeys: string[], registered: string[]): string[] {
  const reg = new Set(registered);
  return [...new Set(feKeys)].filter((k) => !reg.has(k)).sort();
}

describe('admin-setting FE↔backend key unification (guard)', () => {
  const repoRoot = findRepoRoot(__dirname);
  const feDir = resolve(repoRoot, 'frontend');
  const files = collectSettingsClientFiles(feDir);
  const registered = registeredSettingKeys();

  it('находит *SettingsClient.tsx файлы (sanity)', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('каждый FE-ключ крутилки существует в бэк-реестре (phantom = 0)', () => {
    const feKeys: string[] = [];
    const keyToFiles = new Map<string, string[]>();
    for (const f of files) {
      const rel = f.slice(repoRoot.length + 1);
      for (const k of extractFeKeys(readFileSync(f, 'utf8'))) {
        feKeys.push(k);
        const arr = keyToFiles.get(k) ?? [];
        arr.push(rel);
        keyToFiles.set(k, arr);
      }
    }
    const phantom = findPhantomFeKeys(feKeys, registered);
    const detail = phantom
      .map((k) => `  ${k}  <-  ${[...new Set(keyToFiles.get(k) ?? [])].join(', ')}`)
      .join('\n');
    expect(phantom, `phantom FE-ключи (нет в admin-setting-schema-registry):\n${detail}`).toEqual(
      [],
    );
  });

  it('findPhantomFeKeys ловит заведомо-ложный ключ (негатив)', () => {
    const registeredSample = ['knowledge.distillMergeThreshold'];
    expect(findPhantomFeKeys(['knowledge.distillMergeThreshold', 'totally.fake_key'], registeredSample)).toEqual([
      'totally.fake_key',
    ]);
  });
});
