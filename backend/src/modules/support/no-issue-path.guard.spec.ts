import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('support — мёртвый Issue-путь убран (Ф3b)', () => {
  const servicesRoot = join(__dirname, 'services');

  const FILES = [
    'support-clone.service.ts',
    'support-learning.service.ts',
    'support-curator.service.ts',
    'support-intake.service.ts',
    'support-desk.service.ts',
  ];

  const ISSUE_ACCESS_RE = /\b(?:prisma|tx)\.(?:issue|issueComment)\b/g;

  it.each(FILES)('%s не обращается к prisma.issue / prisma.issueComment', (name) => {
    const src = readFileSync(join(servicesRoot, name), 'utf8');
    const matches = src.match(ISSUE_ACCESS_RE);
    expect(matches ?? [], `найдены обращения к Issue-пути: ${JSON.stringify(matches)}`).toEqual([]);
  });
});
