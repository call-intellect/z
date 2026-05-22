/**
 * One-off patch для prompt registry: block-ingest v2 (Фаза 0b §5, §6 ТЗ).
 *
 * Согласно skill `safe-seed-rules` промпты НЕ создаются через `seed.ts`
 * (он может перетереть админ-правки). Этот скрипт — идемпотентный one-off:
 * проверяет, есть ли запись `taskType='block-ingest', version='v2'`;
 * если нет — создаёт.
 *
 * Запуск (из backend/):
 *   bun run scripts/patch-prompt-block-ingest-v2-fase0b.ts
 *
 * На дату создания (2026-05-21) у проекта Z prompt registry в виде
 * первоклассной БД-модели ещё нет — приоритет у code fallback в
 * `backend/src/modules/knowledge-core/prompts/block-ingest.prompt.ts`. Этот
 * скрипт превращается в no-op + лог для аудита. Когда появится модель
 * `Prompt` — раскомментировать секцию upsert'а.
 *
 * Безопасность:
 *   - Не перезаписывает существующую запись (только create если нет).
 *   - admin может править промпт через UI после этого — следующие запуски
 *     не перетрут админ-версию.
 */

import { PrismaClient } from '@prisma/client';

const TASK_TYPE = 'block-ingest';
const VERSION = 'v2';

// Дублирование текста промпта — сознательное (см. patch-prompt-role-profile-build-fase0d.ts):
// code fallback + БД-запись должны совпадать на момент seed'а; дальше БД-запись
// может расходиться (админ-правки). Здесь сокращённая выжимка — полный текст
// в `block-ingest.prompt.ts` SYSTEM_PROMPT.
const PROMPT_SUMMARY = `block-ingest v2 (Фаза 0b): расширенный JSON-output с
блоками + типизированными сущностями группы Б + role_relevant/roleHint.
Mission/Vision/Strategy всегда null (EXTRACTION_ENABLE_TOP_LEVEL=false).`;

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    // eslint-disable-next-line no-console
    console.log(
      `=== patch-prompt: ${TASK_TYPE}/${VERSION} — no-op (prompt registry в БД ещё не выделено отдельной моделью; ` +
        `используется code fallback в backend/src/modules/knowledge-core/prompts/block-ingest.prompt.ts) ===`,
    );
    // eslint-disable-next-line no-console
    console.log(`PROMPT_SUMMARY: ${PROMPT_SUMMARY}`);
    // TODO (Фаза γ или раньше): когда появится модель Prompt в schema.prisma —
    // раскомментировать upsert: prisma.prompt.upsert({ where: { taskType_version }, ... }).
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('patch-prompt-block-ingest-v2 FAILED:', err);
  process.exit(1);
});
