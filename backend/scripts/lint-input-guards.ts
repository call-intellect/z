import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Файлы (относительно backend/), которые строят LLM-user из raw-* входа и
// ОБЯЗАНЫ содержать guard. Список расширяется по мере Волны 2 (applyInputGuards
// везде). Добавил raw call-site без guard'а — линт упадёт, пока не обернёшь.
const GUARDED_RAW_CALLSITES: readonly string[] = [
  'src/modules/ai/workers/analyze.worker.ts',
  // Волна 1 (A1, E2-крит) — мутирующие/внешние входы, обёрнуты guard'ом:
  'src/modules/concierge/services/concierge.service.ts',
  'src/modules/tracker/workers/intake-auto-triage.worker.ts',
  'src/modules/conversational/adapters/telegram-bot/telegram-task-parser.service.ts',
  'src/modules/operations/services/commitment-response.handler.ts',
];

const GUARD_TOKENS = ['wrapUserData(', 'applyInputGuards('];

function main(): void {
  const root = resolve(__dirname, '..');
  const violations: string[] = [];
  for (const rel of GUARDED_RAW_CALLSITES) {
    const abs = resolve(root, rel);
    let content: string;
    try {
      content = readFileSync(abs, 'utf8');
    } catch {
      violations.push(`НЕ НАЙДЕН: ${rel}`);
      continue;
    }
    if (!GUARD_TOKENS.some((t) => content.includes(t))) {
      violations.push(`БЕЗ guard'а (нет wrapUserData/applyInputGuards): ${rel}`);
    }
  }
  if (violations.length > 0) {
    console.error('[lint-input-guards] НАРУШЕНИЯ:');
    for (const v of violations) console.error('  - ' + v);
    process.exit(1);
  }
  console.log(`[lint-input-guards] OK: ${GUARDED_RAW_CALLSITES.length} raw call-site(s) обёрнуты.`);
}

main();
