import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const GUARDED_RAW_CALLSITES: readonly string[] = [
  'src/modules/ai/workers/analyze.worker.ts',
  'src/modules/concierge/services/concierge.service.ts',
  'src/modules/tracker/workers/intake-auto-triage.worker.ts',
  'src/modules/conversational/adapters/telegram-bot/telegram-task-parser.service.ts',
  'src/modules/operations/services/commitment-response.handler.ts',
  'src/modules/ai/services/chapter-extraction.service.ts',
  'src/modules/ai/services/task-extraction.service.ts',
  'src/modules/ai/services/regenerate.service.ts',
  'src/modules/ai/services/transcript-clean-llm-refine.service.ts',
  'src/modules/ai/workers/meeting-speaker-analyzer.worker.ts',
  'src/modules/ai/services/prompts/table-infer-schema.prompt.ts',
  'src/modules/ai/services/prompts/table-extract-rows.prompt.ts',
  'src/modules/ai/services/prompts/table-auto-fill.prompt.ts',
  'src/modules/knowledge-core/services/sprint-helper.service.ts',
  'src/modules/knowledge-core/services/sprint-review.service.ts',
  'src/modules/chat/chat.service.ts',
  'src/modules/chatbox/chatbox-ingest.service.ts',
  'src/modules/concierge/services/step-scorer.service.ts',
  'src/modules/operations/services/checkin-parser.service.ts',
  'src/modules/probe/probe-dispatcher.worker.ts',
  'src/modules/probe/probe-response.handler.ts',
  'src/modules/processes/services/process-extraction.service.ts',
  'src/modules/admin/prompt-templates/prompt-templates-preview.service.ts',
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
