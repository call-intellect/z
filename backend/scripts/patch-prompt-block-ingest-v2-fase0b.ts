import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';

const TASK_TYPE = 'block-ingest';
const VERSION = 'v2';

const PROMPT_SUMMARY = `block-ingest v2 (Фаза 0b): расширенный JSON-output с
блоками + типизированными сущностями группы Б + role_relevant/roleHint.
Mission/Vision/Strategy всегда null (EXTRACTION_ENABLE_TOP_LEVEL=false).`;

async function main(): Promise<void> {
  const prisma = createPrismaClient();
  try {
    // eslint-disable-next-line no-console
    console.log(
      `=== patch-prompt: ${TASK_TYPE}/${VERSION} — no-op (prompt registry в БД ещё не выделено отдельной моделью; ` +
        `используется code fallback в backend/src/modules/knowledge-core/prompts/block-ingest.prompt.ts) ===`,
    );
    // eslint-disable-next-line no-console
    console.log(`PROMPT_SUMMARY: ${PROMPT_SUMMARY}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('patch-prompt-block-ingest-v2 FAILED:', err);
  process.exit(1);
});
