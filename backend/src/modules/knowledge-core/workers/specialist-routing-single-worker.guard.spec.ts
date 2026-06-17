import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('specialist-routing — один Worker на очереди (machine guard)', () => {
  const srcRoot = join(__dirname, '..', '..', '..');

  function collectWorkerFiles(): string[] {
    const entries = readdirSync(srcRoot, {
      recursive: true,
      withFileTypes: true,
    });
    const result: string[] = [];
    for (const e of entries) {
      if (!e.isFile()) continue;
      if (!e.name.endsWith('.worker.ts')) continue;
      const parent =
        (e as { parentPath?: string; path?: string }).parentPath ??
        (e as { path?: string }).path ??
        srcRoot;
      result.push(join(parent, e.name));
    }
    return result;
  }

  const files = collectWorkerFiles();

  const QUEUE_WORKER_RE =
    /new\s+Worker\s*(?:<[^>]*>)?\s*\(\s*CORE_QUEUE_NAMES\.SPECIALIST_ROUTING/g;

  it('находит файлы-воркеры (sanity)', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('`new Worker(CORE_QUEUE_NAMES.SPECIALIST_ROUTING` встречается РОВНО один раз', () => {
    const hits: Array<{ file: string; count: number }> = [];
    let total = 0;

    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      const matches = src.match(QUEUE_WORKER_RE);
      const count = matches ? matches.length : 0;
      if (count > 0) {
        hits.push({ file, count });
        total += count;
      }
    }

    expect(
      total,
      `найдено ${total} создателей Worker на core.specialist-routing: ${JSON.stringify(
        hits.map((h) => h.file),
        null,
        2,
      )}`,
    ).toBe(1);

    expect(hits).toHaveLength(1);
    expect(hits[0]?.file).toMatch(/specialist-routing-dispatcher\.worker\.ts$/);
  });
});
