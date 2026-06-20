import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC_ROOT = join(__dirname, '..', '..');

const WHITELIST: ReadonlySet<string> = new Set<string>([
  'common/config/env.schema.ts',
  'common/config/config.module.ts',
  'main.ts',
  'modules/logging/db-logger.bridge.ts',
  'modules/logging/log.service.ts',
  'modules/mail/inbound/imap-poll.cron.ts',
]);

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTsFiles(full));
      continue;
    }
    if (!entry.name.endsWith('.ts')) continue;
    if (entry.name.endsWith('.spec.ts')) continue;
    out.push(full);
  }
  return out;
}

function toRel(full: string): string {
  return relative(SRC_ROOT, full).split(sep).join('/');
}

describe('no-direct-process-env guard', () => {
  it('нет прямого process.env вне whitelist (читай конфиг через TypedConfigService)', () => {
    const violations: string[] = [];
    const re = /process\.env\b/;

    for (const full of listTsFiles(SRC_ROOT)) {
      const rel = toRel(full);
      if (WHITELIST.has(rel)) continue;
      const lines = readFileSync(full, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i] ?? '')) {
          violations.push(`${rel}:${i + 1}`);
        }
      }
    }

    expect(
      violations,
      `Прямой process.env вне whitelist: ${violations.join(', ')}. ` +
        'Читай конфиг через TypedConfigService (resolveSync/getDynamic). См. CLAUDE.md принцип 9',
    ).toEqual([]);
  });
});
